"""
WebSocket Router.

This module provides real-time bidirectional communication with the Vite/React
frontend for two purposes:

  /ws/jobs
    A broadcast channel. The ConnectionManager keeps a list of all connected
    clients. When rss_monitor.py saves a new job and processes it through the
    AI pipeline, it calls manager.broadcast() to push the new job event to
    every connected dashboard client so the feed updates in real time.

  /ws/chat/{session_id}
    A per-session AI chat stream. When the frontend sends a user message over
    this socket, the server calls Gemini with the full conversation history,
    streams each text chunk back as it arrives, then persists both the user
    message and the completed assistant reply to the DB.
"""

import asyncio
import json
import os
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from loguru import logger
from sqlalchemy import select

from backend.database import AsyncSessionLocal
from backend.models import ChatMessage, ChatSession

router = APIRouter()

PROFILE_PATH = Path(__file__).parent.parent.parent / "config" / "profile.json"


def _load_profile() -> dict:
    if PROFILE_PATH.exists():
        with open(PROFILE_PATH, "r") as f:
            return json.load(f)
    return {}


def _build_system_prompt(profile_data: dict) -> str:
    person = profile_data.get("person", {})
    skills = profile_data.get("skills", [])
    experience = profile_data.get("experience", [])
    projects = profile_data.get("projects", [])
    education = profile_data.get("education", [])
    achievements = profile_data.get("achievements", [])
    summary = person.get("summary", "")
    name = person.get("name", "the candidate")
    title = person.get("title", "Software Engineer")

    profile_summary = f"""
CANDIDATE PROFILE:
Name: {name}
Title: {title}
Summary: {summary}

SKILLS: {', '.join(skills)}

EXPERIENCE:
{json.dumps(experience, indent=2)}

PROJECTS:
{json.dumps(projects, indent=2)}

EDUCATION:
{json.dumps(education, indent=2)}

ACHIEVEMENTS:
{json.dumps(achievements, indent=2)}
"""

    return f"""You are an expert Upwork proposal assistant helping {name}, a {title}.

You know the following about the candidate:
{profile_summary}

When answering questions, refer to the candidate's actual experience, skills, and projects.
When generating proposals, use the candidate's real projects and achievements as proof points.
Be concise, direct, and professional. Always tailor advice to the candidate's specific background.
"""


# ---------------------------------------------------------------------------
# Connection Manager — shared singleton used by rss_monitor.py to broadcast
# ---------------------------------------------------------------------------

class ConnectionManager:
    """
    Tracks all open WebSocket connections and provides a broadcast helper.
    Stale connections are silently removed on send failure.
    """

    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WS /jobs: new connection (total={len(self.active_connections)})")

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WS /jobs: connection closed (total={len(self.active_connections)})")

    async def broadcast(self, message: dict) -> None:
        """Send a JSON message to every connected client. Remove dead connections."""
        dead: list[WebSocket] = []
        for ws in self.active_connections:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


# Module-level singleton — imported by rss_monitor.py
manager = ConnectionManager()

# Load profile once at startup
_profile_data = _load_profile()
_system_prompt = _build_system_prompt(_profile_data)


# ---------------------------------------------------------------------------
# /ws/jobs — live job feed
# ---------------------------------------------------------------------------

@router.websocket("/jobs")
async def websocket_jobs(websocket: WebSocket) -> None:
    """
    Keep the connection alive so rss_monitor.py can broadcast new job events.
    The client side (Dashboard.tsx) listens for these events and invalidates
    its React Query cache to re-fetch the jobs list.
    """
    await manager.connect(websocket)
    try:
        while True:
            # Wait for client messages or tab close / disconnect
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


# ---------------------------------------------------------------------------
# /ws/chat/{session_id} — streaming AI chat
# ---------------------------------------------------------------------------

