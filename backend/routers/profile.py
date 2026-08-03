"""
Profile Router.

This module provides endpoints for reading, updating, exporting, and importing
the user's candidate profile stored in config/profile.json.

Endpoints:
  GET  /profile/         — read current profile
  PUT  /profile/         — overwrite profile
  GET  /profile/export   — download profile.json as a file attachment
  POST /profile/import   — upload a JSON file to replace the profile (with validation)
"""

import io
import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

router = APIRouter()

# Absolute path to the single source-of-truth profile JSON file.
PROFILE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "config",
    "profile.json",
)

# Required top-level keys that any imported profile must contain.
REQUIRED_KEYS = {"name", "title", "skills"}


def _load_profile() -> dict:
    """Read and parse profile.json, raising HTTPException on failure."""
    if not os.path.exists(PROFILE_PATH):
        raise HTTPException(status_code=404, detail="Profile configuration not found.")
    with open(PROFILE_PATH, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=500, detail=f"Invalid profile JSON: {exc}") from exc


def _save_profile(data: dict) -> None:
    """Write data to profile.json, creating the directory if needed."""
    os.makedirs(os.path.dirname(PROFILE_PATH), exist_ok=True)
    with open(PROFILE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ─── Standard CRUD ────────────────────────────────────────────────────────────

@router.get("/")
async def get_profile():
    """Fetch the current candidate profile as a JSON object."""
    return _load_profile()


@router.put("/")
async def update_profile(updated_data: dict):
    """Overwrite the candidate profile with the supplied JSON body."""
    _save_profile(updated_data)
    return {"message": "Profile updated successfully.", "profile": updated_data}


# ─── Export ───────────────────────────────────────────────────────────────────

@router.get("/export")
async def export_profile():
    """
    Stream the current profile.json as a downloadable file attachment.

    The filename is timestamped so multiple exports don't overwrite each other,
    e.g. upwork_profile_2026-08-03.json.
    """
    data = _load_profile()
    content = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"upwork_profile_{today}.json"

    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(content)),
        },
    )


# ─── Import ───────────────────────────────────────────────────────────────────

@router.post("/import")
async def import_profile(file: UploadFile = File(...)):
    """
    Replace the current profile.json with an uploaded JSON file.

    Validation rules:
      - File must be valid JSON.
      - Must contain the required top-level keys: name, title, skills.
      - File size limit: 512 KB (protects against accidental huge uploads).

    On success, the old profile is overwritten and the new profile is returned.
    """
    MAX_BYTES = 512 * 1024  # 512 KB

    raw = await file.read()

    if len(raw) > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(raw)} bytes). Maximum allowed is {MAX_BYTES} bytes.",
        )

    # Parse JSON
    try:
        imported_data = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid JSON file: {exc}",
        ) from exc

    if not isinstance(imported_data, dict):
        raise HTTPException(
            status_code=422,
            detail="Imported file must be a JSON object (not an array or primitive).",
        )

    # Check required keys
    missing = REQUIRED_KEYS - set(imported_data.keys())
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Imported profile is missing required fields: {', '.join(sorted(missing))}",
        )

    _save_profile(imported_data)
    return {
        "message": "Profile imported successfully.",
        "fields_imported": list(imported_data.keys()),
        "profile": imported_data,
    }
