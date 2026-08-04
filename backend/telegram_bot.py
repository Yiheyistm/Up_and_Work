"""
Telegram Bot Interface and Command Handlers.

This module sets up the asynchronous Telegram bot using `python-telegram-bot`.
It implements a fully interactive, UI-driven Telegram Bot using Inline Keyboards.
Users can trigger scans, view job cards, inspect AI proposal drafts, and toggle
job statuses (Applied/Ignored) with a single tap.
"""

import os
import html
import json
import asyncio
from loguru import logger
from google import genai
from telegram import Update, Bot, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo, MenuButtonWebApp, MenuButtonCommands
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, ContextTypes
from telegram.constants import ChatAction

from backend.database import AsyncSessionLocal
from backend.models import Job, RssFeed, ProposalDraft

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID")
MATCH_THRESHOLD = int(os.environ.get("MATCH_SCORE_THRESHOLD", "70"))


def get_webapp_url() -> str:
    """Return the active WebApp URL, stripping expired localtunnel/ngrok domains."""
    url = os.environ.get("TELEGRAM_WEBAPP_URL", "https://up-and-work.vercel.app").strip()
    if not url or "loca.lt" in url or "ngrok" in url:
        return "https://up-and-work.vercel.app"
    return url


def _main_menu_keyboard() -> InlineKeyboardMarkup:
    """Build the persistent interactive control panel keyboard."""
    keyboard = []

    webapp_target = get_webapp_url()
    keyboard.append([
        InlineKeyboardButton("🌐 Open UpandWork App", web_app=WebAppInfo(url=webapp_target))
    ])

    keyboard.extend([
        [
            InlineKeyboardButton("📡 Scan Now", callback_data="cb_scan"),
            InlineKeyboardButton("🎯 Top Jobs", callback_data="cb_jobs"),
        ],
        [
            InlineKeyboardButton("📊 System Status", callback_data="cb_status"),
            InlineKeyboardButton("❓ Help", callback_data="cb_help"),
        ],
    ])
    return InlineKeyboardMarkup(keyboard)


def _job_action_keyboard(job_id: str, current_status: str, link: str | None = None) -> InlineKeyboardMarkup:
    """Build inline buttons for a specific job card."""
    short_id = str(job_id)[:8]

    # Row 1: Details & Proposal
    row1 = [
        InlineKeyboardButton("📖 Details", callback_data=f"cb_det_{short_id}"),
        InlineKeyboardButton("📝 Proposal", callback_data=f"cb_prop_{short_id}"),
    ]

    # Row 2: Status toggles
    row2 = []
    if current_status != "applied":
        row2.append(InlineKeyboardButton("✅ Mark Applied", callback_data=f"cb_st_applied_{short_id}"))
    else:
        row2.append(InlineKeyboardButton("✅ Applied", callback_data="noop"))

    if current_status != "ignored":
        row2.append(InlineKeyboardButton("🚫 Ignore", callback_data=f"cb_st_ignored_{short_id}"))
    else:
        row2.append(InlineKeyboardButton("🚫 Ignored", callback_data="noop"))

    keyboard = [row1, row2]

    # Row 3: Upwork direct link if available
    if link:
        keyboard.append([InlineKeyboardButton("🔗 Open on Upwork", url=link)])

    return InlineKeyboardMarkup(keyboard)