@router.websocket("/chat/{session_id}")
async def websocket_chat(websocket: WebSocket, session_id: str) -> None:
    """
    Streaming AI chat for a specific session.

    Protocol (JSON over WebSocket):
      → Client sends:  { "content": "<user message>" }
      ← Server streams: { "chunk": "<partial text>", "done": false }
      ← Server sends:  { "chunk": "", "done": true }  when complete

    Conversation history is loaded from the DB on every turn so Gemini has
    full context. Both the user message and the finished assistant reply are
    persisted to the DB.
    """
    await websocket.accept()
    logger.info(f"WS /chat connected for session {session_id}")

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                payload = json.loads(raw)
                user_content: str = payload.get("content", "").strip()
            except json.JSONDecodeError:
                user_content = raw.strip()

            if not user_content:
                continue

            # --- Persist user message & fetch session job context ---
            job_context = ""
            async with AsyncSessionLocal() as db:
                user_msg = ChatMessage(
                    session_id=session_id,
                    role="user",
                    content=user_content,
                )
                db.add(user_msg)
                await db.flush()

                # Load session object to check if linked to a job
                session_obj = await db.get(ChatSession, session_id)
                if session_obj and session_obj.job_id:
                    from backend.models import Job, ProposalDraft
                    job_obj = await db.get(Job, session_obj.job_id)
                    if job_obj:
                        stmt_prop = select(ProposalDraft).where(ProposalDraft.job_id == job_obj.id).order_by(ProposalDraft.version.desc())
                        prop_result = await db.execute(stmt_prop)
                        prop_obj = prop_result.scalars().first()

                        job_context = f"""\n\nTARGET JOB CONTEXT FOR THIS CONVERSATION:
Job Title: {job_obj.title}
Job Link: {job_obj.link}
Match Score: {job_obj.match_score}%
Budget: {job_obj.budget_type or 'Unspecified'} (Min: {job_obj.budget_min}, Max: {job_obj.budget_max})
Client Country: {job_obj.client_country or 'Unknown'} (Rating: {job_obj.client_rating or 'N/A'})
Required Skills: {', '.join(job_obj.required_skills or [])}
Red Flags: {', '.join(job_obj.red_flags or [])}

Job Description:
{job_obj.description}

AI Match Analysis:
{json.dumps(job_obj.reasoning or {}, indent=2)}

Generated Proposal Cover Letter:
{prop_obj.cover_letter if prop_obj else 'No proposal generated yet.'}

Screening Q&A:
{json.dumps(prop_obj.screening_answers, indent=2) if prop_obj and prop_obj.screening_answers else 'None'}
"""

                # Load full conversation history
                stmt = (
                    select(ChatMessage)
                    .where(ChatMessage.session_id == session_id)
                    .order_by(ChatMessage.created_at)
                )
                history_result = await db.execute(stmt)
                history = history_result.scalars().all()

                await db.commit()

            # --- Build Gemini chat history ---
            gemini_history = [
                {"role": "user", "parts": [{"text": m.content}]}
                if m.role == "user" else
                {"role": "model", "parts": [{"text": m.content}]}
                for m in history[:-1]
            ]

            # Inject system prompt + job context as first turn if history is new
            if not gemini_history:
                full_prompt = _system_prompt + job_context
                gemini_history = [
                    {"role": "user", "parts": [{"text": full_prompt}]},
                    {"role": "model", "parts": [{"text": f"Understood. I have full context for '{job_obj.title if 'job_obj' in locals() and job_obj else 'this job'}' and am ready to assist {_profile_data.get('person', {}).get('name', 'the candidate')}."}]},
                ]

            # --- Stream Gemini response ---
            full_reply = ""
            try:
                from google import genai
                from backend.ai_engine import _MODEL_NAME

                api_key = os.environ.get("GEMINI_API_KEY")
                client = genai.Client(api_key=api_key) if api_key else None

                if not client:
                    raise ValueError("GEMINI_API_KEY not configured")

                chat = client.chats.create(model=_MODEL_NAME, history=gemini_history)

                # generate_content with stream=True in a thread (sync SDK)
                def _stream_sync():
                    return chat.send_message_stream(user_content)

                response_stream = await asyncio.to_thread(_stream_sync)

                for chunk in response_stream:
                    if chunk.text:
                        full_reply += chunk.text
                        # Stream each chunk to the frontend
                        await websocket.send_json({"chunk": chunk.text, "done": False})

                # Signal stream completion
                await websocket.send_json({"chunk": "", "done": True})

            except Exception as e:
                logger.error(f"Gemini streaming error in session {session_id}: {e}")
                if "429" in str(e) or "quota" in str(e).lower():
                    error_text = "⏳ Gemini API rate limit reached (Free Tier 15 RPM). Please wait ~15 seconds and try sending your message again."
                else:
                    error_text = f"AI Service Error: {str(e)}"
                full_reply = error_text
                await websocket.send_json({"chunk": error_text, "done": True})

            # --- Persist assistant reply ---
            async with AsyncSessionLocal() as db:
                assistant_msg = ChatMessage(
                    session_id=session_id,
                    role="assistant",
                    content=full_reply,
                )
                db.add(assistant_msg)
                await db.commit()

    except WebSocketDisconnect:
        logger.info(f"WS /chat disconnected for session {session_id}")
    except Exception as e:
        logger.error(f"WS /chat error for session {session_id}: {e}")
