---
name: upwork_telegram_bot
description: >
  Patterns and conventions for the Up_and_Work Telegram bot.
  Triggers when: adding new commands, modifying notification logic,
  debugging Telegram bot issues, or extending the interactive bot
  features in this project.
---

# Up_and_Work — Telegram Bot Skill

## Library
Use `python-telegram-bot` v20+ (async-native). Never use the synchronous API.

## File: `backend/telegram_bot.py`
All bot logic lives here. Import and call `setup_telegram_bot()` from `main.py` lifespan.

## Bot Setup Pattern
```python
from telegram.ext import Application, CommandHandler, MessageHandler, filters
from loguru import logger
import os

BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT_ID = int(os.environ["TELEGRAM_CHAT_ID"])

def build_application() -> Application:
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("jobs", cmd_jobs))
    app.add_handler(CommandHandler("scan", cmd_scan))
    # ... register all handlers
    return app
```

## Sending Notifications (from scheduler/AI engine)
```python
from telegram import Bot

async def send_job_alert(job: Job, proposal: ProposalDraft):
    bot = Bot(token=BOT_TOKEN)
    score = job.match_score
    emoji = "🟢" if score >= 80 else "🟡" if score >= 60 else "🔴"

    text = (
        f"{emoji} *New Job Match — {score}% Match*\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📌 *{job.title}*\n"
        f"💰 {format_budget(job)}\n"
        f"⭐ Client: {job.client_rating or 'N/A'} | "
        f"{'✅ Payment Verified' if job.payment_verified else '❌ Unverified'}\n"
        f"🌍 {job.client_country or 'Unknown'}\n\n"
        f"✅ *Strengths:* {', '.join(job.reasoning.get('strength_points', [])[:3])}\n"
        f"⚠️ *Gaps:* {', '.join(job.reasoning.get('gap_skills', [])[:2]) or 'None'}\n\n"
        f"🔗 [View on Upwork]({job.link})"
    )
    await bot.send_message(chat_id=CHAT_ID, text=text, parse_mode="Markdown")
```

## Invite Notification Pattern
```python
async def send_invite_alert(invite: InviteNotification):
    bot = Bot(token=BOT_TOKEN)
    text = (
        f"🎉 *You've Been Invited!*\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📌 {invite.parsed_title}\n\n"
        f"[🔗 View Invitation]({invite.invite_url})"
    )
    await bot.send_message(chat_id=CHAT_ID, text=text, parse_mode="Markdown")
```

## All Commands Reference
| Command | Handler Function | Description |
|---|---|---|
| `/start` | `cmd_start` | Welcome + status |
| `/status` | `cmd_status` | System health check |
| `/scan` | `cmd_scan` | Trigger manual RSS scan |
| `/jobs` | `cmd_jobs` | Today's top matched jobs |
| `/job {id}` | `cmd_job` | Full details for job |
| `/proposal {id}` | `cmd_proposal` | Full AI proposal |
| `/invites` | `cmd_invites` | Recent invitations |
| `/apply {id}` | `cmd_apply` | Mark as Applied |
| `/ignore {id}` | `cmd_ignore` | Mark as Ignored |
| `/shortlist {id}` | `cmd_shortlist` | Add to shortlist |
| `/track {id} {status}` | `cmd_track` | Update job status |
| `/note {id} {text}` | `cmd_note` | Add note to job |
| `/followup {id}` | `cmd_followup` | Generate follow-up message |
| `/chat {id}` | `cmd_chat` | Start/resume job AI chat |
| `/ask {question}` | `cmd_ask` | General AI chat |
| `/negotiate {id}` | `cmd_negotiate` | Negotiation coaching |
| `/pause` | `cmd_pause` | Pause polling |
| `/resume` | `cmd_resume` | Resume polling |
| `/threshold {n}` | `cmd_threshold` | Change match threshold |
| `/addfeed {url}` | `cmd_addfeed` | Add RSS feed URL |
| `/removefeed {url}` | `cmd_removefeed` | Remove RSS feed URL |
| `/feeds` | `cmd_feeds` | List active feeds |
| `/stats` | `cmd_stats` | Weekly performance stats |
| `/profile` | `cmd_profile` | View profile summary |
| `/help` | `cmd_help` | Command reference |

## Command Handler Pattern
```python
from telegram import Update
from telegram.ext import ContextTypes

async def cmd_job(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_chat_action("typing")  # Show typing indicator
    
    if not context.args:
        await update.message.reply_text("Usage: /job {id}")
        return
    
    job_id = context.args[0]
    # ... fetch from DB and reply
```

## Sending Long Messages
Telegram has a 4096 character limit. Always chunk long content:
```python
async def send_long_message(chat_id: int, text: str, bot: Bot):
    chunks = [text[i:i+4000] for i in range(0, len(text), 4000)]
    for chunk in chunks:
        await bot.send_message(chat_id=chat_id, text=chunk, parse_mode="Markdown")
```

## Daily Digest (APScheduler)
Runs every morning at 8:00 AM local time. Sends top 5 jobs from last 24h, sorted by match_score DESC.

## Weekly Report (APScheduler)
Runs every Monday at 9:00 AM. Sends summary: total scanned, matched, applied, hired, ignored.
