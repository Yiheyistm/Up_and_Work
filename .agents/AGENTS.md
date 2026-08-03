# Up_and_Work — Project Agent Rules

## Project Identity
This project is called **Up_and_Work**. It is an AI-powered Upwork Job Monitoring & Proposal Generation Assistant.
- It is NOT a bot that submits applications automatically.
- It is a semi-automated copilot: it monitors, scores, and drafts — the human submits manually.
- Safety and transparency are first-class concerns. Never add automation that directly interacts with Upwork's application submission UI.

## Tech Stack (Mandatory — Do Not Deviate)
| Layer | Technology |
|---|---|
| Backend Language | Python 3.11 |
| Web Framework | FastAPI (async) |
| Database | PostgreSQL (via SQLAlchemy async + asyncpg driver) |
| Migrations | Alembic |
| AI Engine | Google Gemini API (`google-generativeai` SDK) |
| Background Jobs | APScheduler |
| Telegram | `python-telegram-bot` library (v20+ async) |
| Email Parsing | `imaplib` + `email` stdlib + `beautifulsoup4` |
| RSS Parsing | `feedparser` library |
| Frontend | Vite + React + TypeScript |
| Real-time | FastAPI WebSockets |
| Environment | `.env` file loaded via `python-dotenv` |
| Containerization | Docker + `docker-compose.yml` |

## Project Structure (Canonical — Never Reorganize Without Explicit Approval)
```
Up_and_Work/
├── .env                      ← credentials (never commit)
├── .env.example              ← placeholder template (safe to commit)
├── docker-compose.yml
├── requirements.txt
├── alembic.ini
├── alembic/
│   └── versions/
├── config/
│   └── profile.json          ← candidate skills, experience, targets
├── backend/
│   ├── main.py               ← FastAPI app + lifespan events
│   ├── database.py           ← async SQLAlchemy engine + session factory
│   ├── models.py             ← all ORM models
│   ├── schemas.py            ← all Pydantic v2 schemas
│   ├── scheduler.py          ← APScheduler setup + job registration
│   ├── rss_monitor.py        ← RSS polling + deduplication
│   ├── ai_engine.py          ← Gemini AI pipeline (all 5 stages)
│   ├── telegram_bot.py       ← Telegram bot setup + all command handlers
│   ├── email_monitor.py      ← IMAP email polling for Upwork invites
│   └── routers/
│       ├── jobs.py
│       ├── proposals.py
│       ├── tracker.py
│       ├── chat.py
│       ├── invites.py
│       ├── profile.py
│       └── system.py
└── frontend/
    ├── index.html
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api/              ← typed API client functions
        ├── components/       ← shared UI components
        ├── pages/
        │   ├── Dashboard.tsx
        │   ├── JobDetail.tsx
        │   ├── Tracker.tsx
        │   ├── AiChat.tsx
        │   ├── Analytics.tsx
        │   └── Settings.tsx
        ├── hooks/            ← custom React hooks (useWebSocket, useJobs, etc.)
        ├── store/            ← global state (Zustand preferred)
        └── types/            ← TypeScript interfaces mirroring backend schemas
```

## Database Rules
- Always use **async SQLAlchemy** (`AsyncSession`, `async_sessionmaker`).
- Never use synchronous SQLAlchemy sessions.
- All database interactions must go through the session dependency: `get_db()` in `database.py`.
- Every new table requires a corresponding Alembic migration. Run `alembic revision --autogenerate -m "description"` after adding models.
- Use `UUID` as primary key type for all models.
- All timestamps must be `TIMESTAMP WITH TIME ZONE` (use `DateTime(timezone=True)`).
- Use `JSONB` columns for array/object fields (e.g., `required_skills`, `screening_answers`, `reasoning`).

## API Design Rules
- All FastAPI routes must be async.
- All routes must have proper response models (Pydantic v2 schemas).
- All routes must have meaningful tags for OpenAPI docs.
- Use HTTP status codes correctly: 201 for creation, 204 for delete, 422 for validation errors.
- Prefix all API routes with `/api/v1/`.
- WebSocket endpoint for real-time feed: `ws://localhost:8000/ws/jobs`.
- WebSocket endpoint for AI chat streaming: `ws://localhost:8000/ws/chat/{session_id}`.

## AI Engine Rules
- The AI engine runs a **mandatory 5-stage pipeline** for every new job. Never skip stages.
- Stage order: Extract → Match → Cover Letter → Screening Q&A → Bid Strategy.
- All Gemini prompts must request JSON output (use `response_mime_type="application/json"`).
- Always validate AI JSON output with Pydantic before saving to DB.
- If Gemini returns invalid JSON, retry once with a clarification prompt before failing.
- Proposal tone must respect `profile.json["preferred_tone"]` setting.
- Match score threshold is configurable via env var `MATCH_SCORE_THRESHOLD` (default: 70).

## Telegram Bot Rules
- All Telegram handlers must be async.
- The bot must respond to every command within 3 seconds (use `context.bot.send_chat_action` for longer ops).
- All Telegram messages for job matches must include: job title, match score emoji (🔴/🟡/🟢), budget, client rating, and a direct Upwork link.
- Invite notifications must fire within 2 minutes of email receipt.
- Telegram bot runs in the same FastAPI process using `Application.run_polling()` in a background thread, or via webhook.

## Environment Variables (All Required — Fail Fast if Missing)
```
GEMINI_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
DATABASE_URL               ← postgresql+asyncpg://...
IMAP_EMAIL                 ← your email address
IMAP_PASSWORD              ← app password (not your email password)
IMAP_SERVER                ← e.g. imap.gmail.com
POLL_INTERVAL_SECONDS      ← default 60
EMAIL_POLL_INTERVAL_SECONDS← default 120
MATCH_SCORE_THRESHOLD      ← default 70
```
On startup, `main.py` must validate all required env vars and raise a clear error if any are missing.

## Frontend Rules
- Use **Zustand** for global state management.
- Use **React Query (TanStack Query)** for all API data fetching and caching.
- Use **React Router v6** for routing.
- WebSocket connections must auto-reconnect on disconnect.
- All job cards must display: title, match score badge, budget, client rating, posted time, top 3 skills, red flag count.
- Dark mode is the default and only theme.
- Use CSS variables for all colors/spacing — no hardcoded hex values in component styles.
- Use `Inter` font from Google Fonts.

## Code Style
- **Comments (MANDATORY):** Every single file MUST have a long module-level comment at the top explaining what the file does and its role in the project. Inline comments must be written for all non-trivial logic.
- Python: Follow PEP 8. Use type hints on all functions. Use `__all__` in module files.
- TypeScript: Strict mode enabled. No `any` types.
- All async Python functions must have error handling with proper logging (use `loguru` library).
- Never use `print()` for logging — always use `loguru` logger.
- All file-level constants go at the top of the file in SCREAMING_SNAKE_CASE.

## Security Rules
- Never commit `.env` to git. `.gitignore` must include `.env` and `*.db`.
- Database credentials must only come from environment variables.
- IMAP password must be an **App Password**, not the user's real email password.
- Never log full email content or API keys.

## What This Project Must NEVER Do
- Automatically submit proposals or applications on Upwork on behalf of the user.
- Use headless browsers (Puppeteer, Playwright, Selenium) to interact with Upwork UI.
- Store or transmit the user's Upwork credentials.
- Violate Upwork Terms of Service in any way.
