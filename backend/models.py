"""
SQLAlchemy Object-Relational Mapping (ORM) Models.

This file contains the complete database schema definition for the Up_and_Work project.
It defines all the tables, their columns, data types, and the relationships between them.

Tables defined:
- Job: Stores parsed Upwork jobs from the RSS feed.
- ProposalDraft: Stores AI-generated cover letters and Q&A for specific jobs.
- JobTrackingEvent: Stores the lifecycle history of a job (e.g., status changes).
- ChatSession & ChatMessage: Stores AI chat history linked to jobs.
- InviteNotification: Stores incoming invites/messages detected from email polling.
- RssFeed: Stores the list of target Upwork RSS URLs to poll.
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Float, DateTime, Boolean, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.database import Base

def utcnow():
    return datetime.now(timezone.utc)

class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    guid: Mapped[str] = mapped_column(String, unique=True, index=True)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    link: Mapped[str] = mapped_column(String)
    domain: Mapped[str | None] = mapped_column(String, nullable=True)

    budget_type: Mapped[str | None] = mapped_column(String, nullable=True)
    budget_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    budget_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    experience_level: Mapped[str | None] = mapped_column(String, nullable=True)

    client_rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    client_country: Mapped[str | None] = mapped_column(String, nullable=True)
    payment_verified: Mapped[bool] = mapped_column(Boolean, default=False)

    required_skills: Mapped[list] = mapped_column(JSONB, default=list)
    preferred_skills: Mapped[list] = mapped_column(JSONB, default=list)
    screening_questions: Mapped[list] = mapped_column(JSONB, default=list)
    red_flags: Mapped[list] = mapped_column(JSONB, default=list)

    match_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reasoning: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    competition_level: Mapped[str | None] = mapped_column(String, nullable=True)

    status: Mapped[str] = mapped_column(String, default="new")
    # new | shortlisted | applied | invited | interviewing | hired | rejected | ignored

    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    proposals: Mapped[list["ProposalDraft"]] = relationship(back_populates="job", cascade="all, delete-orphan")
    tracking_events: Mapped[list["JobTrackingEvent"]] = relationship(back_populates="job", cascade="all, delete-orphan")
    chat_sessions: Mapped[list["ChatSession"]] = relationship(back_populates="job", cascade="all, delete-orphan")
    invite_notifications: Mapped[list["InviteNotification"]] = relationship(back_populates="job", cascade="all, delete-orphan")

class ProposalDraft(Base):
    __tablename__ = "proposal_drafts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    
    cover_letter: Mapped[str] = mapped_column(Text)
    screening_answers: Mapped[list] = mapped_column(JSONB, default=list)
    suggested_bid: Mapped[float | None] = mapped_column(Float, nullable=True)
    timeline: Mapped[str | None] = mapped_column(String, nullable=True)
    tone: Mapped[str] = mapped_column(String, default="professional")
    version: Mapped[int] = mapped_column(Integer, default=1)
    
    is_edited: Mapped[bool] = mapped_column(Boolean, default=False)
    edited_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    
    job: Mapped["Job"] = relationship(back_populates="proposals")

class JobTrackingEvent(Base):
    __tablename__ = "job_tracking_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    
    event_type: Mapped[str] = mapped_column(String)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    
    job: Mapped["Job"] = relationship(back_populates="tracking_events")

class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), nullable=True, index=True)
    
    title: Mapped[str] = mapped_column(String)
    context_type: Mapped[str] = mapped_column(String, default="general")

    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    
    job: Mapped["Job"] = relationship(back_populates="chat_sessions")
    messages: Mapped[list["ChatMessage"]] = relationship(back_populates="session", cascade="all, delete-orphan")

class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chat_sessions.id", ondelete="CASCADE"), index=True)
    
    role: Mapped[str] = mapped_column(String) # user | assistant
    content: Mapped[str] = mapped_column(Text)
    message_metadata: Mapped[dict] = mapped_column(JSONB, default=dict)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    
    session: Mapped["ChatSession"] = relationship(back_populates="messages")

class InviteNotification(Base):
    __tablename__ = "invite_notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True, index=True)
    
    source: Mapped[str] = mapped_column(String) # email | upwork_api
    raw_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    parsed_title: Mapped[str | None] = mapped_column(String, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    invite_url: Mapped[str | None] = mapped_column(String, nullable=True)
    
    notified_telegram: Mapped[bool] = mapped_column(Boolean, default=False)
    notified_web: Mapped[bool] = mapped_column(Boolean, default=False)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    
    job: Mapped["Job"] = relationship(back_populates="invite_notifications")

class RssFeed(Base):
    __tablename__ = "rss_feeds"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    url: Mapped[str] = mapped_column(String, unique=True, index=True)
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    jobs_found_total: Mapped[int] = mapped_column(Integer, default=0)