# ---------------------------------------------------------------------------
# Command Handlers (UI Entry Points)
# ---------------------------------------------------------------------------

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start — welcome UI dashboard."""
    welcome_text = (
        "🤖 <b>Up_and_Work AI Copilot Dashboard</b>\n\n"
        "Welcome! I am your interactive Upwork monitoring copilot.\n"
        "Use the control panel buttons below to manage jobs, trigger scans, and view AI proposals."
    )
    await update.message.reply_text(
        welcome_text,
        parse_mode="HTML",
        reply_markup=_main_menu_keyboard(),
    )


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /help — UI control panel with instructions."""
    help_text = (
        "🛠️ <b>Up_and_Work UI Control Panel</b>\n\n"
        "• Tap <b>📡 Scan Now</b> to trigger a live Apify search.\n"
        "• Tap <b>🎯 Top Jobs</b> to inspect current high-match opportunities.\n"
        "• Tap <b>📊 System Status</b> for database and engine stats.\n"
        "• Each job notification has interactive buttons to view details, inspect proposals, or update status."
    )
    await update.message.reply_text(
        help_text,
        parse_mode="HTML",
        reply_markup=_main_menu_keyboard(),
    )


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /status — query live DB stats and report system health."""
    await update.message.reply_chat_action(ChatAction.TYPING)

    from sqlalchemy import select, func

    try:
        async with AsyncSessionLocal() as db:
            total_jobs = (await db.execute(select(func.count()).select_from(Job))).scalar_one()
            shortlisted = (await db.execute(select(func.count()).select_from(Job).where(Job.status == "shortlisted"))).scalar_one()
            applied = (await db.execute(select(func.count()).select_from(Job).where(Job.status == "applied"))).scalar_one()
            active_feeds = (await db.execute(select(func.count()).select_from(RssFeed).where(RssFeed.is_active == True))).scalar_one()

        status_text = (
            "📊 <b>System Status</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            "🟢 <b>Backend State:</b> Online\n"
            f"📡 <b>Active Feeds:</b> {active_feeds}\n"
            f"📁 <b>Total Jobs Scanned:</b> {total_jobs}\n"
            f"🎯 <b>Shortlisted (≥{MATCH_THRESHOLD}%):</b> {shortlisted}\n"
            f"📤 <b>Applied:</b> {applied}\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            "✅ <b>Scheduler &amp; AI Engine:</b> Active"
        )
        await update.message.reply_text(status_text, parse_mode="HTML", reply_markup=_main_menu_keyboard())

    except Exception as e:
        logger.error(f"Telegram /status command error: {e}")
        await update.message.reply_text(f"❌ Error: {html.escape(str(e))}")


async def cmd_scan(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /scan — trigger live scan."""
    await update.message.reply_chat_action(ChatAction.TYPING)
    msg = await update.message.reply_text("📡 <b>Scan initiated...</b> Querying Apify search feeds.", parse_mode="HTML")

    try:
        from backend.rss_monitor import poll_rss_feeds
        async with AsyncSessionLocal() as db:
            await poll_rss_feeds(db)
        await msg.edit_text("✅ <b>Scan complete!</b> New high-match jobs are updated.", parse_mode="HTML", reply_markup=_main_menu_keyboard())
    except Exception as e:
        logger.error(f"Telegram /scan error: {e}")
        await msg.edit_text(f"❌ Scan failed: {html.escape(str(e))}")


async def cmd_jobs(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /jobs — render interactive cards for top jobs."""
    await update.message.reply_chat_action(ChatAction.TYPING)

    from sqlalchemy import select, desc

    try:
        async with AsyncSessionLocal() as db:
            stmt = (
                select(Job)
                .where(Job.match_score >= MATCH_THRESHOLD)
                .order_by(desc(Job.match_score))
                .limit(5)
            )
            result = await db.execute(stmt)
            jobs = result.scalars().all()

        if not jobs:
            await update.message.reply_text(
                f"No high-match jobs (≥{MATCH_THRESHOLD}%) found yet. Tap <b>Scan Now</b> to fetch fresh jobs.",
                parse_mode="HTML",
                reply_markup=_main_menu_keyboard()
            )
            return

        await update.message.reply_text(
            f"🎯 <b>Top Matched Jobs ({len(jobs)})</b>\nTap any card below for details, AI proposal, or status actions:",
            parse_mode="HTML"
        )

        for job in jobs:
            emoji = "🟢" if job.match_score >= 80 else "🟡"
            budget = (
                f"${job.budget_min}-{job.budget_max}/hr"
                if job.budget_type == "Hourly"
                else f"${job.budget_min or '?'}"
            )
            card_text = (
                f"{emoji} <b>{html.escape(job.title)}</b>\n"
                f"🎯 Match: <b>{job.match_score}%</b> | 💰 {budget}\n"
                f"📊 Status: <b>{job.status.upper()}</b>"
            )
            await update.message.reply_text(
                card_text,
                parse_mode="HTML",
                reply_markup=_job_action_keyboard(str(job.id), job.status, job.link)
            )

    except Exception as e:
        logger.error(f"Telegram /jobs error: {e}")
        await update.message.reply_text(f"❌ Error fetching jobs: {html.escape(str(e))}")


async def cmd_job(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /job <id_prefix> — show details."""
    await update.message.reply_chat_action(ChatAction.TYPING)
    if not context.args:
        await update.message.reply_text("Usage: /job <code>&lt;job-id&gt;</code>", parse_mode="HTML")
        return
    job_id_prefix = context.args[0]

    from sqlalchemy import select
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Job))
            matched = [j for j in result.scalars().all() if str(j.id).startswith(job_id_prefix)]

        if not matched:
            await update.message.reply_text(f"❌ No job found starting with <code>{html.escape(job_id_prefix)}</code>", parse_mode="HTML")
            return

        job = matched[0]
        skills_str = html.escape(", ".join(job.required_skills[:5])) if job.required_skills else "—"
        red_flags_str = html.escape(f"⚠️ {', '.join(job.red_flags[:3])}") if job.red_flags else "None"

        detail_text = (
            f"📌 <b>{html.escape(job.title)}</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━━━\n"
            f"🎯 Match Score: <b>{job.match_score or 'Pending'}%</b>\n"
            f"💰 Budget: {job.budget_type} — ${job.budget_min or '?'}\n"
            f"🌍 Country: {html.escape(job.client_country or 'Unknown')}\n"
            f"🔧 Skills: {skills_str}\n"
            f"🚩 Red Flags: {red_flags_str}\n"
            f"📊 Status: <b>{job.status.upper()}</b>"
        )
        await update.message.reply_text(detail_text, parse_mode="HTML", reply_markup=_job_action_keyboard(str(job.id), job.status, job.link))
    except Exception as e:
        logger.error(f"Telegram /job error: {e}")
        await update.message.reply_text(f"❌ Error: {html.escape(str(e))}")


