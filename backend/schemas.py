"""
Pydantic Data Schemas (API Models).

This file defines all the Pydantic models used for data validation, serialization,
and deserialization across the FastAPI application. These schemas are used to:
1. Define the structure of API request payloads (e.g., JobCreate).
2. Format API response payloads (e.g., JobResponse).
3. Ensure strongly-typed internal data passing (e.g., JobIntelligence for the AI engine).
"""

import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, ConfigDict, Field

# --- Core Schemas ---
class OrmModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

class JobBase(BaseModel):
    guid: str
    title: str
    description: str
    link: str
    domain: Optional[str] = None
    budget_type: Optional[str] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    experience_level: Optional[str] = None
    client_rating: Optional[float] = None
    client_country: Optional[str] = None
    payment_verified: bool = False
    required_skills: List[str] = []
    preferred_skills: List[str] = []
    screening_questions: List[str] = []
    red_flags: List[str] = []
    match_score: Optional[int] = None
    reasoning: Optional[Dict[str, Any]] = None
    competition_level: Optional[str] = None
    status: str
    posted_at: Optional[datetime] = None

class JobCreate(JobBase):
    pass

class JobResponse(JobBase, OrmModel):
    id: uuid.UUID
    detected_at: datetime
    applied_at: Optional[datetime]
    updated_at: datetime

class JobUpdateStatus(BaseModel):
    status: Literal["new", "shortlisted", "applied", "invited", "interviewing", "hired", "rejected", "ignored"]

# --- Proposals ---
class ScreeningAnswer(BaseModel):
    question: str
    answer: str
    requires_personal_input: bool
    confidence: str

class ProposalDraftBase(BaseModel):
    cover_letter: str
    screening_answers: List[ScreeningAnswer] = []
    suggested_bid: Optional[float] = None
    timeline: Optional[str] = None
    tone: str = "professional"

class ProposalDraftResponse(ProposalDraftBase, OrmModel):
    id: uuid.UUID
    job_id: uuid.UUID
    version: int
    is_edited: bool
    edited_content: Optional[str] = None
    created_at: datetime

# --- AI Engine specific Schemas (used internally and by endpoints) ---
class JobIntelligence(BaseModel):
    job_title_normalized: str
    required_skills: List[str]
    preferred_skills: List[str]
    experience_level: Literal["Entry", "Intermediate", "Expert"]
    job_type: Literal["Fixed", "Hourly"]
    budget_min: Optional[float]
    budget_max: Optional[float]
    estimated_duration: Literal["Short", "Medium", "Long"]
    screening_questions: List[str]
    red_flags: List[str]
    client_country: Optional[str]
    domain: str

class MatchResult(BaseModel):
    match_score: int
    skill_coverage: float
    gap_skills: List[str]
    strength_points: List[str]
    weakness_points: List[str]
    competition_level: Literal["Low", "Medium", "High"]
    client_vibe: Literal["Professional", "Unclear", "Risky", "Excellent"]
    urgency_score: int
    recommended_bid: float
    recommended_action: Literal["Apply Now", "Apply Later", "Skip"]

# --- Chat & Tracking ---
class ChatMessageBase(BaseModel):
    role: Literal["user", "assistant"]
    content: str

class ChatMessageResponse(ChatMessageBase, OrmModel):
    id: uuid.UUID
    session_id: uuid.UUID
    created_at: datetime
    message_metadata: Dict[str, Any] = Field(default_factory=dict)

class ChatSessionResponse(OrmModel):
    id: uuid.UUID
    job_id: Optional[uuid.UUID]
    title: str
    context_type: str
    created_at: datetime
    messages: List[ChatMessageResponse] = []

class JobTrackingEventResponse(OrmModel):
    id: uuid.UUID
    job_id: uuid.UUID
    event_type: str
    note: Optional[str]
    metadata_json: Dict[str, Any]
    created_at: datetime

class InviteNotificationResponse(OrmModel):
    id: uuid.UUID
    job_id: Optional[uuid.UUID]
    source: str
    parsed_title: Optional[str]
    summary: Optional[str] = None
    raw_content: Optional[str] = None
    invite_url: Optional[str]
    notified_telegram: bool = False
    notified_web: bool = False
    created_at: datetime
