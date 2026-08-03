"""
Email IMAP Polling for Upwork Invites and Messages.

This module connects to an IMAP email account (e.g., Gmail) to monitor for
new official Upwork notifications (Invites, Messages, Offers, Shortlisted).

For each new Upwork email it:
  1. Parses the email subject and HTML body.
  2. Extracts the first Upwork link from the email body.
  3. Classifies the notification type (invitation / message / offer).
  4. Saves an InviteNotification record to the database.
  5. Immediately sends a Telegram push notification via send_invite_alert().

Credentials are read from environment variables: IMAP_EMAIL, IMAP_PASSWORD,
IMAP_SERVER. The module gracefully skips polling if any are missing.
"""

import asyncio
import email
import imaplib
import os
from email.header import decode_header

from bs4 import BeautifulSoup
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import InviteNotification

IMAP_EMAIL = os.environ.get("IMAP_EMAIL")
IMAP_PASSWORD = os.environ.get("IMAP_PASSWORD")
IMAP_SERVER = os.environ.get("IMAP_SERVER")


def _parse_subject(header_subject) -> str:
    """Decode an RFC2047-encoded email subject header into a plain string."""
    subject, encoding = decode_header(header_subject)[0]
    if isinstance(subject, bytes):
        return subject.decode(encoding if encoding else "utf-8", errors="ignore")
    return str(subject)


def _extract_upwork_link(html_content: str) -> str | None:
    """Return the first href pointing to upwork.com found in the email HTML."""
    if not html_content:
        return None
    soup = BeautifulSoup(html_content, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "upwork.com" in href:
            return href
    return None


def _extract_email_summary(html_content: str) -> str:
    """Extract a clean plain-text summary preview (up to 220 chars) from the email HTML body."""
    if not html_content:
        return ""
    soup = BeautifulSoup(html_content, "html.parser")
    for elem in soup(["script", "style", "head", "title"]):
        elem.extract()
    text = soup.get_text(separator=" ", strip=True)
    clean_text = " ".join(text.split())
    if len(clean_text) > 220:
        return clean_text[:220] + "..."
    return clean_text


async def poll_email_invites(db: AsyncSession) -> int:
    """
    Poll the IMAP inbox for Upwork emails, extract details, deduplicate,
    and save InviteNotification records. Returns the count of new invites saved.
    """
    if not all([IMAP_EMAIL, IMAP_PASSWORD, IMAP_SERVER]):
        logger.warning("IMAP credentials missing — skipping email polling.")
        return 0

    from backend.telegram_bot import send_invite_alert
    from sqlalchemy import select

    new_saved_count = 0
    try:
        mail = await asyncio.to_thread(_connect_imap)
        if mail is None:
            return 0

        mail_ids = await asyncio.to_thread(_fetch_unseen_ids, mail)
        if not mail_ids:
            await asyncio.to_thread(mail.logout)
            return 0

        logger.info(f"Email monitor: Processing {len(mail_ids)} Upwork email(s).")

        for email_id in mail_ids:
            raw = await asyncio.to_thread(_fetch_email, mail, email_id)
            if raw is None:
                continue

            msg = email.message_from_bytes(raw)
            subject = _parse_subject(msg.get("Subject", "No Subject"))

            # Deduplicate against existing DB records
            existing_res = await db.execute(
                select(InviteNotification).where(InviteNotification.parsed_title == subject)
            )
            if existing_res.scalars().first() is not None:
                continue

            # Extract HTML body
            html_content = ""
            if msg.is_multipart():
                for part in msg.walk():
                    if part.get_content_type() == "text/html":
                        html_content = part.get_payload(decode=True).decode(errors="ignore")
                        break
            else:
                if msg.get_content_type() == "text/html":
                    html_content = msg.get_payload(decode=True).decode(errors="ignore")

            invite_url = _extract_upwork_link(html_content)

            # Skip system / marketing / security administrative email noise
            SYSTEM_IGNORE_KEYWORDS = [
                "privacy policy", "user agreement", "unknown device", "login",
                "security question", "was added", "verification request",
                "service fees", "freelancer plus", "profile is no longer",
                "secret to winning", "coaching office hours", "betterhelp",
                "tips to improve", "top 1%", "3x your chance", "make your profile",
                "job success insights", "app just got an upgrade", "app is up to date",
                "ask uma", "connects to submit", "stay visible", "payment received"
            ]
            if any(kw in subject_lower for kw in SYSTEM_IGNORE_KEYWORDS):
                continue

            # Classify notification type based on subject keywords
            if "invitation" in subject_lower:
                source_type = "invitation"
            elif "message" in subject_lower:
                source_type = "message"
            elif "offer" in subject_lower:
                source_type = "offer"
            else:
                source_type = "email"

            # Persist to DB
            notification = InviteNotification(
                source=source_type,
                raw_content=html_content[:5000],
                parsed_title=subject,
                summary=_extract_email_summary(html_content),
                invite_url=invite_url,
                notified_web=False,
            )
            db.add(notification)
            new_saved_count += 1
            logger.info(f"InviteNotification saved: [{source_type}] {subject}")

            # Push Telegram alert for new items
            try:
                await send_invite_alert(
                    subject=subject,
                    source_type=source_type,
                    invite_url=invite_url,
                )
            except Exception as tg_err:
                logger.warning(f"Telegram alert skipped: {tg_err}")

        await db.commit()
        await asyncio.to_thread(mail.logout)
        return new_saved_count

    except Exception as e:
        logger.error(f"Error in email monitor: {e}")
        await db.rollback()
        return 0


async def process_email_inbox(db: AsyncSession) -> None:
    """Cron/Background wrapper for email polling."""
    await poll_email_invites(db)


def _connect_imap():
    """Synchronous helper to establish and authenticate an IMAP connection."""
    try:
        mail = imaplib.IMAP4_SSL(IMAP_SERVER)
        mail.login(IMAP_EMAIL, IMAP_PASSWORD)
        mail.select("inbox")
        return mail
    except Exception as e:
        logger.error(f"IMAP connection failed: {e}")
        return None


def _fetch_unseen_ids(mail) -> list[bytes] | None:
    """Fetch unseen or recent Upwork email IDs."""
    try:
        status, messages = mail.search(None, '(UNSEEN FROM "upwork.com")')
        if status == "OK" and messages[0].split():
            return messages[0].split()

        # Fallback to recent Upwork emails
        status, messages = mail.search(None, '(FROM "upwork.com")')
        if status == "OK" and messages[0].split():
            return messages[0].split()[-30:]
        return []
    except Exception as e:
        logger.error(f"IMAP search failed: {e}")
        return []


def _fetch_email(mail, email_id: bytes) -> bytes | None:
    """Fetch raw RFC822 bytes for a single email ID; returns None on failure."""
    try:
        status, msg_data = mail.fetch(email_id, "(RFC822)")
        for response_part in msg_data:
            if isinstance(response_part, tuple):
                return response_part[1]
        return None
    except Exception as e:
        logger.error(f"IMAP fetch failed for {email_id}: {e}")
        return None


def _mark_seen(mail, mail_ids: list[bytes]) -> None:
    """Mark a list of email IDs as read."""
    for email_id in mail_ids:
        try:
            mail.store(email_id, "+FLAGS", "\\Seen")
        except Exception as e:
            logger.warning(f"Failed to mark {email_id} as seen: {e}")
