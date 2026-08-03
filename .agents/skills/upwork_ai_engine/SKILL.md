---
name: upwork_ai_engine
description: >
  Knowledge and conventions for working on the Up_and_Work AI engine.
  Triggers when: building, modifying, debugging, or extending the 5-stage
  Gemini AI pipeline (job extraction, matching, cover letter, Q&A, bid strategy),
  the AI chat system, or any Gemini API integration in this project.
---

# Up_and_Work — AI Engine Skill

## Overview
The AI engine in Up_and_Work is a **5-stage sequential pipeline** powered by Google Gemini.
Every stage builds on the previous one. All outputs are structured JSON validated with Pydantic.

## File: `backend/ai_engine.py`
This is the single source of truth for all AI logic. Do NOT scatter AI prompts across other files.

## Stage Reference

### Stage 1 — Job Intelligence Extraction
**Input:** Raw RSS job description text (messy HTML/text)
**Output Schema:**
```python
class JobIntelligence(BaseModel):
    job_title_normalized: str
    required_skills: list[str]
    preferred_skills: list[str]
    experience_level: Literal["Entry", "Intermediate", "Expert"]
    job_type: Literal["Fixed", "Hourly"]
    budget_min: float | None
    budget_max: float | None
    estimated_duration: Literal["Short", "Medium", "Long"]
    screening_questions: list[str]
    red_flags: list[str]
    client_country: str | None
    domain: str  # e.g. "E-commerce", "FinTech", "SaaS"
```

### Stage 2 — Weighted Job Matching
**Input:** `JobIntelligence` + `profile.json` content
**Output Schema:**
```python
class MatchResult(BaseModel):
    match_score: int  # 0-100
    skill_coverage: float  # percentage of required_skills covered
    gap_skills: list[str]
    strength_points: list[str]
    weakness_points: list[str]
    competition_level: Literal["Low", "Medium", "High"]
    client_vibe: Literal["Professional", "Unclear", "Risky", "Excellent"]
    urgency_score: int  # 0-10
    recommended_bid: float
    recommended_action: Literal["Apply Now", "Apply Later", "Skip"]
```

**Scoring weights (encode in prompt):**
- Skill coverage: 40%
- Budget fit: 20%
- Client rating/history: 15%
- Job clarity & scope: 15%
- Domain match: 10%

### Stage 3 — Cover Letter Generation
**Input:** `JobIntelligence` + `MatchResult` + `profile.json`
**Output Schema:**
```python
class CoverLetter(BaseModel):
    hook_line: str
    proof_section: str
    approach_summary: str
    differentiator: str
    call_to_action: str
    full_letter: str  # assembled from above sections
    tone_used: str
```

**Always instruct Gemini:**
- Avoid generic openers like "I am writing to apply..."
- Reference the client's exact problem from the job description
- Use a concrete past project from `profile.json["experience"]`

### Stage 4 — Screening Q&A
**Input:** `screening_questions` from Stage 1 + `profile.json`
**Output Schema:**
```python
class ScreeningAnswers(BaseModel):
    answers: list[ScreeningAnswer]

class ScreeningAnswer(BaseModel):
    question: str
    answer: str
    requires_personal_input: bool  # True if agent can't answer (e.g. availability)
    confidence: Literal["High", "Medium", "Low"]
```

### Stage 5 — Bid & Timeline Strategy
**Input:** `MatchResult` + `profile.json["target_rate"]` + `JobIntelligence`
**Output Schema:**
```python
class BidStrategy(BaseModel):
    suggested_bid: float
    bid_rationale: str
    timeline_weeks: int
    timeline_breakdown: list[str]  # e.g. ["Week 1: Setup & API design", ...]
    risk_assessment: str
    alternative_strategies: list[str]
```

## Gemini API Usage Pattern
```python
import google.generativeai as genai
import json

model = genai.GenerativeModel(
    model_name="gemini-2.0-flash",
    generation_config={"response_mime_type": "application/json"}
)

response = model.generate_content(prompt)
data = json.loads(response.text)
validated = OutputSchema.model_validate(data)
```

## AI Chat System
- Chat is stored in `chat_sessions` and `chat_messages` tables.
- For job-specific chat, load full context: job description, proposal, match result, current status.
- Use Gemini's multi-turn conversation API (pass full history each call).
- Stream responses via WebSocket to the frontend.
- Context injection template:
```
You are an expert freelance career coach and Upwork strategist.
The user is discussing this specific job:

JOB TITLE: {job_title}
JOB DESCRIPTION: {description}
MATCH SCORE: {match_score}/100
CURRENT PROPOSAL: {cover_letter}
JOB STATUS: {status}
USER PROFILE SUMMARY: {profile_summary}

Help the user with their question below. Be specific, practical, and honest.
```

## Error Handling
- Wrap all Gemini calls in try/except.
- On JSON parse error: retry once with `"Return only valid JSON, nothing else."` appended.
- On API error: log with loguru, mark job as `ai_failed` in DB, continue to next job.
- Never raise an unhandled exception from the AI engine — it must be fault-tolerant.

## Performance Notes
- Run Stage 1+2 first. Only run Stages 3-5 if `match_score >= threshold`.
- Use `asyncio.gather` to process multiple jobs concurrently (max 5 at a time).
- Cache `profile.json` in memory at startup — don't re-read from disk per job.