async def cmd_apply(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /apply <id_prefix>."""
    await _set_job_status(update, context, "applied", "✅ Marked as <b>Applied</b>!")


async def cmd_ignore(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /ignore <id_prefix>."""
    await _set_job_status(update, context, "ignored", "🚫 Marked as <b>Ignored</b>.")


async def _set_job_status(update, context, new_status: str, reply_msg: str) -> None:
    if not context.args:
        await update.message.reply_text(f"Usage: /{new_status} <code>&lt;job-id&gt;</code>", parse_mode="HTML")
        return
    job_id_prefix = context.args[0]
    from sqlalchemy import select
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Job))
            matched = [j for j in result.scalars().all() if str(j.id).startswith(job_id_prefix)]
            if not matched:
                await update.message.reply_text(f"❌ No job found starting with <code>{html.escape(job_id_prefix)}</code>", parse_mode="HTML")
                return
            job = matched[0]
            job.status = new_status
            await db.commit()
        await update.message.reply_text(f"{reply_msg}\n<b>{html.escape(job.title)}</b>", parse_mode="HTML")
    except Exception as e:
        logger.error(f"Telegram status update error: {e}")
        await update.message.reply_text(f"❌ Error: {html.escape(str(e))}")


# ---------------------------------------------------------------------------
# Interactive Callback Query Handler (Button Clicks)
# ---------------------------------------------------------------------------

