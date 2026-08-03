"""
Job Tracker Router.

This module provides endpoints for managing the job lifecycle (Kanban)
and creating/fetching job tracking events like notes, reminders, etc.
"""

import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from backend.database import get_db
from backend.models import JobTrackingEvent, Job
from backend.schemas import JobTrackingEventResponse
from pydantic import BaseModel

router = APIRouter()

class EventCreate(BaseModel):
    event_type: str
    note: str | None = None
    metadata_json: dict = {}

@router.get("/job/{job_id}", response_model=List[JobTrackingEventResponse])
async def get_events_for_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Fetch the timeline of tracking events for a specific job."""
    stmt = select(JobTrackingEvent).where(JobTrackingEvent.job_id == job_id).order_by(desc(JobTrackingEvent.created_at))
    result = await db.execute(stmt)
    events = result.scalars().all()
    return events

@router.post("/job/{job_id}", response_model=JobTrackingEventResponse)
async def create_event(
    job_id: uuid.UUID, 
    event_data: EventCreate, 
    db: AsyncSession = Depends(get_db)
):
    """Add a new tracking event (e.g., status change, note) to a job."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    event = JobTrackingEvent(
        job_id=job.id,
        event_type=event_data.event_type,
        note=event_data.note,
        metadata_json=event_data.metadata_json
    )
    
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event
