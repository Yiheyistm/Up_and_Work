"""
Background Job Scheduler.

This module uses APScheduler to run background tasks periodically.
It schedules the RSS feed polling and IMAP email polling to run automatically
at specified intervals, removing the need for manual triggering.
"""

import asyncio
import os
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from loguru import logger
from backend.rss_monitor import poll_rss_feeds
from backend.email_monitor import process_email_inbox
from backend.database import AsyncSessionLocal

_poll_val = os.environ.get("POLL_INTERVAL_SECONDS", "")
_email_poll_val = os.environ.get("EMAIL_POLL_INTERVAL_SECONDS", "")

POLL_INTERVAL = int(_poll_val.strip()) if _poll_val and _poll_val.strip().isdigit() else 60
EMAIL_POLL_INTERVAL = int(_email_poll_val.strip()) if _email_poll_val and _email_poll_val.strip().isdigit() else 120

scheduler = AsyncIOScheduler()

async def scheduled_rss_poll():
    """Wrapper to run RSS polling with a new database session."""
    logger.debug("Running scheduled RSS poll...")
    async with AsyncSessionLocal() as session:
        await poll_rss_feeds(session)

async def scheduled_email_poll():
    """Wrapper to run email polling with a new database session."""
    logger.debug("Running scheduled email poll...")
    async with AsyncSessionLocal() as session:
        await process_email_inbox(session)

async def scheduled_keep_alive():
    """Self-ping health endpoint to keep hosting service (e.g. Render free tier) awake."""
    raw_url = os.environ.get("KEEP_ALIVE_URL") or os.environ.get("RENDER_EXTERNAL_URL") or os.environ.get("BACKEND_URL", "")
    if not raw_url:
        return
    url = raw_url.strip()
    if not url.endswith("/api/v1/system/health"):
        url = url.rstrip("/") + "/api/v1/system/health"
    try:
        def _ping():
            import urllib.request
            req = urllib.request.Request(url, headers={"User-Agent": "Up_and_Work-KeepAlive/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status
        status = await asyncio.to_thread(_ping)
        logger.debug(f"Keep-alive ping to {url} returned HTTP {status}")
    except Exception as err:
        logger.warning(f"Keep-alive ping to {url} failed: {err}")

def setup_scheduler():
    """Configures and starts the background scheduler."""
    scheduler.add_job(
        scheduled_rss_poll, 
        'interval', 
        seconds=POLL_INTERVAL, 
        id="rss_poll_job", 
        replace_existing=True
    )
    
    scheduler.add_job(
        scheduled_email_poll, 
        'interval', 
        seconds=EMAIL_POLL_INTERVAL, 
        id="email_poll_job", 
        replace_existing=True
    )

    keep_alive_target = os.environ.get("KEEP_ALIVE_URL") or os.environ.get("RENDER_EXTERNAL_URL") or os.environ.get("BACKEND_URL", "")
    if keep_alive_target:
        scheduler.add_job(
            scheduled_keep_alive,
            'interval',
            minutes=10,
            id="keep_alive_job",
            replace_existing=True
        )
        logger.info(f"Keep-alive job scheduled for {keep_alive_target} every 10 minutes.")
    
    scheduler.start()
    logger.info(f"Scheduler started. RSS poll every {POLL_INTERVAL}s, Email poll every {EMAIL_POLL_INTERVAL}s.")

def shutdown_scheduler():
    """Stops the scheduler gracefully."""
    scheduler.shutdown()
    logger.info("Scheduler stopped.")

