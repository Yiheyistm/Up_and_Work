"""
System Router.

This module provides endpoints for checking system health and manually
triggering background operations like RSS scans. Also exposes a /status
endpoint that summarizes environment variable presence, poll interval
configuration, and scheduler state — consumed by the Settings → System tab.
A /test-email endpoint performs a fast IMAP login probe so the user can
verify credentials without leaving the dashboard.
"""

import imaplib
import os
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks

from backend.database import AsyncSessionLocal

router = APIRouter()

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _env_present(key: str) -> bool:
    """Return True when an env var is set and non-empty."""
    return bool(os.getenv(key, "").strip())


def _mask(key: str) -> str:
    """Return a masked representation of an env var value for display."""
    val = os.getenv(key, "")
    if not val:
        return ""
    if len(val) <= 8:
        return "••••••••"
    return val[:4] + "••••••••" + val[-4:]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/health")
async def health_check():
    """Simple health check endpoint — returns 200 OK when the backend is running."""
    return {"status": "ok", "service": "Up_and_Work API"}


@router.get("/status")
async def system_status():
    """
    Return a summary of the system's runtime configuration.

    Includes:
    - Whether each required environment variable is set (never exposes raw values)
    - Masked preview of key values for user confirmation
    - Poll interval settings
    - Current server UTC time
    """
    integrations = {
        "gemini": {
            "set": _env_present("GEMINI_API_KEY"),
            "masked": _mask("GEMINI_API_KEY"),
        },
        "telegram_bot": {
            "set": _env_present("TELEGRAM_BOT_TOKEN"),
            "masked": _mask("TELEGRAM_BOT_TOKEN"),
            "chat_id": os.getenv("TELEGRAM_CHAT_ID", ""),
        },
        "imap": {
            "set": _env_present("IMAP_PASSWORD"),
            "email": os.getenv("IMAP_EMAIL", ""),
            "server": os.getenv("IMAP_SERVER", "imap.gmail.com"),
            "masked_password": _mask("IMAP_PASSWORD"),
        },
        "apify": {
            "set": _env_present("APIFY_API_TOKEN"),
            "masked": _mask("APIFY_API_TOKEN"),
        },
        "database": {
            "set": _env_present("DATABASE_URL"),
        },
    }

    config = {
        "poll_interval_seconds": int(os.getenv("POLL_INTERVAL_SECONDS", "60")),
        "email_poll_interval_seconds": int(os.getenv("EMAIL_POLL_INTERVAL_SECONDS", "120")),
        "match_score_threshold": int(os.getenv("MATCH_SCORE_THRESHOLD", "70")),
    }

    return {
        "status": "ok",
        "server_time": datetime.now(timezone.utc).isoformat(),
        "integrations": integrations,
        "config": config,
    }


@router.post("/test-email")
async def test_email_connection():
    """
    Perform a quick IMAP login probe using the credentials stored in env vars.

    Does NOT fetch or store any emails — only tests authentication.
    Returns a success/error status with a human-readable message.
    """
    imap_server = os.getenv("IMAP_SERVER", "imap.gmail.com")
    imap_email = os.getenv("IMAP_EMAIL", "")
    imap_password = os.getenv("IMAP_PASSWORD", "")

    if not imap_email or not imap_password:
        return {
            "success": False,
            "message": "IMAP_EMAIL or IMAP_PASSWORD environment variable is not set.",
        }

    try:
        mail = imaplib.IMAP4_SSL(imap_server, timeout=8)
        mail.login(imap_email, imap_password)
        mail.logout()
        return {
            "success": True,
            "message": f"Successfully connected to {imap_server} as {imap_email}.",
        }
    except imaplib.IMAP4.error as e:
        return {
            "success": False,
            "message": f"IMAP authentication failed: {str(e)}",
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Connection error: {str(e)}",
        }


@router.post("/scan")
async def trigger_manual_scan(background_tasks: BackgroundTasks):
    """
    Manually trigger an RSS feed polling cycle.

    Creates its own DB session (same pattern as the scheduler) and runs
    the full poll_rss_feeds → AI pipeline → WebSocket broadcast chain.
    """
    async def _run_scan():
        from backend.rss_monitor import poll_rss_feeds
        async with AsyncSessionLocal() as db:
            await poll_rss_feeds(db)

    background_tasks.add_task(_run_scan)
    return {"message": "RSS scan triggered. New jobs will appear in real-time."}
