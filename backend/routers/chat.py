"""
Chat Router.

This module provides endpoints for AI Chat sessions linked to jobs,
allowing the user to ask Gemini for advice, rewrite proposals, etc.
"""

import uuid
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from backend.database import get_db
from backend.models import ChatSession, ChatMessage, Job
from backend.routers.auth import get_current_user
from backend.schemas import ChatSessionResponse, ChatMessageResponse, ChatMessageBase
from pydantic import BaseModel

from sqlalchemy.orm import selectinload

router = APIRouter()

class SessionCreate(BaseModel):
    title: str
    context_type: str = "general"
    job_id: uuid.UUID | None = None

class SessionUpdate(BaseModel):
    title: str

@router.get("/sessions", response_model=List[ChatSessionResponse])
async def get_sessions(job_id: uuid.UUID | None = None, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Fetch chat sessions, optionally filtered by job_id."""
    stmt = select(ChatSession).options(selectinload(ChatSession.messages)).order_by(desc(ChatSession.updated_at), desc(ChatSession.created_at))
    if job_id:
        stmt = stmt.where(ChatSession.job_id == job_id)
        
    result = await db.execute(stmt)
    sessions = result.scalars().all()
    return sessions

@router.post("/sessions", response_model=ChatSessionResponse)
async def create_session(session_data: SessionCreate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Create a new chat session."""
    if session_data.job_id:
        job = await db.get(Job, session_data.job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
            
    session = ChatSession(
        title=session_data.title,
        context_type=session_data.context_type,
        job_id=session_data.job_id
    )
    
    db.add(session)
    await db.commit()
    
    stmt = select(ChatSession).where(ChatSession.id == session.id).options(selectinload(ChatSession.messages))
    res = await db.execute(stmt)
    return res.scalar_one()

@router.patch("/sessions/{session_id}", response_model=ChatSessionResponse)
async def update_session_title(session_id: uuid.UUID, update: SessionUpdate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Update the title of a chat session."""
    session = await db.get(ChatSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.title = update.title
    await db.commit()
    stmt = select(ChatSession).where(ChatSession.id == session_id).options(selectinload(ChatSession.messages))
    res = await db.execute(stmt)
    return res.scalar_one()

@router.delete("/sessions/{session_id}", response_model=dict)
async def delete_session(session_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Delete a chat session and all its messages."""
    session = await db.get(ChatSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.delete(session)
    await db.commit()
    return {"deleted": True}

@router.get("/sessions/{session_id}/messages", response_model=List[ChatMessageResponse])
async def get_messages(session_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Fetch all messages for a specific session."""
    stmt = select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at)
    result = await db.execute(stmt)
    return result.scalars().all()

@router.post("/sessions/{session_id}/messages", response_model=ChatMessageResponse)
async def create_message(session_id: uuid.UUID, message_data: ChatMessageBase, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Add a user or assistant message to a session."""
    session = await db.get(ChatSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
        
    message = ChatMessage(
        session_id=session_id,
        role=message_data.role,
        content=message_data.content
    )
    
    db.add(message)
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(message)
    
    # In a full implementation, calling this endpoint as "user" would trigger 
    # a background task or immediate call to Gemini to generate the "assistant" reply.
    return message
