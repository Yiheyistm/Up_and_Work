"""
Background Job Scheduler.

This module uses APScheduler to run background tasks periodically.
It schedules the RSS feed polling and IMAP email polling to run automatically
at specified intervals, removing the need for manual triggering.
"""

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
    
    scheduler.start()
    logger.info(f"Scheduler started. RSS poll every {POLL_INTERVAL}s, Email poll every {EMAIL_POLL_INTERVAL}s.")

def shutdown_scheduler():
    """Stops the scheduler gracefully."""
    scheduler.shutdown()
    logger.info("Scheduler stopped.")
