"""
FastAPI Application Entry Point.

This is the main entry point for the Up_and_Work backend application.
It performs the following on startup:
  1. Validates that all required environment variables are present (fail-fast).
  2. Seeds the rss_feeds table from config/profile.json if no feeds exist yet.
  3. Starts the APScheduler background scheduler (RSS + email polling).
  4. Starts the Telegram Bot in async polling mode.

On shutdown it gracefully stops the scheduler and Telegram bot.

All routes are registered under /api/v1/ with WebSocket routes under /ws/.
"""

import os
import json
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from sqlalchemy import select

from backend.database import AsyncSessionLocal
from backend.models import RssFeed
from backend.scheduler import setup_scheduler, shutdown_scheduler
from backend.telegram_bot import get_telegram_application
from backend.routers import jobs, system, proposals, tracker, chat, invites, profile, ws, analytics, auth

# ---------------------------------------------------------------------------
# Required environment variables — the app refuses to start if any are absent.
# ---------------------------------------------------------------------------
REQUIRED_ENV_VARS = [
    "GEMINI_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "DATABASE_URL",
    "IMAP_EMAIL",
    "IMAP_PASSWORD",
    "IMAP_SERVER",
]

def _validate_env() -> None:
    """Check all required env vars and raise a clear error if any are missing."""
    missing = [var for var in REQUIRED_ENV_VARS if not os.environ.get(var)]
    if missing:
        logger.error(
            f"Missing required environment variables: {', '.join(missing)}. "
            "Please fill them in your .env file and restart."
        )
        sys.exit(1)
    logger.info("All required environment variables are present.")


async def _seed_rss_feeds_from_profile() -> None:
    """
    On first startup, read the rss_feeds list from config/profile.json and
    insert any feeds that do not already exist in the database.
    This ensures the scheduler has feeds to poll without manual DB seeding.
    """
    profile_path = Path(__file__).parent.parent / "config" / "profile.json"
    if not profile_path.exists():
        logger.warning("config/profile.json not found — skipping RSS feed seeding.")
        return

    with open(profile_path, "r") as f:
        profile_data = json.load(f)

    feed_urls: list[str] = profile_data.get("rss_feeds", [])
    if not feed_urls:
        logger.warning("No rss_feeds defined in profile.json — no feeds to seed.")
        return

    from backend.rss_monitor import normalize_rss_url

    async with AsyncSessionLocal() as db:
        for raw_url in feed_urls:
            url = normalize_rss_url(raw_url)
            # Check if the feed already exists so we don't duplicate on restart
            existing = await db.execute(select(RssFeed).where(RssFeed.url == url))
            if existing.scalar_one_or_none():
                logger.debug(f"RSS feed already in DB, skipping: {url}")
                continue

            new_feed = RssFeed(url=url, label="Auto-seeded from profile.json", is_active=True)
            db.add(new_feed)
            logger.info(f"Seeded new RSS feed: {url}")

        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application startup and shutdown lifecycle."""
    # --- Startup ---
    logger.info("Starting Up_and_Work Backend...")

    # 1. Validate all required env vars before doing anything else
    _validate_env()

    # 2. Seed RSS feeds from profile.json into the DB if they don't exist
    await _seed_rss_feeds_from_profile()

    # 3. Start APScheduler (RSS polling + email polling)
    setup_scheduler()

    # 4. Start Telegram Bot in async polling mode
    telegram_app = get_telegram_application()
    if telegram_app:
        try:
            await telegram_app.initialize()
            await telegram_app.start()
            # Clear any webhooks/stale sessions before polling to prevent conflicts
            try:
                await telegram_app.bot.delete_webhook(drop_pending_updates=True)
            except Exception:
                pass
            await telegram_app.updater.start_polling(drop_pending_updates=True)
            app.state.telegram_app = telegram_app
            logger.info("Telegram Bot started in polling mode.")
        except Exception as err:
            logger.warning(f"Telegram Bot failed to start polling (another instance may be active): {err}")
            app.state.telegram_app = None
    else:
        app.state.telegram_app = None

    logger.info("Up_and_Work Backend is fully online.")
    yield

    # --- Shutdown ---
    logger.info("Shutting down Up_and_Work Backend...")
    shutdown_scheduler()

    if app.state.telegram_app:
        await app.state.telegram_app.updater.stop()
        await app.state.telegram_app.stop()
        await app.state.telegram_app.shutdown()

    logger.info("Shutdown complete.")


app = FastAPI(
    title="Up_and_Work API",
    description="AI-powered Upwork Job Monitoring & Proposal Generation Assistant",
    version="1.0.0",
    lifespan=lifespan,
)

# Configure CORS — restrict allow_origins strictly to trusted domains
_frontend_url = os.environ.get("FRONTEND_URL", "https://up-and-work.vercel.app")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://up-and-work.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        _frontend_url,
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# REST Routers
app.include_router(system.router,    prefix="/api/v1/system",    tags=["System"])
app.include_router(jobs.router,      prefix="/api/v1/jobs",      tags=["Jobs"])
app.include_router(proposals.router, prefix="/api/v1/proposals", tags=["Proposals"])
app.include_router(tracker.router,   prefix="/api/v1/tracker",   tags=["Tracker"])
app.include_router(chat.router,      prefix="/api/v1/chat",      tags=["Chat"])
app.include_router(invites.router,   prefix="/api/v1/invites",   tags=["Invites"])
app.include_router(profile.router,   prefix="/api/v1/profile",   tags=["Profile"])
app.include_router(auth.router,      prefix="/api/v1/auth",      tags=["Auth"])

app.include_router(analytics.router, prefix="/api/v1/analytics", tags=["Analytics"])

# WebSocket Routers
app.include_router(ws.router, prefix="/ws", tags=["WebSockets"])


@app.get("/")
async def root():
    return {"message": "Up_and_Work API is running. Visit /docs for the API reference."}
