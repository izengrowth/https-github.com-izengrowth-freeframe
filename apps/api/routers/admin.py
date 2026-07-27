"""Admin endpoints for user management."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime, timezone
from typing import Optional
import uuid
import json
import os
import tempfile

from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User, UserStatus
from ..schemas.auth import UserResponse, UpdateUserRoleRequest

router = APIRouter(prefix="/admin", tags=["admin"])

# ── Keep-alive state (file-backed in /tmp, survives restarts without DB migration) ──────

_KEEP_ALIVE_FILE = os.path.join(tempfile.gettempdir(), "freeframe_keep_alive_state.json")

def _load_keep_alive() -> dict:
    try:
        with open(_KEEP_ALIVE_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {"enabled": True, "last_ping": None}

def _save_keep_alive(state: dict):
    try:
        with open(_KEEP_ALIVE_FILE, "w") as f:
            json.dump(state, f)
    except Exception:
        pass

class KeepAliveStatus(BaseModel):
    enabled: bool
    last_ping: Optional[str] = None

class KeepAliveUpdate(BaseModel):
    enabled: bool


@router.get("/keep-alive", response_model=KeepAliveStatus)
def get_keep_alive_status(
    current_user: User = Depends(get_current_user),
):
    """Get current keep-alive status. Admin only."""
    if not current_user.is_superadmin:
        raise HTTPException(status_code=403, detail="Admins only")
    return KeepAliveStatus(**_load_keep_alive())


@router.post("/keep-alive", response_model=KeepAliveStatus)
def set_keep_alive(
    body: KeepAliveUpdate,
    current_user: User = Depends(get_current_user),
):
    """Enable or disable the keep-alive cron. Admin only."""
    if not current_user.is_superadmin:
        raise HTTPException(status_code=403, detail="Admins only")
    state = _load_keep_alive()
    state["enabled"] = body.enabled
    _save_keep_alive(state)
    return KeepAliveStatus(**state)


@router.get("/keep-alive/status")
def public_keep_alive_status():
    """Public endpoint — GitHub Actions cron checks this before pinging."""
    state = _load_keep_alive()
    state["last_ping"] = datetime.now(timezone.utc).isoformat()
    _save_keep_alive(state)
    return {"enabled": state.get("enabled", True)}


# ── User management endpoints ──────────────────────────────────────────────────

@router.get("/users", response_model=list[UserResponse])
def list_all_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all users in the system. Only accessible by admins."""
    if not current_user.is_superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can access this endpoint")
    users = db.query(User).filter(User.deleted_at.is_(None)).all()
    return users

@router.patch("/users/{user_id}/deactivate", response_model=UserResponse)
def deactivate_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Deactivate a user. Admins cannot deactivate themselves."""
    if not current_user.is_superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can deactivate users")
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate yourself")
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.status = UserStatus.deactivated
    db.commit()
    db.refresh(user)
    return user

@router.patch("/users/{user_id}/reactivate", response_model=UserResponse)
def reactivate_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reactivate a deactivated user. Only accessible by admins."""
    if not current_user.is_superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can reactivate users")
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.status = UserStatus.active
    db.commit()
    db.refresh(user)
    return user

@router.patch("/users/{user_id}/role", response_model=UserResponse)
def update_user_role(
    user_id: uuid.UUID,
    body: UpdateUserRoleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Promote or demote a user to/from admin role. Only accessible by admins."""
    if not current_user.is_superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can change user roles")
    if user_id == current_user.id and not body.is_admin:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot remove your own admin role")
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_superadmin = body.is_admin
    db.commit()
    db.refresh(user)
    return user