async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Central interactive button handler for all Inline Keyboard clicks."""
    query = update.callback_query
    if not query:
        return

    data = query.data
    if data == "noop":
        await query.answer()
        return

    from sqlalchemy import select

    # --- Main Menu Callbacks ---
    if data == "cb_scan":
        await query.answer("📡 Starting live Apify scan...")
        await query.edit_message_text("📡 <b>Scan initiated...</b> Scraping live search feeds via Apify.", parse_mode="HTML")
        try:
            from backend.rss_monitor import poll_rss_feeds
            async with AsyncSessionLocal() as db:
                await poll_rss_feeds(db)
            await query.edit_message_text("✅ <b>Scan complete!</b> Tap <b>Top Jobs</b> to see fresh matches.", parse_mode="HTML", reply_markup=_main_menu_keyboard())
        except Exception as e:
            await query.edit_message_text(f"❌ Scan failed: {html.escape(str(e))}", parse_mode="HTML", reply_markup=_main_menu_keyboard())
        return

    elif data == "cb_jobs":
        await query.answer()
        async with AsyncSessionLocal() as db:
            stmt = select(Job).where(Job.match_score >= MATCH_THRESHOLD).order_by(Job.match_score.desc()).limit(5)
            jobs = (await db.execute(stmt)).scalars().all()

        if not jobs:
            await query.edit_message_text(
                f"No high-match jobs (≥{MATCH_THRESHOLD}%) found yet.",
                parse_mode="HTML",
                reply_markup=_main_menu_keyboard()
            )
            return

        await query.edit_message_text("🎯 <b>Top Matched Jobs</b> (Tap buttons on cards below to interact):", parse_mode="HTML")
        for job in jobs:
            emoji = "🟢" if job.match_score >= 80 else "🟡"
            budget = f"${job.budget_min}-{job.budget_max}/hr" if job.budget_type == "Hourly" else f"${job.budget_min or '?'}"
            card_text = (
                f"{emoji} <b>{html.escape(job.title)}</b>\n"
                f"🎯 Match: <b>{job.match_score}%</b> | 💰 {budget}\n"
                f"📊 Status: <b>{job.status.upper()}</b>"
            )
            await query.message.reply_text(
                card_text,
                parse_mode="HTML",
                reply_markup=_job_action_keyboard(str(job.id), job.status, job.link)
            )
        return

    elif data == "cb_status":
        await query.answer()
        async with AsyncSessionLocal() as db:
            from sqlalchemy import func
            total_jobs = (await db.execute(select(func.count()).select_from(Job))).scalar_one()
            shortlisted = (await db.execute(select(func.count()).select_from(Job).where(Job.status == "shortlisted"))).scalar_one()
            applied = (await db.execute(select(func.count()).select_from(Job).where(Job.status == "applied"))).scalar_one()

        status_text = (
            "📊 <b>System Status</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            "🟢 <b>Backend:</b> Online\n"
            f"📁 <b>Total Jobs Scanned:</b> {total_jobs}\n"
            f"🎯 <b>Shortlisted:</b> {shortlisted}\n"
            f"📤 <b>Applied:</b> {applied}\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            "✅ <b>Scheduler &amp; AI Engine:</b> Active"
        )
        await query.edit_message_text(status_text, parse_mode="HTML", reply_markup=_main_menu_keyboard())
        return

    elif data == "cb_help":
        await query.answer()
        help_text = (
            "🛠️ <b>Up_and_Work UI Control Panel</b>\n\n"
            "• Tap <b>📡 Scan Now</b> to trigger a live Apify search.\n"
            "• Tap <b>🎯 Top Jobs</b> to inspect current high-match opportunities.\n"
            "• Use card buttons below job cards to view full details or proposals."
        )
        await query.edit_message_text(help_text, parse_mode="HTML", reply_markup=_main_menu_keyboard())
        return

    # --- Job-Specific Callbacks ---
    if data.startswith("cb_det_"):
        short_id = data.replace("cb_det_", "")
        await query.answer("Loading details...")
        async with AsyncSessionLocal() as db:
            jobs = (await db.execute(select(Job))).scalars().all()
            matched = [j for j in jobs if str(j.id).startswith(short_id)]

        if not matched:
            await query.answer("❌ Job not found in database", show_alert=True)
            return

        job = matched[0]
        skills_str = html.escape(", ".join(job.required_skills[:5])) if job.required_skills else "—"
        red_flags_str = html.escape(f"⚠️ {', '.join(job.red_flags[:3])}") if job.red_flags else "None"

        detail_text = (
            f"📌 <b>{html.escape(job.title)}</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━━━\n"
            f"🎯 Match Score: <b>{job.match_score or 'Pending'}%</b>\n"
            f"💰 Budget: {job.budget_type} — ${job.budget_min or '?'}\n"
            f"🌍 Country: {html.escape(job.client_country or 'Unknown')}\n"
            f"🔧 Skills: {skills_str}\n"
            f"🚩 Red Flags: {red_flags_str}\n"
            f"📊 Status: <b>{job.status.upper()}</b>"
        )

        await query.message.reply_text(
            detail_text,
            parse_mode="HTML",
            reply_markup=_job_action_keyboard(str(job.id), job.status, job.link)
        )
        return

    elif data.startswith("cb_prop_"):
        short_id = data.replace("cb_prop_", "")
        await query.answer("Fetching proposal...")
        async with AsyncSessionLocal() as db:
            jobs = (await db.execute(select(Job))).scalars().all()
            matched = [j for j in jobs if str(j.id).startswith(short_id)]

            if not matched:
                await query.answer("❌ Job not found", show_alert=True)
                return

            job = matched[0]
            prop_res = await db.execute(select(ProposalDraft).where(ProposalDraft.job_id == job.id))
            proposal = prop_res.scalar_one_or_none()

        if not proposal:
            await query.answer("ℹ️ No proposal generated for this job yet.", show_alert=True)
            return

        prop_text = (
            f"📝 <b>AI Proposal Draft for {html.escape(job.title[:30])}...</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            f"{html.escape(proposal.cover_letter)}\n"
        )

        if len(prop_text) > 4000:
            prop_text = prop_text[:3900] + "\n\n<i>[Truncated...]</i>"

        back_kb = InlineKeyboardMarkup([
            [InlineKeyboardButton("🔙 Back to Job", callback_data=f"cb_det_{short_id}")]
        ])
        await query.message.reply_text(prop_text, parse_mode="HTML", reply_markup=back_kb)
        return

    elif data.startswith("cb_st_"):
        # Format: cb_st_applied_17855946
        parts = data.split("_")
        new_status = parts[2]
        short_id = parts[3]

        async with AsyncSessionLocal() as db:
            jobs = (await db.execute(select(Job))).scalars().all()
            matched = [j for j in jobs if str(j.id).startswith(short_id)]

            if matched:
                job = matched[0]
                job.status = new_status
                await db.commit()

                await query.answer(f"Status updated to {new_status.upper()}!", show_alert=False)

                emoji = "🟢" if job.match_score and job.match_score >= 80 else "🟡"
                budget = f"${job.budget_min}-{job.budget_max}/hr" if job.budget_type == "Hourly" else f"${job.budget_min or '?'}"
                updated_card_text = (
                    f"{emoji} <b>{html.escape(job.title)}</b>\n"
                    f"🎯 Match: <b>{job.match_score}%</b> | 💰 {budget}\n"
                    f"📊 Status: <b>{job.status.upper()}</b>"
                )
                try:
                    await query.edit_message_text(
                        updated_card_text,
                        parse_mode="HTML",
                        reply_markup=_job_action_keyboard(str(job.id), job.status, job.link)
                    )
                except Exception:
                    pass
            else:
                await query.answer("❌ Job not found", show_alert=True)


async def cmd_proposal(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /proposal <id> — show the full AI-generated proposal for a job."""
    await update.message.reply_chat_action(ChatAction.TYPING)

    if not context.args:
        await update.message.reply_text("Usage: /proposal <code>&lt;job-id&gt;</code>", parse_mode="HTML")
        return

    job_id_prefix = context.args[0]

    from sqlalchemy import select

    try:
        async with AsyncSessionLocal() as db:
            jobs = (await db.execute(select(Job))).scalars().all()
            matched = [j for j in jobs if str(j.id).startswith(job_id_prefix)]

        if not matched:
            await update.message.reply_text(f"❌ No job found starting with <code>{html.escape(job_id_prefix)}</code>", parse_mode="HTML")
            return

        job = matched[0]
        prop_res = await db.execute(select(ProposalDraft).where(ProposalDraft.job_id == job.id).order_by(ProposalDraft.version.desc()))
        proposal = prop_res.scalar_one_or_none()

        if not proposal:
            await update.message.reply_text(f"ℹ️ No proposal generated yet for <b>{html.escape(job.title[:40])}</b>.", parse_mode="HTML")
            return

        prop_text = (
            f"📝 <b>AI Proposal — {html.escape(job.title[:40])}...</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            f"{html.escape(proposal.cover_letter)}\n"
        )

        if len(prop_text) > 4000:
            prop_text = prop_text[:3900] + "\n\n<i>[Truncated...]</i>"

        await update.message.reply_text(prop_text, parse_mode="HTML")

    except Exception as e:
        logger.error(f"Telegram /proposal error: {e}")
        await update.message.reply_text(f"❌ Error: {html.escape(str(e))}")


