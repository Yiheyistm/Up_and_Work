# Up_and_Work — AI-Powered Upwork Job Monitoring & Proposal Generation

A full-stack application that monitors Upwork jobs via RSS feeds and Apify, scores them with AI, and generates personalized proposals using Google Gemini. Built for freelancers who want to automate their Upwork workflow.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [AI Pipeline](#ai-pipeline)
- [Telegram Notifications](#telegram-notifications)
- [Responsive Design](#responsive-design)
- [Tunneling for Remote Access](#tunneling-for-remote-access)
- [Database](#database)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Job Monitoring
- **RSS Feed Polling** — Monitors Upwork job feeds for keywords matching your skills
- **Apify Integration** — Fetches live Upwork jobs with software-related category filtering
- **Real-time Updates** — WebSocket-based live job feed on the dashboard
- **Software-Only Filtering** — Automatically filters out non-software jobs (legal, design, writing, etc.)
- **AI Match Scoring** — Each job is scored 0–100% based on your resume and skills

### Proposal Generation
- **Automated Proposals** — AI generates tailored cover letters for high-match jobs
- **Screening Q&A** — Answers common Upwork screening questions with personalized responses
- **Bid Strategy** — Suggests hourly/fixed rates based on your profile and market data
- **Proposal Editing** — Edit generated proposals inline before submitting

### AI Chat
- **Context-Aware Conversations** — AI knows your resume, skills, and experience
- **Streaming Responses** — Real-time streaming via WebSocket
- **Session Management** — Create, rename, and delete chat sessions
- **Proposal Assistance** — Discuss job fit, refine proposals, and get bid advice

### Dashboard & Analytics
- **Job Feed** — Filterable, searchable, paginated job list with match scores
- **Kanban Tracker** — Drag-and-drop status tracking (New → Shortlisted → Applied → etc.)
- **Analytics** — Match score distribution, conversion funnel, application stats
- **Real-time Updates** — WebSocket-powered live job feed

### Notifications
- **Telegram Alerts** — Get notified for high-match jobs
- **Email Polling** — Monitor inbox for Upwork notifications

---

## Tech Stack

### Backend
| Technology | Purpose |
|-----------|---------|
| Python 3.14 | Runtime |
| FastAPI | REST API + WebSocket server |
| SQLAlchemy (async) | ORM |
| PostgreSQL | Database |
| Google Gemini API | AI matching & proposal generation |
| Apify Client | Live job scraping |
| BeautifulSoup | HTML parsing |
| python-dateutil | Date parsing |

### Frontend
| Technology | Purpose |
|-----------|---------|
| React 18 | UI library |
| Vite 8 | Build tool & dev server |
| React Router | Client-side routing |
| React Query | Data fetching & caching |
| Lucide React | Icons |
| React Markdown | AI output rendering |
| CSS Custom Properties | Styling (no Tailwind) |

### Infrastructure
| Technology | Purpose |
|-----------|---------|
| Docker | Containerization (optional) |
| Uvicorn | ASGI server |
| SSH Tunneling | Remote access (serveo.net) |

---

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Frontend    │────▶│  FastAPI Backend │────▶│  PostgreSQL DB   │
│  (Vite/React)│     │  (uvicorn)       │     │  (upwork_jobs)   │
│  :5173       │     │  :8001           │     │  :5432           │
└─────────────┘     └────────┬─────────┘     └─────────────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
              ┌─────▼─────┐   ┌──────▼──────┐
              │  Gemini AI │   │  Apify API  │
              │  (matching │   │  (scraping) │
              │   + proposals)│              │
              └────────────┘   └─────────────┘
```

### Data Flow

1. **RSS Monitor** polls configured Upwork RSS feeds every 15 minutes
2. **Apify Scraper** fetches live software-related jobs (if API token configured)
3. **AI Pipeline** scores each job against your profile using Gemini
4. **Proposals** are auto-generated for jobs above the match threshold (default: 70%)
5. **WebSocket** pushes new jobs to the dashboard in real-time
6. **Telegram** sends alerts for high-match jobs

---

## Prerequisites

- **Python 3.12+**
- **Node.js 18+**
- **PostgreSQL 14+** (running on port 5432)
- **Git**

---

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd Up_and_Work
```

### 2. Backend Setup

```bash
# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Copy environment template
cp .env.example .env

# Edit .env with your API keys
nano .env
```

### 3. Database Setup

```bash
# Run database migrations
alembic upgrade head

# Verify database connection
psql postgresql+asyncpg://upwork_user:upwork_password@localhost:5433/upwork_jobs
```

### 4. Start the Backend

```bash
# From project root
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8001
```

The API will be available at `http://localhost:8001`.

### 5. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Copy environment template (if needed)
cp .env.example .env

# Start dev server
npm run dev
```

The frontend will be available at `http://localhost:5173`.

### 6. Configure RSS Feeds

Visit `http://localhost:8001` and use the API or the dashboard to add RSS feeds:

```
https://www.upwork.com/nx/search/jobs/?q=python
https://www.upwork.com/nx/search/jobs/?q=javascript
https://www.upwork.com/nx/search/jobs/?q=flutter
```

---

## Environment Variables

### Backend (`.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | Yes | — | Google Gemini API key |
| `DATABASE_URL` | Yes | `postgresql+asyncpg://upwork_user:upwork_password@localhost:5433/upwork_jobs` | PostgreSQL connection string |
| `TELEGRAM_BOT_TOKEN` | No | — | Telegram bot token for notifications |
| `TELEGRAM_CHAT_ID` | No | — | Telegram chat ID for alerts |
| `APIFY_API_TOKEN` | No | — | Apify API token for live job scraping |
| `MATCH_SCORE_THRESHOLD` | No | `70` | Minimum match score for proposal generation |
| `FRONTEND_URL` | No | `http://localhost:5173` | Frontend URL for CORS |
| `POLL_INTERVAL_SECONDS` | No | `900` | RSS polling interval (seconds) |

### Frontend (`.env` in `frontend/`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_BASE_URL` | No | `http://localhost:8001/api/v1` | Backend API URL |
| `VITE_WS_URL` | No | `ws://localhost:8001` | WebSocket URL |

---

## API Reference

### Jobs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/jobs/` | List jobs (with pagination, status & score filters) |
| `GET` | `/api/v1/jobs/{job_id}` | Get job details |
| `PATCH` | `/api/v1/jobs/{job_id}/status` | Update job status |
| `DELETE` | `/api/v1/jobs/{job_id}` | Delete a job |
| `POST` | `/api/v1/jobs/scrape-url` | Scrape a job from a URL |
| `POST` | `/api/v1/jobs/scan` | Trigger a new scan |

### Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/chat/sessions/` | List chat sessions |
| `POST` | `/api/v1/chat/sessions/` | Create a new session |
| `GET` | `/api/v1/chat/sessions/{id}` | Get session details |
| `PATCH` | `/api/v1/chat/sessions/{id}` | Update session title |
| `DELETE` | `/api/v1/chat/sessions/{id}` | Delete a session |
| `GET` | `/api/v1/chat/sessions/{id}/messages` | Get session messages |
| `POST` | `/api/v1/chat/sessions/{id}/messages` | Send a message |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `/ws/jobs` | Live job feed (broadcast) |
| `/ws/chat/{session_id}` | AI chat streaming |

### Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/analytics/overview` | Get analytics overview |
| `GET` | `/api/v1/analytics/score-distribution` | Get score distribution |

---

## Project Structure

```
Up_and_Work/
├── backend/
│   ├── main.py                 # FastAPI app entry point
│   ├── database.py             # Async DB session management
│   ├── models.py               # SQLAlchemy ORM models
│   ├── schemas.py              # Pydantic request/response schemas
│   ├── ai_engine.py            # Gemini AI matching & proposal pipeline
│   ├── rss_monitor.py          # RSS feed polling & Apify scraping
│   ├── telegram_bot.py         # Telegram notification bot
│   ├── scheduler.py            # Background task scheduler
│   └── routers/
│       ├── jobs.py             # Job CRUD endpoints
│       ├── chat.py             # Chat session/message endpoints
│       ├── analytics.py        # Analytics endpoints
│       ├── invites.py          # Email invite parsing
│       ├── tracker.py          # Application tracker
│       ├── profile.py          # User profile management
│       ├── ws.py               # WebSocket handlers
│       └── system.py           # System health & config
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Main app with routing & sidebar
│   │   ├── main.tsx            # React entry point
│   │   ├── index.css           # Global styles & design tokens
│   │   ├── api/
│   │   │   └── client.ts       # API client (axios)
│   │   ├── components/
│   │   │   ├── Button.tsx      # Reusable button
│   │   │   ├── Card.tsx        # Reusable card
│   │   │   ├── Badge.tsx       # Status badge
│   │   │   ├── StatCard.tsx    # Analytics stat card
│   │   │   ├── Modal.tsx       # Reusable modal
│   │   │   ├── Skeleton.tsx    # Loading skeleton
│   │   │   └── Pagination.tsx  # Pagination controls
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts # WebSocket hook
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx   # Job feed with filters & pagination
│   │   │   ├── JobDetail.tsx   # Job details & proposal view
│   │   │   ├── AiChat.tsx      # AI chat interface
│   │   │   ├── Analytics.tsx   # Analytics dashboard
│   │   │   ├── Tracker.tsx     # Kanban application tracker
│   │   │   ├── Invites.tsx     # Email invite list
│   │   │   └── Settings.tsx    # Profile & system settings
│   │   └── store/
│   │       └── appStore.ts     # Zustand global state
│   ├── vite.config.ts          # Vite configuration
│   └── index.html              # HTML template
├── config/
│   ├── profile.json            # Full resume + profile data
│   └── personal_data.json      # Source resume data
├── alembic/                    # Database migrations
├── .env.example                # Environment variable template
├── .env                        # Local environment (gitignored)
├── .gitignore                  # Git ignore rules
├── requirements.txt            # Python dependencies
├── package.json                # Node dependencies
└── README.md                   # This file
```

---

## AI Pipeline

### Job Matching

The AI pipeline scores each job against your profile using the following criteria:

1. **Skill Coverage** (40%) — How many of your skills match the job requirements
2. **Experience Match** (30%) — Relevance of your work experience to the job
3. **Project Relevance** (20%) — Similarity of your past projects to the job
4. **Domain Match** (10%) — Overall fit based on job category and description

### Proposal Generation

For jobs scoring above the threshold (default: 70%):

1. **Cover Letter** — Personalized based on your resume and the job description
2. **Screening Answers** — AI-generated answers to common screening questions
3. **Bid Strategy** — Suggested hourly/fixed rate based on your profile and market data
4. **Timeline** — Estimated project timeline

### Chat Context

The AI chat has full access to your profile including:
- Personal summary and title
- All skills (35+)
- Work experience and projects
- Education and achievements

This allows the AI to give personalized advice on proposals, bid strategies, and job fit.

---

## Telegram Notifications

Configure Telegram alerts in `.env`:

```
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

You'll receive notifications for:
- New high-match jobs (≥70%)
- Job status changes
- Scan completions

---

## Responsive Design

The application is fully responsive across all pages:

- **Desktop** (>1024px): Full layout with sidebar navigation
- **Tablet** (769–1024px): Adjusted grids, stacked headers
- **Mobile** (<768px): Hamburger menu, collapsible chat sidebar, single-column layouts, touch-friendly inputs

### Key Responsive Features
- Collapsible sidebar with hamburger menu on mobile
- Chat sidebar slides in as an overlay on mobile
- Grid layouts stack to single column on mobile
- All buttons and inputs are touch-friendly (16px font size)
- Pagination adapts to screen size

---

## Tunneling for Remote Access

To expose the frontend for remote access, use **serveo.net** (recommended):

```bash
ssh -o StrictHostKeyChecking=no -R 80:localhost:5173 serveo.net
```

This creates a public URL that tunnels to your local Vite dev server. The URL will be something like `https://xxxxx.serveousercontent.com`.

**Note:** LocalTunnel (`npx localtunnel`) does not work well with Vite's HMR WebSocket. Use serveo.net instead.

---

## Database

### Schema

The database contains the following main tables:

- **jobs** — Upwork job listings with match scores and status
- **chat_sessions** — AI chat conversation sessions
- **chat_messages** — Individual messages within sessions
- **rss_feeds** — Configured RSS feed URLs
- **proposals** — Generated proposal drafts
- **proposal_edits** — User edits to proposals
- **job_tracking_events** — Status change history

### Migrations

```bash
# Create a new migration
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

---

## Configuration

### RSS Feeds

RSS feeds are configured in the database and can be managed via the Settings page or API. By default, the system includes feeds for:

- Python, JavaScript, TypeScript, React
- Flutter, Dart, Java
- Go backend, Django, FastAPI
- Microservices, REST API, Firebase
- Machine Learning (Python)

### Match Threshold

The `MATCH_SCORE_THRESHOLD` environment variable controls which jobs trigger proposal generation (default: 70%). Jobs below this threshold are scored but don't get auto-generated proposals.

### Software-Only Filtering

The system automatically filters out non-software jobs (legal, design, writing, marketing, etc.) from both the Apify scraper and RSS feed parsing. This is enforced via:
- Apify `jobCategories` filter (Web Development, Mobile Development, AI Apps, Software Development)
- Backend keyword filtering for software-related terms

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is proprietary and confidential.
