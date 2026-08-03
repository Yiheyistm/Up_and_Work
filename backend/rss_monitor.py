"""
RSS Feed Monitor and Job Deduplication.

This module handles polling Upwork RSS feeds, parsing the XML data, extracting
job attributes (title, budget, link, required skills, etc.), and deduplicating
jobs by storing them in the PostgreSQL database using the unique `guid`.

After saving each new job it immediately:
  1. Triggers the 5-stage AI pipeline (extract → match → proposal → Q&A → bid).
  2. Broadcasts the new job event to all connected WebSocket clients (real-time dashboard).
  3. Sends a Telegram alert if the match score meets the threshold.
"""

import asyncio
import json
import os
from pathlib import Path

import feedparser
from bs4 import BeautifulSoup
from dateutil import parser as date_parser
from datetime import datetime, timezone
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from urllib.parse import urlparse, parse_qs, unquote_plus
from backend.models import Job, RssFeed

# Threshold below which we do not fire Telegram alerts
MATCH_THRESHOLD = int(os.environ.get("MATCH_SCORE_THRESHOLD", "70"))
PROFILE_PATH = Path(__file__).parent.parent / "config" / "profile.json"


def _load_profile() -> dict:
    """Load and return the candidate profile from config/profile.json."""
    if PROFILE_PATH.exists():
        with open(PROFILE_PATH, "r") as f:
            return json.load(f)
    logger.warning("profile.json not found — AI pipeline will use empty profile.")
    return {}


import re as _re

def extract_budget(description_html: str) -> dict:
    """Extract budget/hourly information from Upwork RSS description HTML."""
    soup = BeautifulSoup(description_html, "html.parser")
    text = soup.get_text()

    budget_type = None
    budget_min = None
    budget_max = None

    # Upwork RSS includes either "Hourly Range:" or "Budget:" in the description
    if "Hourly Range:" in text:
        budget_type = "Hourly"
        try:
            range_str = text.split("Hourly Range:")[1].split("\n")[0].strip()
            # Extract all dollar amounts using regex
            amounts = _re.findall(r"\$?[\d,]+\.?\d*", range_str.replace(",", ""))
            if len(amounts) >= 2:
                budget_min = float(amounts[0])
                budget_max = float(amounts[1])
            elif len(amounts) == 1:
                budget_min = float(amounts[0])
                budget_max = float(amounts[0])
        except Exception as e:
            logger.warning(f"Failed to parse hourly range: {e}")

    elif "Budget:" in text:
        budget_type = "Fixed"
        try:
            budget_str = text.split("Budget:")[1].split("\n")[0].strip()
            # Extract the first valid dollar amount, ignoring markdown/formatting noise
            amounts = _re.findall(r"\$?[\d,]+\.?\d*", budget_str.replace(",", ""))
            if amounts:
                val = float(amounts[0])
                budget_min = val
                budget_max = val
        except Exception as e:
            logger.warning(f"Failed to parse fixed budget: {e}")

    return {"budget_type": budget_type, "budget_min": budget_min, "budget_max": budget_max}


def extract_skills(description_html: str) -> list[str]:
    """Extract the comma-separated skills list from Upwork RSS description HTML."""
    soup = BeautifulSoup(description_html, "html.parser")
    text = soup.get_text()
    skills: list[str] = []

    if "Skills:" in text:
        try:
            skills_str = text.split("Skills:")[1].split("\n")[0].strip()
            skills = [s.strip() for s in skills_str.split(",") if s.strip()]
        except Exception as e:
            logger.warning(f"Failed to parse skills: {e}")

    return skills


