"""
Jobs Router.

This module provides the REST API endpoints for fetching, querying,
and updating Upwork jobs stored in the database. It also exposes
a ``/scrape-url`` endpoint that fetches a real Upwork job page,
extracts the description/budget/skills with BeautifulSoup, and
runs the full AI pipeline on the live data.
"""

import asyncio
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from backend.database import get_db
from backend.models import Job
from backend.schemas import JobResponse, JobUpdateStatus
from bs4 import BeautifulSoup
from curl_cffi import requests as curl_requests

router = APIRouter()

@router.get("/", response_model=List[JobResponse])
async def get_jobs(
    status: Optional[str] = Query(None, description="Filter by job status (e.g., new, applied)"),
    min_score: Optional[int] = Query(None, description="Minimum match score"),
    limit: int = Query(200, ge=1, le=200, description="Max items per page"),
    offset: int = Query(0, ge=0, description="Number of items to skip"),
    db: AsyncSession = Depends(get_db)
):
    """Fetch a list of jobs, optionally filtered by status and match score."""
    stmt = select(Job)

    if status:
        stmt = stmt.where(Job.status == status)
    if min_score is not None:
        stmt = stmt.where(Job.match_score >= min_score)
    else:
        stmt = stmt.where(Job.match_score > 0)

    # Order by newest detected first
    stmt = stmt.order_by(desc(Job.detected_at))
    stmt = stmt.limit(limit).offset(offset)

    result = await db.execute(stmt)
    jobs = result.scalars().all()
    return jobs

@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Fetch details of a single job by its ID."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@router.patch("/{job_id}/status", response_model=JobResponse)
async def update_job_status(
    job_id: uuid.UUID,
    status_update: JobUpdateStatus,
    db: AsyncSession = Depends(get_db)
):
    """Update the status of a specific job (e.g., mark as 'applied' or 'ignored')."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    job.status = status_update.status
    await db.commit()
    await db.refresh(job)
    return job


@router.delete("/{job_id}")
async def delete_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
  """Delete a specific job by its ID."""
  job = await db.get(Job, job_id)
  if not job:
    raise HTTPException(status_code=404, detail="Job not found")
  await db.delete(job)
  await db.commit()
  return {"detail": f"Job {job_id} deleted"}


from pydantic import BaseModel

class ScrapeUrlRequest(BaseModel):
    url: str

def _extract_upwork_job_data(html: str) -> dict:
    """Parse an Upwork job page HTML and return structured job data."""
    soup = BeautifulSoup(html, "html.parser")
    data: dict = {
        "title": None,
        "description": "",
        "budget_type": None,
        "budget_min": None,
        "budget_max": None,
        "skills": [],
        "country": None,
    }

    # Title
    title_el = soup.find("h1") or soup.find("h2") or soup.find("[data-test='job-detail-title']")
    if title_el:
        data["title"] = title_el.get_text(strip=True)

    # Description — Upwork pages typically have a dedicated description container
    desc_selectors = [
        "[data-test='job-description']",
        ".job-description",
        "#job-description",
        ".description",
        "section[aria-label='Job Description']",
    ]
    for sel in desc_selectors:
        el = soup.select_one(sel)
        if el:
            data["description"] = el.get_text(separator="\n", strip=True)
            break

    # If no dedicated container found, fall back to the main content area
    if not data["description"]:
        main = soup.find("main") or soup.find("article") or soup
        data["description"] = main.get_text(separator="\n", strip=True)[:5000]

    # Budget — look for common patterns
    budget_text = data["description"] or ""
    if "Hourly" in budget_text or "hourly" in budget_text:
        data["budget_type"] = "Hourly"
        import re as _re
        hourly_match = _re.search(r"[\$]?\s*([\d,]+)\s*[–\-]\s*[\$]?\s*([\d,]+)", budget_text)
        if hourly_match:
            data["budget_min"] = float(hourly_match.group(1).replace(",", ""))
            data["budget_max"] = float(hourly_match.group(2).replace(",", ""))
    elif "Budget" in budget_text or "Fixed" in budget_text:
        data["budget_type"] = "Fixed"
        import re as _re
        fixed_match = _re.search(r"[\$]?\s*([\d,]+(?:\.\d+)?)", budget_text)
        if fixed_match:
            val = float(fixed_match.group(1).replace(",", ""))
            data["budget_min"] = val
            data["budget_max"] = val

    # Skills — Upwork often lists them in a skills section
    skills_els = soup.select(".skills-list li, .skill-tag, [data-test='skill-pill'], .job-skills span")
    if skills_els:
        data["skills"] = [s.get_text(strip=True) for s in skills_els if s.get_text(strip=True)]

    # Country
    country_el = soup.select_one("[data-test='client-location'], .client-location, .company-location")
    if country_el:
        data["country"] = country_el.get_text(strip=True)

    return data

@router.post("/scrape-url", response_model=JobResponse)
async def scrape_job_url(payload: ScrapeUrlRequest, db: AsyncSession = Depends(get_db)):
    """Fetch a real Upwork job page, extract its data, and run the AI pipeline."""
    url = payload.url.strip()
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL format")

    # Extract ciphertext guid from Upwork URL (~<ciphertext> or /jobs/<ciphertext>)
    guid = url.split("~")[-1].split("/")[0] if "~" in url else str(uuid.uuid4())

    # Check deduplication
    existing = await db.execute(select(Job).where(Job.guid == guid))
    existing_job = existing.scalar_one_or_none()
    if existing_job:
        return existing_job

    # Fetch the real Upwork job page
    description = ""
    title = "Imported Upwork Job"
    budget_type = None
    budget_min = None
    budget_max = None
    skills = []
    country = None

    try:
        resp = await asyncio.to_thread(
            curl_requests.get, url,
            impersonate="chrome110",
            timeout=15.0,
        )
        if resp.status_code == 200:
            extracted = _extract_upwork_job_data(resp.text)
            title = extracted["title"] or title
            description = extracted["description"]
            budget_type = extracted["budget_type"]
            budget_min = extracted["budget_min"]
            budget_max = extracted["budget_max"]
            skills = extracted["skills"]
            country = extracted["country"]
    except Exception as e:
        logger.warning(f"Failed to fetch Upwork page for {url}: {e}")

    # Fallback description if scraping yielded nothing
    if not description:
        description = f"Job imported from Upwork link: {url}"

    new_job = Job(
        guid=guid,
        title=title,
        description=description,
        link=url,
        budget_type=budget_type,
        budget_min=budget_min,
        budget_max=budget_max,
        required_skills=skills if skills else ["Full Stack", "Python", "React"],
        client_country=country,
        status="new",
    )
    db.add(new_job)
    await db.flush()

    # Run AI pipeline
    from backend.rss_monitor import _load_profile, MATCH_THRESHOLD
    from backend.ai_engine import process_job_pipeline
    from backend.routers.ws import manager as ws_manager

    profile_data = _load_profile()
    await process_job_pipeline(new_job, profile_data, db, match_threshold=MATCH_THRESHOLD)

    await ws_manager.broadcast({
        "event": "new_job",
        "job_id": str(new_job.id),
        "title": new_job.title,
        "match_score": new_job.match_score,
        "status": new_job.status,
    })

    return new_job
