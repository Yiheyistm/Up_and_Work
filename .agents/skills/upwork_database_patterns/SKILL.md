---
name: upwork_database_patterns
description: >
  Knowledge of Up_and_Work database schema, SQLAlchemy async patterns,
  and Alembic migration workflow. Triggers when: creating or modifying
  database models, writing queries, adding migrations, or debugging
  PostgreSQL/SQLAlchemy issues in this project.
---

# Up_and_Work — Database Patterns Skill

## Core Setup: `backend/database.py`
```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
import os

DATABASE_URL = os.environ["DATABASE_URL"]  # postgresql+asyncpg://...

engine = create_async_engine(DATABASE_URL, echo=False, pool_size=10)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
```

## Model Conventions (`backend/models.py`)
```python
import uuid
from sqlalchemy import String, Integer, Float, DateTime, Boolean, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime, timezone
from backend.database import Base

def utcnow():
    return datetime.now(timezone.utc)

class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    guid: Mapped[str] = mapped_column(String, unique=True, index=True)  # RSS dedup key
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    link: Mapped[str] = mapped_column(String)
    domain: Mapped[str | None] = mapped_column(String, nullable=True)

    budget_type: Mapped[str | None] = mapped_column(String, nullable=True)  # Fixed / Hourly
    budget_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    budget_max: Mapped[float | None] = mapped_column(Float, nullable=True)

    client_rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    client_country: Mapped[str | None] = mapped_column(String, nullable=True)
    payment_verified: Mapped[bool] = mapped_column(Boolean, default=False)

    required_skills: Mapped[list] = mapped_column(JSONB, default=list)
    preferred_skills: Mapped[list] = mapped_column(JSONB, default=list)
    screening_questions: Mapped[list] = mapped_column(JSONB, default=list)
    red_flags: Mapped[list] = mapped_column(JSONB, default=list)

    match_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reasoning: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    status: Mapped[str] = mapped_column(String, default="new")
    # Values: new | shortlisted | applied | invited | interviewing | hired | rejected | ignored

    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    proposals: Mapped[list["ProposalDraft"]] = relationship(back_populates="job")
    tracking_events: Mapped[list["JobTrackingEvent"]] = relationship(back_populates="job")
    chat_sessions: Mapped[list["ChatSession"]] = relationship(back_populates="job")
```

## Common Query Patterns

### Fetch new jobs not yet processed
```python
from sqlalchemy import select
result = await db.execute(select(Job).where(Job.status == "new").order_by(Job.detected_at.desc()))
jobs = result.scalars().all()
```

### Check if job guid already exists (deduplication)
```python
result = await db.execute(select(Job.id).where(Job.guid == guid))
exists = result.scalar_one_or_none()
```

### Update job status
```python
from sqlalchemy import update
await db.execute(update(Job).where(Job.id == job_id).values(status=new_status, updated_at=utcnow()))
await db.commit()
```

### Bulk insert jobs
```python
db.add_all([Job(**job_data) for job_data in new_jobs])
await db.commit()
```

## Alembic Workflow
```bash
# After changing models.py, generate a migration
alembic revision --autogenerate -m "add chat_sessions table"

# Apply all pending migrations
alembic upgrade head

# Roll back last migration
alembic downgrade -1
```

## Full Table List
| Table | Purpose |
|---|---|
| `jobs` | All detected Upwork jobs |
| `proposal_drafts` | AI-generated proposals per job (versioned) |
| `job_tracking_events` | Status changes, notes, client events |
| `chat_sessions` | AI chat thread metadata (job-specific or general) |
| `chat_messages` | Individual messages in each chat session |
| `invite_notifications` | Upwork invites detected from email |
| `rss_feeds` | Configured RSS feed URLs |