SOFTWARE_KEYWORDS = [
    "software", "developer", "engineer", "programmer", "coder", "web",
    "mobile", "app", "api", "backend", "frontend", "fullstack", "full-stack",
    "python", "javascript", "typescript", "go", "rust", "java", "kotlin",
    "flutter", "react", "node", "django", "fastapi", "spring", "ruby",
    "php", "csharp", "dotnet", "react native", "swift", "ios", "android",
    "devops", "cloud", "docker", "kubernetes", "microservice", "microservices",
    "machine learning", "ml", "ai", "artificial intelligence", "data science",
    "embedded", "iot", "rest", "graphql", "database", "sql", "nosql",
    "postgresql", "mongodb", "redis", "elasticsearch", "ci/cd", "automation",
    "scripting", "selenium", "testing", "qa", "cypress", "jest", "junit",
    "git", "github", "agile", "scrum", "jira", "slack", "typescript",
    "css", "html", "next.js", "vue", "angular", "svelte", "node.js",
    "express", "fastify", "flask", "fastapi", "django rest", "drf",
    "graphql", "apollo", "typescript", "javascript", "websocket", "socket",
    "payment", "stripe", "paypal", "oauth", "authentication", "auth",
    "firebase", "supabase", "appwrite", "aws", "gcp", "azure", "vercel",
    "netlify", "heroku", "digitalocean", "linode", "serverless",
    "qr", "payment", "ocr", "image", "video", "audio", "nlp", "chatbot",
    "blockchain", "crypto", "defi", "smart contract", "web3",
    "e-commerce", "shopify", "woocommerce", "magento", "salesforce",
    "crm", "erp", "hr", "fintech", "healthtech", "edtech", "logistics",
    "real estate", "marketplace", "social", "chat", "messaging",
    "notification", "email", "sms", "push", "analytics", "dashboard",
    "reporting", "billing", "invoice", "subscription", "saas",
    "multi-tenant", "security", "encryption", "ssl", "https", "cors",
    "performance", "optimization", "seo", "accessibility", "responsive",
    "design system", "component library", "ui/ux", "prototyping",
    "wireframe", "figma", "figma", "adobe", "photoshop", "illustrator",
]


def is_software_related(title: str, description: str = "") -> bool:
    """Check if a job title/description contains software-related keywords."""
    text = f"{title} {description}".lower()
    return any(kw in text for kw in SOFTWARE_KEYWORDS)


def extract_country(description_html: str) -> str | None:
    """Extract the client country from Upwork RSS description HTML."""
    soup = BeautifulSoup(description_html, "html.parser")
    text = soup.get_text()

    if "Country:" in text:
        try:
            return text.split("Country:")[1].split("\n")[0].strip()
        except Exception as e:
            logger.warning(f"Failed to parse country: {e}")

from urllib.parse import urlparse, parse_qs, quote_plus

def normalize_rss_url(url: str) -> str:
    """
    Returns the URL as-is. 
    Upwork deprecated the /ab/feed/jobs/rss endpoint, so we now use standard 
    web search URLs (e.g. /nx/search/jobs/?q=...) and rely on the Apify scraper.
    """
    return url



