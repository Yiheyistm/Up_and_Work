"""
Proposals Router.

This module provides the REST API endpoints for fetching and managing
AI-generated proposal drafts (cover letters, Q&A) for jobs.
"""

import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from backend.database import get_db
from backend.models import ProposalDraft
from backend.schemas import ProposalDraftResponse, ProposalDraftBase

router = APIRouter()

import json
from pathlib import Path
from backend.models import Job, ProposalDraft
from backend.schemas import ProposalDraftResponse, ProposalDraftBase
from backend.ai_engine import extract_job_intelligence, evaluate_match, generate_proposal

PROFILE_PATH = Path(__file__).parent.parent.parent / "config" / "profile.json"

def _load_profile_dict() -> dict:
    if PROFILE_PATH.exists():
        with open(PROFILE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

@router.get("/job/{job_id}", response_model=List[ProposalDraftResponse])
async def get_proposals_for_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Fetch all proposal drafts generated for a specific job."""
    stmt = select(ProposalDraft).where(ProposalDraft.job_id == job_id).order_by(desc(ProposalDraft.version))
    result = await db.execute(stmt)
    proposals = result.scalars().all()
    return proposals

@router.put("/{proposal_id}", response_model=ProposalDraftResponse)
async def update_proposal(
    proposal_id: uuid.UUID,
    update_data: ProposalDraftBase,
    db: AsyncSession = Depends(get_db)
):
    """Update a proposal draft (e.g., when the user manually edits the cover letter)."""
    proposal = await db.get(ProposalDraft, proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")
        
    proposal.cover_letter = update_data.cover_letter
    proposal.screening_answers = [a.model_dump() for a in update_data.screening_answers]
    proposal.suggested_bid = update_data.suggested_bid
    proposal.is_edited = True
    
    await db.commit()
    await db.refresh(proposal)
    return proposal

@router.post("/job/{job_id}/regenerate", response_model=ProposalDraftResponse)
async def regenerate_proposal_for_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Regenerate an AI proposal draft for a specific job."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    profile_data = _load_profile_dict()

    intel = await extract_job_intelligence(job.description)
    match = await evaluate_match(intel, profile_data)
    proposal_draft = await generate_proposal(intel, match, profile_data, job.description)

    stmt = select(ProposalDraft).where(ProposalDraft.job_id == job_id).order_by(desc(ProposalDraft.version))
    result = await db.execute(stmt)
    existing_proposal = result.scalars().first()
    new_version = (existing_proposal.version + 1) if existing_proposal else 1

    db_proposal = ProposalDraft(
        job_id=job.id,
        cover_letter=proposal_draft.cover_letter,
        screening_answers=[a.model_dump() for a in proposal_draft.screening_answers],
        suggested_bid=proposal_draft.suggested_bid,
        timeline=proposal_draft.timeline,
        tone=proposal_draft.tone,
        version=new_version
    )
    db.add(db_proposal)
    job.status = "shortlisted"
    await db.commit()
    await db.refresh(db_proposal)
    return db_proposal
