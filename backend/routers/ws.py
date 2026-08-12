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
    A per-session AI chat stream (JWT-authenticated via ?token=...). When the
    frontend sends a user message over this socket, the server calls Gemini
    with the conversation history (windowed + summarized), streams each text
    chunk back as it arrives, then persists both the user message and the
    completed assistant reply to the DB.
"""

import asyncio
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from loguru import logger
from sqlalchemy import select

from google import genai

from backend.ai_engine import _MODEL_NAME
from backend.database import AsyncSessionLocal
from backend.models import ChatMessage, ChatSession
from backend.routers import auth

router = APIRouter()

PROFILE_PATH = Path(__file__).parent.parent.parent / "config" / "profile.json"

# ---------------------------------------------------------------------------
# Chat stream constants
# ---------------------------------------------------------------------------

# Only the most recent N messages are sent to Gemini as a multi-turn history.
MAX_CONTEXT_MESSAGES = 20
# Overall cap for a single generation (including the one 429 retry).
STREAM_TIMEOUT_SECONDS = 120.0
# Keep the summary input bounded — never send more than this much old text.
SUMMARY_TEXT_LIMIT = 12_000
# Cap the job description embedded into the system context.
JOB_DESCRIPTION_LIMIT = 8_000

SUMMARY_PROMPT = (
    "Summarize the following conversation between a user and an AI assistant "
    "in 3-5 concise sentences. Capture the topic, decisions, and open questions:\n\n{text}"
)

# One shared async-capable Gemini client for the whole process. Constructing it
# at module top is safe because google-genai is a hard dependency; the guard
# keeps `_client = None` when no API key is configured.
_client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY")) if os.environ.get("GEMINI_API_KEY") else None

# Per-session single-flight locks: two sockets / rapid messages on the SAME
# session serialize their persist → generate → stream → persist cycle.
_session_locks: dict[str, asyncio.Lock] = {}


class ChatStreamError(Exception):
    """Raised when a Gemini stream fails in a way we format for the client."""


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

def _get_session_lock(session_id: str) -> asyncio.Lock:
    """Return the per-session single-flight lock, creating it on first use."""
    return _session_locks.setdefault(session_id, asyncio.Lock())


def _parse_payload(raw: str) -> dict:
    """Parse an incoming WS message into a dict, tolerating raw text."""
    try:
        payload = json.loads(raw)
        return payload if isinstance(payload, dict) else {}
    except json.JSONDecodeError:
        return {}


def _is_error_message(msg: ChatMessage) -> bool:
    """True for assistant messages persisted as generation errors."""
    return msg.role == "assistant" and (msg.message_metadata or {}).get("is_error") is True


def split_history(
    history: list[ChatMessage],
    max_messages: int = MAX_CONTEXT_MESSAGES,
) -> tuple[list[ChatMessage], list[ChatMessage]]:
    """
    Split the full conversation history into (keep, trimmed).

    `keep` is the most recent `max_messages` turns (sent to Gemini), and
    `trimmed` is the older turns that fall outside the context window.
    """
    if len(history) <= max_messages:
        return list(history), []
    return list(history[-max_messages:]), list(history[:-max_messages])


def build_gemini_history(
    history: list[ChatMessage],
    system_prompt: str,
    job_context: str,
    summary: str | None,
) -> list[dict]:
    """
    Build the Gemini multi-turn history from the raw DB history.

    - Skips assistant messages flagged as errors (is_error in message_metadata).
    - Applies the context window (split_history) so only the most recent
      MAX_CONTEXT_MESSAGES messages are sent.
    - Drops the last message: it is the user message that was just persisted
      and is sent separately via send_message_stream.
    - On a fresh session, injects the system prompt + job context as a first
      user turn (plus the prior-conversation summary when present). Otherwise,
      when a summary exists, prepends it as background context.
    """
    clean = [m for m in history if not _is_error_message(m)]
    keep, _ = split_history(clean)

    gemini_history = [
        {"role": "user", "parts": [{"text": m.content}]}
        if m.role == "user" else
        {"role": "model", "parts": [{"text": m.content}]}
        for m in keep[:-1]
    ]

    if not gemini_history:
        full_prompt = system_prompt + job_context
        if summary:
            full_prompt += "\n\nPRIOR CONVERSATION SUMMARY:\n" + summary
        gemini_history = [
            {"role": "user", "parts": [{"text": full_prompt}]},
            {"role": "model", "parts": [{"text": "Understood. I have full context and am ready to assist."}]},
        ]
    elif summary:
        gemini_history = [
            {"role": "user", "parts": [{"text": "PRIOR CONVERSATION SUMMARY (do not repeat this; it is background context):\n" + summary}]},
            {"role": "model", "parts": [{"text": "Understood."}]},
        ] + gemini_history

    return gemini_history


def _is_rate_limit(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(kw in msg for kw in ("429", "resourceexhausted", "quota", "rate limit"))


def _parse_retry_delay(message: str, fallback: float = 15.0) -> float:
    """Extract the retry delay from a Gemini 429 message; fallback 15s."""
    match = re.search(r"retry in (\d+(?:\.\d+)?)s", message, re.IGNORECASE)
    if not match:
        match = re.search(r"seconds:\s*(\d+)", message, re.IGNORECASE)
    return float(match.group(1)) + 1.5 if match else fallback


def _classify_error(exc: Exception) -> tuple[str, str]:
    """Map a generation exception to (friendly_message, error_type)."""
    if isinstance(exc, (ChatStreamError, asyncio.TimeoutError)):
        return "The AI response timed out. Please try again.", "timeout"
    if isinstance(exc, ValueError) and "GEMINI_API_KEY" in str(exc):
        return "AI is not configured (GEMINI_API_KEY missing). Please check server configuration.", "config"
    return f"AI Service Error: {str(exc)}", "generic"


async def _send_error_frame(websocket: WebSocket, message: str) -> None:
    """Send a structured error frame that older clients degrade gracefully on."""
    await websocket.send_json({"type": "error", "message": message, "chunk": "", "done": True})


async def _generate_summary(trimmed: list[ChatMessage]) -> str | None:
    """Summarize older conversation turns once via a non-streaming call."""
    if not trimmed or _client is None:
        return None
    text = "\n\n".join(f"{m.role}: {m.content}" for m in trimmed)
    text = text[-SUMMARY_TEXT_LIMIT:]
    try:
        response = await _client.aio.models.generate_content(
            model=_MODEL_NAME,
            contents=SUMMARY_PROMPT.format(text=text),
        )
        return (response.text or "").strip() or None
    except Exception as e:
        logger.warning(f"Failed to generate chat summary: {e}")
        return None


async def _generate_and_send(websocket: WebSocket, chat, user_content: str) -> str:
    """
    Stream Gemini output to the client chunk-by-chunk and return the full reply.
    Sends the terminal {"chunk": "", "done": True} frame on success.
    """
    full_reply = ""
    async for chunk in await chat.send_message_stream(user_content):
        if chunk.text:
            full_reply += chunk.text
            await websocket.send_json({"chunk": chunk.text, "done": False})
    await websocket.send_json({"chunk": "", "done": True})
    return full_reply


async def _generate_with_retry(websocket: WebSocket, user_content: str, gemini_history: list[dict]) -> str:
    """Create the chat, stream the reply, and retry ONCE on rate-limit errors."""
    for attempt in range(2):
        try:
            chat = _client.aio.chats.create(model=_MODEL_NAME, history=gemini_history)
            return await _generate_and_send(websocket, chat, user_content)
        except Exception as e:
            if attempt == 0 and _is_rate_limit(e):
                wait_sec = _parse_retry_delay(str(e))
                logger.warning(
                    f"Gemini API rate limit hit (429). Waiting {wait_sec:.1f}s before retrying..."
                )
                await asyncio.sleep(wait_sec)
                continue
            raise


async def _stream_with_timeout(websocket: WebSocket, user_content: str, gemini_history: list[dict]) -> str:
    """Run the (retrying) generation under a hard overall timeout."""
    try:
        return await asyncio.wait_for(
            _generate_with_retry(websocket, user_content, gemini_history),
            timeout=STREAM_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise ChatStreamError("Generation timed out")


async def _handle_turn(websocket: WebSocket, session_id: str, user_content: str) -> str | None:
    """
    Process one user turn: persist the user message, build context, stream the
    Gemini reply, and persist the assistant reply.

    Returns the raw text of a message received mid-generation (if any) so the
    caller can process it as the next turn, or None when the turn completed.
    Raises WebSocketDisconnect when the client disconnects mid-generation.
    """
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        await _send_error_frame(websocket, "Invalid or missing chat session.")
        await websocket.close(code=1008)
        raise WebSocketDisconnect

    async with _get_session_lock(session_id):
        job_context = ""
        history: list[ChatMessage] = []
        summary: str | None = None

        async with AsyncSessionLocal() as db:
            session_obj = await db.get(ChatSession, session_uuid)
            if not session_obj:
                await _send_error_frame(websocket, "Invalid or missing chat session.")
                await websocket.close(code=1008)
                raise WebSocketDisconnect

            # --- Persist user message & bump session recency ---
            user_msg = ChatMessage(session_id=session_uuid, role="user", content=user_content)
            db.add(user_msg)
            session_obj.updated_at = datetime.now(timezone.utc)
            await db.flush()

            # Load session-linked job context
            if session_obj.job_id:
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
{job_obj.description[:JOB_DESCRIPTION_LIMIT]}

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
                .where(ChatMessage.session_id == session_uuid)
                .order_by(ChatMessage.created_at)
            )
            history_result = await db.execute(stmt)
            history = list(history_result.scalars().all())

            # --- One-time summarization of the trimmed (older) context ---
            if session_obj.summary is None:
                clean = [m for m in history if not _is_error_message(m)]
                _, trimmed = split_history(clean)
                if trimmed:
                    summary_text = await _generate_summary(trimmed)
                    if summary_text:
                        session_obj.summary = summary_text
                        session_obj.updated_at = datetime.now(timezone.utc)

            summary = session_obj.summary
            await db.commit()

        # --- Stream Gemini response ---
        if _client is None:
            logger.error(f"WS /chat: GEMINI_API_KEY not configured (session {session_id})")
            await _send_error_frame(
                websocket,
                "AI is not configured (GEMINI_API_KEY missing). Please check server configuration.",
            )
            async with AsyncSessionLocal() as db:
                db.add(ChatMessage(
                    session_id=session_uuid,
                    role="assistant",
                    content="AI is not configured (GEMINI_API_KEY missing). Please check server configuration.",
                    message_metadata={"is_error": True, "error_type": "config"},
                ))
                await db.commit()
            return None

        gemini_history = build_gemini_history(history, _system_prompt, job_context, summary)

        # Run generation concurrently with a disconnect/cancel waiter so the
        # client can abort mid-stream without blocking the event loop.
        generation_task = asyncio.create_task(
            _stream_with_timeout(websocket, user_content, gemini_history)
        )
        disconnect_waiter = asyncio.create_task(websocket.receive_text())

        done, _ = await asyncio.wait(
            {generation_task, disconnect_waiter},
            return_when=asyncio.FIRST_COMPLETED,
        )

        if generation_task in done:
            # Generation finished (or failed) first — cancel the receive waiter.
            disconnect_waiter.cancel()
            try:
                await disconnect_waiter
            except (asyncio.CancelledError, WebSocketDisconnect):
                pass
            except Exception:
                pass

            error_type = None
            try:
                full_reply = generation_task.result()
            except asyncio.CancelledError:
                raise WebSocketDisconnect
            except Exception as e:
                logger.error(f"Gemini streaming error in session {session_id}: {e}")
                error_type, friendly = _classify_error(e)
                full_reply = friendly
                await _send_error_frame(websocket, friendly)

            # --- Persist assistant reply (errors never pollute future context) ---
            async with AsyncSessionLocal() as db:
                db.add(ChatMessage(
                    session_id=session_uuid,
                    role="assistant",
                    content=full_reply,
                    message_metadata={"is_error": True, "error_type": error_type} if error_type else {},
                ))
                await db.commit()
            return None

        # The client disconnected, cancelled, or sent another message while we
        # were generating. Cancel the task; nothing more gets persisted.
        generation_task.cancel()
        await asyncio.gather(generation_task, return_exceptions=True)

        try:
            next_raw = disconnect_waiter.result()
        except (WebSocketDisconnect, asyncio.CancelledError):
            raise WebSocketDisconnect
        except Exception:
            raise WebSocketDisconnect

        payload = _parse_payload(next_raw)
        if payload.get("type") == "cancel":
            await websocket.send_json({"chunk": "", "done": True})
            return None
        if not str(payload.get("content", "")).strip():
            return None
        return next_raw


@router.websocket("/chat/{session_id}")
async def websocket_chat(websocket: WebSocket, session_id: str) -> None:
    """
    Streaming AI chat for a specific session.

    Protocol (JSON over WebSocket):
      → Client sends:  { "content": "<user message>" }  or { "type": "cancel" }
      ← Server streams: { "chunk": "<partial text>", "done": false }
      ← Server sends:  { "chunk": "", "done": true }  when complete
      ← Server sends:  { "type": "error", "message": "...", "chunk": "", "done": true }

    The connection is authenticated via the JWT passed in the query string
    (`?token=...`) BEFORE accept. Per-session single-flight locks serialize
    concurrent sockets/messages on the same session.
    """
    token = websocket.query_params.get("token", "")
    if not token:
        logger.warning(f"WS /chat rejected: missing token (session {session_id})")
        await websocket.close(code=1008, reason="Unauthorized")
        return
    try:
        auth._decode_token(token)
    except Exception as e:
        logger.warning(f"WS /chat rejected: invalid token (session {session_id}): {e}")
        await websocket.close(code=1008, reason="Unauthorized")
        return

    await websocket.accept()
    logger.info(f"WS /chat connected for session {session_id}")

    try:
        while True:
            raw = await websocket.receive_text()
            # Inner loop processes messages that arrive mid-generation.
            while True:
                payload = _parse_payload(raw)
                if payload.get("type") == "cancel":
                    break
                user_content = str(payload.get("content", "")).strip()
                if not user_content:
                    break
                next_raw = await _handle_turn(websocket, session_id, user_content)
                if next_raw is None:
                    break
                raw = next_raw
    except WebSocketDisconnect:
        logger.info(f"WS /chat disconnected for session {session_id}")
    except Exception as e:
        logger.error(f"WS /chat error for session {session_id}: {e}")
    finally:
        _session_locks.pop(session_id, None)