async def fetch_apify_upwork_jobs(search_queries: list[str]) -> list[dict]:
    """
    Fetches real live job data using Apify's Upwork Scraper Actor if APIFY_API_TOKEN is set.
    Performs a single batch run with all provided search queries to save credits.
    """
    apify_token = os.environ.get("APIFY_API_TOKEN")
    if not apify_token or apify_token == "your_apify_api_token_here" or not search_queries:
        return []

    logger.info(f"Apify: Batch querying live Upwork jobs for {len(search_queries)} queries: {search_queries}")

    try:
        from apify_client import ApifyClient

        def _run_apify():
            client = ApifyClient(apify_token)
            run_input = {
                "queries": search_queries,
                "limit": 20,
                "client.paymentMethodVerified": True,
                "budget.allowUnspecifiedBudget": True,
                "budget.hourlyRate.min": "10",
                "budget.hourlyRate.max": "150",
                "budget.fixedPrice.min": "50",
                "budget.fixedPrice.max": "10000",
                "jobCategories": [
                    "Web Development",
                    "Mobile Development",
                    "AI Apps & Integration",
                    "Other - Software Development"
                ]
            }
            run = client.actor("flash_mage/upwork").call(run_input=run_input)
            dataset_id = getattr(run, "default_dataset_id", None) or (run.get("defaultDatasetId") if isinstance(run, dict) else None)
            return list(client.dataset(dataset_id).iterate_items())

        raw_items = await asyncio.to_thread(_run_apify)
        entries = []
        for item in raw_items:
            data_obj = item.get("data") or {}
            opening = data_obj.get("opening") or {}
            buyer = data_obj.get("buyer") or {}

            link = item.get("link") or item.get("externalLink") or item.get("url") or ""
            ciphertext = opening.get("ciphertext") or (link.split("/")[-1] if "~" in link else "")
            
            # CRITICAL: Do NOT use item.get("id") because it is a sequential integer index (0, 1, 2...)
            guid = ciphertext or link or (str(item.get("uid")) if item.get("uid") else None)
            if not guid:
                continue

            title = opening.get("title") or item.get("title") or "Untitled Job"
            description = opening.get("description") or item.get("description") or ""

            # Extract budget from Apify JSON schema
            budget_str = ""
            amount = opening.get("amount", {}).get("amount") if isinstance(opening.get("amount"), dict) else opening.get("amount")
            if amount and amount > 0:
                budget_str = f"Budget: ${amount}\n"
            elif opening.get("hourlyBudgetMin") or opening.get("hourlyBudgetMax"):
                min_h = opening.get("hourlyBudgetMin", "?")
                max_h = opening.get("hourlyBudgetMax", "?")
                budget_str = f"Hourly Range: ${min_h}-${max_h}\n"
            else:
                budget_obj = item.get("budget", {})
                fixed_budget = budget_obj.get("fixedBudget", 0) if isinstance(budget_obj, dict) else 0
                hourly_obj = budget_obj.get("hourlyRate", {}) if isinstance(budget_obj, dict) else {}
                if fixed_budget and fixed_budget > 0:
                    budget_str = f"Budget: ${fixed_budget}\n"
                elif isinstance(hourly_obj, dict) and (hourly_obj.get("min") or hourly_obj.get("max")):
                    budget_str = f"Hourly Range: ${hourly_obj.get('min', '?')}-${hourly_obj.get('max', '?')}\n"

            raw_skills = opening.get("ontologySkills") or []
            skills_list = [s.get("prefLabel") for s in raw_skills if isinstance(s, dict) and s.get("prefLabel")]
            if not skills_list:
                skills_list = item.get("skills") or []

            skills_str = f"Skills: {', '.join(skills_list)}\n" if skills_list else ""

            country_val = (buyer.get("location") or {}).get("country") or (item.get("client") or {}).get("country") or "Remote"
            country_str = f"Country: {country_val}\n"

            # Payment verified & Client rating
            is_payment_verified = (
                buyer.get("paymentMethodVerified") is not False
                and "unverified payment" not in description.lower()
                and "payment unverified" not in description.lower()
            )
            client_rating_val = (buyer.get("stats") or {}).get("score")

            full_desc = f"{description}\n\n{budget_str}{skills_str}{country_str}"

            entries.append({
                "id": str(guid),
                "title": title,
                "link": link or f"https://www.upwork.com/jobs/{guid}",
                "description": full_desc,
                "payment_verified": is_payment_verified,
                "client_rating": float(client_rating_val) if client_rating_val else None,
                "published": opening.get("postedOn") or item.get("publishedAt") or item.get("createdAt") or datetime.now(timezone.utc).isoformat(),
            })

        logger.info(f"Apify returned {len(entries)} real live jobs across all queries.")
        return entries
    except Exception as e:
        logger.error(f"Apify batch job fetch failed: {e}")
        return []