async def cmd_shortlist(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /shortlist <id> — mark a job as shortlisted."""
    await _set_job_status(update, context, "shortlisted", "✅ Marked as <b>Shortlisted</b>!")


async def cmd_track(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /track <id> <status> — update a job's status to any valid value."""
    if not context.args or len(context.args) < 2:
        await update.message.reply_text(
            "Usage: /track <code>&lt;job-id&gt;</code> &lt;status&gt;\n"
            "Statuses: new, shortlisted, applied, invited, interviewing, hired, rejected, ignored",
            parse_mode="HTML",
        )
        return

    job_id_prefix = context.args[0]
    new_status = context.args[1].lower()
    valid_statuses = {"new", "shortlisted", "applied", "invited", "interviewing", "hired", "rejected", "ignored"}

    if new_status not in valid_statuses:
        await update.message.reply_text(
            f"❌ Invalid status <code>{html.escape(new_status)}</code>.\n"
            f"Valid: {', '.join(sorted(valid_statuses))}",
            parse_mode="HTML",
        )
        return

    from sqlalchemy import select

    try:
        async with AsyncSessionLocal() as db:
            jobs = (await db.execute(select(Job))).scalars().all()
            matched = [j for j in jobs if str(j.id).startswith(job_id_prefix)]

            if not matched:
                await update.message.reply_text(f"❌ No job found starting with <code>{html.escape(job_id_prefix)}</code>", parse_mode="HTML")
                return

            job = matched[0]
            job.status = new_status
            await db.commit()

        await update.message.reply_text(
            f"📊 Status updated to <b>{new_status.upper()}</b> for <b>{html.escape(job.title[:40])}</b>",
            parse_mode="HTML",
        )

    except Exception as e:
        logger.error(f"Telegram /track error: {e}")
        await update.message.reply_text(f"❌ Error: {html.escape(str(e))}")


async def cmd_note(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /note <id> <text> — add a tracking note to a job."""
    if not context.args or len(context.args) < 2:
        await update.message.reply_text("Usage: /note <code>&lt;job-id&gt;</code> <text>", parse_mode="HTML")
        return

    job_id_prefix = context.args[0]
    note_text = " ".join(context.args[1:])

    from backend.models import JobTrackingEvent
    from sqlalchemy import select

    try:
        async with AsyncSessionLocal() as db:
            jobs = (await db.execute(select(Job))).scalars().all()
            matched = [j for j in jobs if str(j.id).startswith(job_id_prefix)]

            if not matched:
                await update.message.reply_text(f"❌ No job found starting with <code>{html.escape(job_id_prefix)}</code>", parse_mode="HTML")
                return

            job = matched[0]
            event = JobTrackingEvent(job_id=job.id, event_type="note", note=note_text, metadata_json={})
            db.add(event)
            await db.commit()

        await update.message.reply_text(
            f"📝 Note added to <b>{html.escape(job.title[:40])}</b>:\n<i>{html.escape(note_text)}</i>",
            parse_mode="HTML",
        )

    except Exception as e:
        logger.error(f"Telegram /note error: {e}")
        await update.message.reply_text(f"❌ Error: {html.escape(str(e))}")


async def cmd_invites(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /invites — list recent Upwork invite notifications."""
    await update.message.reply_chat_action(ChatAction.TYPING)

    from sqlalchemy import select, desc

    try:
        async with AsyncSessionLocal() as db:
            stmt = select(Job).where(Job.status == "invited").order_by(desc(Job.updated_at)).limit(10)
            invited_jobs = (await db.execute(stmt)).scalars().all()

        if not invited_jobs:
            await update.message.reply_text("No invited jobs found yet.", parse_mode="HTML")
            return

        lines = ["🎉 <b>Invited Jobs</b>\n"]
        for job in invited_jobs:
            emoji = "🟢" if job.match_score and job.match_score >= 80 else "🟡"
            lines.append(f"{emoji} <b>{html.escape(job.title[:45])}</b> — {job.match_score or '?'}%\n")

        await update.message.reply_text("\n".join(lines), parse_mode="HTML")

    except Exception as e:
        logger.error(f"Telegram /invites error: {e}")
        await update.message.reply_text(f"❌ Error: {html.escape(str(e))}")


async def cmd_threshold(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /threshold <n> — change the match score threshold."""
    global MATCH_THRESHOLD
    if not context.args:
        await update.message.reply_text(
            f"Current match threshold: <b>{MATCH_THRESHOLD}%</b>\nUsage: /threshold &lt;n&gt;",
            parse_mode="HTML",
        )
        return

    try:
        new_threshold = int(context.args[0])
        if not 0 <= new_threshold <= 100:
            raise ValueError
    except ValueError:
        await update.message.reply_text("❌ Please provide a number between 0 and 100.", parse_mode="HTML")
        return

    os.environ["MATCH_SCORE_THRESHOLD"] = str(new_threshold)
    MATCH_THRESHOLD = new_threshold

    await update.message.reply_text(
        f"✅ Match threshold updated to <b>{new_threshold}%</b>.",
        parse_mode="HTML",
    )


async def cmd_feeds(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /feeds — list active RSS feed URLs."""
    await update.message.reply_chat_action(ChatAction.TYPING)

    from sqlalchemy import select

    try:
        async with AsyncSessionLocal() as db:
            feeds = (await db.execute(select(RssFeed).where(RssFeed.is_active == True))).scalars().all()

        if not feeds:
            await update.message.reply_text("No active RSS feeds configured.", parse_mode="HTML")
            return

        lines = ["📡 <b>Active RSS Feeds</b>\n"]
        for feed in feeds:
            lines.append(f"• <code>{html.escape(feed.url[:60])}</code> ({feed.jobs_found_total} jobs found)\n")

        await update.message.reply_text("".join(lines), parse_mode="HTML")

    except Exception as e:
        logger.error(f"Telegram /feeds error: {e}")
        await update.message.reply_text(f"❌ Error: {html.escape(str(e))}")


async def cmd_stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /stats — show weekly performance statistics."""
    await update.message.reply_chat_action(ChatAction.TYPING)

    from sqlalchemy import select, func, case

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(
                    func.count().label("total"),
                    func.count(case((Job.status == "shortlisted", 1))).label("shortlisted"),
                    func.count(case((Job.status == "applied", 1))).label("applied"),
                    func.count(case((Job.status == "interviewing", 1))).label("interviewing"),
                    func.count(case((Job.status == "hired", 1))).label("hired"),
                    func.avg(Job.match_score).label("avg_score"),
                ).select_from(Job)
            )
            row = result.one()

        stats_text = (
            "📊 <b>Weekly Performance Stats</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            f"📋 Total Scanned: <b>{row.total}</b>\n"
            f"🎯 Shortlisted: <b>{row.shortlisted}</b>\n"
            f"📤 Applied: <b>{row.applied}</b>\n"
            f"🎙️ Interviewing: <b>{row.interviewing}</b>\n"
            f"🏆 Hired: <b>{row.hired}</b>\n"
            f"📈 Avg Match Score: <b>{round(float(row.avg_score or 0), 1)}%</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            f"✅ Threshold: <b>{MATCH_THRESHOLD}%</b>"
        )
        await update.message.reply_text(stats_text, parse_mode="HTML")

    except Exception as e:
        logger.error(f"Telegram /stats error: {e}")
        await update.message.reply_text(f"❌ Error: {html.escape(str(e))}")


async def cmd_profile(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /profile — show the candidate profile summary."""
    await update.message.reply_chat_action(ChatAction.TYPING)

    from backend.routers.profile import PROFILE_PATH

    if not os.path.exists(PROFILE_PATH):
        await update.message.reply_text("❌ Profile configuration not found.", parse_mode="HTML")
        return

    try:
        with open(PROFILE_PATH, "r") as f:
            profile = json.load(f)

        skills = ", ".join(profile.get("skills", []))
        lines = [
            "👤 <b>Candidate Profile</b>\n",
            f"📛 Name: <b>{html.escape(profile.get('name', 'N/A'))}</b>",
            f"💼 Title: {html.escape(profile.get('title', 'N/A'))}",
            f"🎯 Target Rate: <b>${profile.get('target_rate', '?')}/hr</b>",
            f"🗣️ Tone: {html.escape(profile.get('preferred_tone', 'N/A'))}",
            f"🔧 Skills: {html.escape(skills)}",
            f"📡 Feeds: {len(profile.get('rss_feeds', []))} active queries",
        ]

        await update.message.reply_text("\n".join(lines), parse_mode="HTML")

    except Exception as e:
        logger.error(f"Telegram /profile error: {e}")
        await update.message.reply_text(f"❌ Error: {html.escape(str(e))}")


async def cmd_followup(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /followup <id> — generate a follow-up message for a job."""
    await update.message.reply_chat_action(ChatAction.TYPING)

    if not context.args:
        await update.message.reply_text("Usage: /followup <code>&lt;job-id&gt;</code>", parse_mode="HTML")
        return

    job_id_prefix = context.args[0]

    from sqlalchemy import select

    try:
        async with AsyncSessionLocal() as db:
            jobs = (await db.execute(select(Job))).scalars().all()
            matched = [j for j in jobs if str(j.id).startswith(job_id_prefix)]

        if not matched:
            await update.message.reply_text(f"❌ No job found starting with <code>{html.escape(job_id_prefix)}</code>", parse_mode="HTML")
            return

        job = matched[0]

        # Use Gemini to generate a follow-up message
        from backend.ai_engine import _call_gemini_json, _MODEL_NAME
        from backend.schemas import ProposalDraftBase
        import google.genai.types as types

        prompt = (
            f"Write a concise follow-up message to the client for this Upwork job.\n\n"
            f"JOB TITLE: {job.title}\n"
            f"JOB DESCRIPTION: {job.description[:500]}\n"
            f"MATCH SCORE: {job.match_score}%\n"
            f"CURRENT STATUS: {job.status}\n\n"
            f"Write a professional, brief follow-up that references the job specifically. "
            f"Return only a single paragraph string."
        )

        def _gen():
            client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
            resp = client.models.generate_content(
                model=_MODEL_NAME,
                contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="text/plain"),
            )
            return resp.text

        followup_text = await asyncio.to_thread(_gen)

        await update.message.reply_text(
            f"📝 <b>Follow-up for {html.escape(job.title[:40])}...</b>\n\n{html.escape(followup_text[:1500])}",
            parse_mode="HTML",
        )

    except Exception as e:
        logger.error(f"Telegram /followup error: {e}")
        await update.message.reply_text(f"❌ Error: {html.escape(str(e))}")


async def cmd_pause(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /pause — pause the background scheduler."""
    from backend.scheduler import scheduler
    scheduler.pause_job("rss_poll_job")
    scheduler.pause_job("email_poll_job")
    await update.message.reply_text("⏸️ Polling paused.", parse_mode="HTML")


async def cmd_resume(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /resume — resume the background scheduler."""
    from backend.scheduler import scheduler
    scheduler.resume_job("rss_poll_job")
    scheduler.resume_job("email_poll_job")
    await update.message.reply_text("▶️ Polling resumed.", parse_mode="HTML")


# ---------------------------------------------------------------------------
# Application Factory & Native Menu Button Setup
# ---------------------------------------------------------------------------

async def _post_init(app: Application) -> None:
    """Register native Telegram Bot Command Menu items."""
    from telegram import BotCommand
    commands = [
        BotCommand("start", "🚀 Open Dashboard Control Panel"),
        BotCommand("jobs", "🎯 Today's Top Matched Jobs"),
        BotCommand("scan", "📡 Trigger Live Apify Scan"),
        BotCommand("status", "📊 System Health & Stats"),
        BotCommand("help", "❓ Usage & Control Instructions"),
        BotCommand("proposal", "📝 View AI Proposal for a Job"),
        BotCommand("shortlist", "⭐ Shortlist a Job"),
        BotCommand("track", "📊 Update Job Status"),
        BotCommand("note", "📝 Add a Note to a Job"),
        BotCommand("invites", "🎉 View Invited Jobs"),
        BotCommand("threshold", "🎯 Set Match Score Threshold"),
        BotCommand("feeds", "📡 List Active RSS Feeds"),
        BotCommand("stats", "📈 Weekly Performance Stats"),
        BotCommand("profile", "👤 View Candidate Profile"),
        BotCommand("followup", "✉️ Generate Follow-up Message"),
        BotCommand("pause", "⏸️ Pause Polling"),
        BotCommand("resume", "▶️ Resume Polling"),
    ]
    try:
        await app.bot.set_my_commands(commands)
        logger.info("Telegram native Menu Button commands registered successfully.")

        webapp_target = get_webapp_url()
        await app.bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(text="🌐 Open App", web_app=WebAppInfo(url=webapp_target))
        )
        logger.info(f"Telegram native Menu Button set to Mini App URL: {webapp_target}")
    except Exception as e:
        logger.warning(f"Failed to set Telegram bot commands/menu button: {e}")


def get_telegram_application() -> Application | None:
    """Build and return the configured Telegram Application, or None if no token."""
    if not BOT_TOKEN:
        logger.warning("TELEGRAM_BOT_TOKEN not found. Telegram bot will not start.")
        return None

    app = Application.builder().token(BOT_TOKEN).post_init(_post_init).build()

    # Commands (all point to UI cards)
    app.add_handler(CommandHandler("start",  cmd_start))
    app.add_handler(CommandHandler("help",   cmd_help))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("scan",   cmd_scan))
    app.add_handler(CommandHandler("jobs",   cmd_jobs))
    app.add_handler(CommandHandler("job",    cmd_job))
    app.add_handler(CommandHandler("apply",  cmd_apply))
    app.add_handler(CommandHandler("ignore", cmd_ignore))
    app.add_handler(CommandHandler("proposal", cmd_proposal))
    app.add_handler(CommandHandler("shortlist", cmd_shortlist))
    app.add_handler(CommandHandler("track",  cmd_track))
    app.add_handler(CommandHandler("note",   cmd_note))
    app.add_handler(CommandHandler("invites", cmd_invites))
    app.add_handler(CommandHandler("threshold", cmd_threshold))
    app.add_handler(CommandHandler("feeds",  cmd_feeds))
    app.add_handler(CommandHandler("stats",  cmd_stats))
    app.add_handler(CommandHandler("profile", cmd_profile))
    app.add_handler(CommandHandler("followup", cmd_followup))
    app.add_handler(CommandHandler("pause",  cmd_pause))
    app.add_handler(CommandHandler("resume", cmd_resume))

    # Interactive Inline Keyboard Button Clicks
    app.add_handler(CallbackQueryHandler(handle_callback))

    return app


# ---------------------------------------------------------------------------
# Proactive Notification Utilities (called by monitors)
# ---------------------------------------------------------------------------

async def send_job_alert(job_title: str, match_score: int, budget: str, link: str, job_id: str | None = None) -> None:
    """Push an interactive job-match notification card to the configured Telegram chat."""
    if not BOT_TOKEN or not CHAT_ID:
        logger.debug("Telegram not configured — skipping job alert.")
        return

    emoji = "🟢" if match_score >= 80 else "🟡" if match_score >= 60 else "🔴"
    safe_title = html.escape(job_title)
    text = (
        f"{emoji} <b>New Job Match — {match_score}% Match</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📌 <b>{safe_title}</b>\n"
        f"💰 {html.escape(budget)}"
    )

    kb = _job_action_keyboard(job_id, "new", link) if job_id else InlineKeyboardMarkup([[InlineKeyboardButton("🔗 View on Upwork", url=link)]])

    try:
        bot = Bot(token=BOT_TOKEN)
        await bot.send_message(chat_id=CHAT_ID, text=text, parse_mode="HTML", reply_markup=kb)
        logger.info(f"Telegram interactive job alert sent: '{job_title}' ({match_score}%)")
    except Exception as e:
        logger.error(f"Failed to send Telegram job alert: {e}")


async def send_invite_alert(subject: str, source_type: str, invite_url: str | None) -> None:
    """Push an interactive invite/message notification to Telegram."""
    if not BOT_TOKEN or not CHAT_ID:
        logger.debug("Telegram not configured — skipping invite alert.")
        return

    type_emoji = {"invitation": "🎉", "message": "💬", "offer": "💼"}.get(source_type, "📧")

    text = (
        f"{type_emoji} <b>Upwork {html.escape(source_type.title())} Received!</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📧 {html.escape(subject)}"
    )

    kb = InlineKeyboardMarkup([[InlineKeyboardButton("🔗 Open Invitation", url=invite_url)]]) if invite_url else None

    try:
        bot = Bot(token=BOT_TOKEN)
        await bot.send_message(chat_id=CHAT_ID, text=text, parse_mode="HTML", reply_markup=kb)
        logger.info(f"Telegram invite alert sent: [{source_type}] {subject}")
    except Exception as e:
        logger.error(f"Failed to send Telegram invite alert: {e}")