async def poll_rss_feeds(db: AsyncSession) -> None:
    """
    Main polling function.

    1. Fetches live jobs via Apify (single batch run with all search queries).
    2. Falls back to RSS feed parsing only for genuine RSS URLs
       (skips /nx/search/ HTML pages that feedparser cannot parse).
    3. Deduplicates by guid, inserts new jobs, runs the AI pipeline,
       broadcasts via WebSocket, and sends Telegram alerts for high matches.
    """
    logger.info("Starting RSS feed polling cycle...")

    from backend.routers.ws import manager as ws_manager
    from backend.ai_engine import process_job_pipeline
    from backend.telegram_bot import send_job_alert

    result = await db.execute(select(RssFeed.url).where(RssFeed.is_active == True))
    feed_urls = [str(u) for u in result.scalars().all()]

    if not feed_urls:
        logger.info("No active RSS feeds in DB — skipping polling cycle.")
        return

    profile_data = _load_profile()
    total_new_jobs = 0

    # 1. Gather all search queries for Apify batch run
    search_queries = []
    for raw_feed_url in feed_urls:
        target_url = normalize_rss_url(raw_feed_url)
        parsed = urlparse(target_url)
        query_params = parse_qs(parsed.query)
        if "q" in query_params:
            q_val = query_params["q"][0]
            search_query = unquote_plus(q_val).replace("+", " ")
            search_queries.append(search_query)

    apify_entries = []
    apify_token = os.environ.get("APIFY_API_TOKEN")
    if apify_token and apify_token != "your_apify_api_token_here" and search_queries:
        apify_entries = await fetch_apify_upwork_jobs(list(set(search_queries)))
        logger.info(f"Apify: {len(apify_entries)} live jobs fetched for this cycle.")

    # 2. Process Apify entries once (they are already deduplicated by guid)
    if apify_entries:
        new_jobs_for_cycle = 0
        for entry in apify_entries:
            title = entry.get("title") or "Untitled Job"
            description = entry.get("description") or ""
            if not is_software_related(title, description):
                continue
            guid = entry.get("id") or entry.get("guid")
            if not guid:
                continue

            existing = await db.execute(select(Job.id).where(Job.guid == guid))
            if existing.scalar_one_or_none():
                continue

            title = entry.get("title") or "Untitled Job"
            link = entry.get("link") or ""
            description = entry.get("description") or ""

            posted_at = None
            published_str = entry.get("published")
            if published_str:
                try:
                    posted_at = date_parser.parse(published_str)
                except Exception as e:
                    logger.warning(f"Failed to parse date '{published_str}': {e}")

            budget_info = extract_budget(description)
            skills = extract_skills(description)
            country = extract_country(description)

            new_job = Job(
                guid=guid,
                title=title,
                description=description,
                link=link,
                budget_type=budget_info["budget_type"],
                budget_min=budget_info["budget_min"],
                budget_max=budget_info["budget_max"],
                payment_verified=entry.get("payment_verified", False),
                client_rating=entry.get("client_rating"),
                required_skills=skills,
                client_country=country,
                status="new",
                posted_at=posted_at,
            )

            db.add(new_job)
            await db.flush()

            logger.info(f"New job saved: '{title}' (id={new_job.id})")

            await process_job_pipeline(new_job, profile_data, db, match_threshold=MATCH_THRESHOLD)

            await ws_manager.broadcast({
                "event": "new_job",
                "job_id": str(new_job.id),
                "title": new_job.title,
                "match_score": new_job.match_score,
                "status": new_job.status,
            })

            if new_job.match_score and new_job.match_score >= MATCH_THRESHOLD:
                budget_str = (
                    f"${new_job.budget_min}-${new_job.budget_max}/hr"
                    if new_job.budget_type == "Hourly"
                    else f"${new_job.budget_min}"
                )
                await send_job_alert(
                    job_title=new_job.title,
                    match_score=new_job.match_score,
                    budget=budget_str,
                    link=new_job.link,
                )

            new_jobs_for_cycle += 1
            total_new_jobs += 1

        await db.commit()
        logger.info(f"Apify cycle complete. {new_jobs_for_cycle} new jobs inserted this cycle.")
        return

    # 3. No Apify token — fall back to RSS feed parsing (only for genuine RSS URLs)
    for raw_feed_url in feed_urls:
        target_url = normalize_rss_url(raw_feed_url)
        logger.info(f"Processing feed: {target_url}")

        # Skip HTML search pages — feedparser cannot parse them
        if "/nx/search/" in target_url:
            logger.debug(f"Skipping non-RSS URL (HTML search page): {target_url}")
            continue

        try:
            parsed_feed = feedparser.parse(target_url)
            entries = list(parsed_feed.entries)
            if not entries:
                logger.info(f"Feed '{target_url}' returned 0 entries. Skipping cycle.")
                continue

            new_jobs_for_feed = 0

            for entry in entries:
                guid = entry.get("id") or entry.get("guid")
                if not guid:
                    continue

                existing = await db.execute(select(Job.id).where(Job.guid == guid))
                if existing.scalar_one_or_none():
                    continue

                title = entry.get("title", "Untitled Job")
                link = entry.get("link", "")
                description = entry.get("description", "")

                if not is_software_related(title, description):
                    continue

                posted_at = None
                pub_date_str = entry.get("published") or entry.get("pubDate")
                if pub_date_str:
                    try:
                        posted_at = date_parser.parse(pub_date_str)
                    except Exception as e:
                        logger.warning(f"Failed to parse date '{pub_date_str}': {e}")

                budget_info = extract_budget(description)
                skills = extract_skills(description)
                country = extract_country(description)

                is_payment_verified = "unverified payment" not in description.lower() and "payment unverified" not in description.lower()

                new_job = Job(
                    guid=guid,
                    title=title,
                    description=description,
                    link=link,
                    budget_type=budget_info["budget_type"],
                    budget_min=budget_info["budget_min"],
                    budget_max=budget_info["budget_max"],
                    payment_verified=is_payment_verified,
                    required_skills=skills,
                    client_country=country,
                    status="new",
                    posted_at=posted_at,
                )

                db.add(new_job)
                await db.flush()

                logger.info(f"New job saved: '{title}' (id={new_job.id})")

                await process_job_pipeline(new_job, profile_data, db, match_threshold=MATCH_THRESHOLD)

                await ws_manager.broadcast({
                    "event": "new_job",
                    "job_id": str(new_job.id),
                    "title": new_job.title,
                    "match_score": new_job.match_score,
                    "status": new_job.status,
                })

                if new_job.match_score and new_job.match_score >= MATCH_THRESHOLD:
                    budget_str = (
                        f"${new_job.budget_min}-${new_job.budget_max}/hr"
                        if new_job.budget_type == "Hourly"
                        else f"${new_job.budget_min}"
                    )
                    await send_job_alert(
                        job_title=new_job.title,
                        match_score=new_job.match_score,
                        budget=budget_str,
                        link=new_job.link,
                    )

                new_jobs_for_feed += 1
                total_new_jobs += 1

            feed_result = await db.execute(select(RssFeed).where(RssFeed.url == raw_feed_url))
            feed_obj = feed_result.scalar_one_or_none()
            if feed_obj:
                feed_obj.last_polled_at = datetime.now(timezone.utc)
                feed_obj.jobs_found_total += new_jobs_for_feed

            await db.commit()
            logger.info(f"Feed processing done for: {raw_feed_url} → {new_jobs_for_feed} new jobs inserted this iteration.")

        except Exception as e:
            logger.error(f"Error polling feed {raw_feed_url}: {e}")
            await db.rollback()

    logger.info(f"RSS polling cycle complete. Total new jobs this cycle: {total_new_jobs}.")
