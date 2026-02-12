from __future__ import annotations

from pathlib import Path

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import func

from ..common.audit import audit
from ..common.errors import APIError
from ..common.rbac import current_user, permission_required
from ..common.storage import delete_storage_path
from ..extensions import db
from ..models import AppSettings, FileNode, FileNodeType, PermissionCode, Role, User


admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


def _resolve_roles(payload: dict) -> list[Role]:
    role_ids = payload.get("role_ids") or []
    role_names = payload.get("role_names") or []

    roles: list[Role] = []
    if role_ids:
        roles.extend(Role.query.filter(Role.id.in_([int(item) for item in role_ids])).all())
    if role_names:
        roles.extend(Role.query.filter(Role.name.in_(role_names)).all())

    if not roles:
        default_role = Role.query.filter_by(name="user").one_or_none()
        if default_role is None:
            raise APIError(500, "RBAC_NOT_READY", "Default user role is missing.")
        roles = [default_role]

    unique_by_id: dict[int, Role] = {role.id: role for role in roles}
    return list(unique_by_id.values())


@admin_bp.get("/settings")
@jwt_required()
@permission_required(PermissionCode.SERVER_SETTINGS)
def get_settings():
    settings = AppSettings.singleton()
    return jsonify({"settings": settings.to_dict()})


@admin_bp.put("/settings")
@jwt_required()
@permission_required(PermissionCode.SERVER_SETTINGS)
def update_settings():
    user = current_user(required=True)
    assert user is not None

    settings = AppSettings.singleton()
    payload = request.get_json(silent=True) or {}

    if "allow_registration" in payload:
        settings.allow_registration = bool(payload["allow_registration"])
    if "max_upload_size" in payload:
        value = int(payload["max_upload_size"])
        if value <= 0:
            raise APIError(400, "INVALID_SETTINGS", "max_upload_size must be > 0")
        settings.max_upload_size = value
    if "default_quota" in payload:
        value = int(payload["default_quota"])
        if value <= 0:
            raise APIError(400, "INVALID_SETTINGS", "default_quota must be > 0")
        settings.default_quota = value

    audit(
        action="admin.settings_update",
        actor=user,
        target_type="settings",
        target_id="1",
        details=settings.to_dict(),
    )
    db.session.commit()
    return jsonify({"settings": settings.to_dict()})


@admin_bp.get("/users")
@jwt_required()
@permission_required(PermissionCode.USER_MANAGE)
def list_users():
    users = User.query.order_by(User.id.asc()).all()
    return jsonify({"items": [user.to_dict() for user in users]})


@admin_bp.post("/users")
@jwt_required()
@permission_required(PermissionCode.USER_MANAGE)
def create_user():
    actor = current_user(required=True)
    assert actor is not None

    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""

    if len(username) < 3:
        raise APIError(400, "INVALID_USERNAME", "Username must be at least 3 characters.")
    if len(password) < 8:
        raise APIError(400, "INVALID_PASSWORD", "Password must be at least 8 characters.")

    exists = User.query.filter(func.lower(User.username) == username.lower()).one_or_none()
    if exists is not None:
        raise APIError(409, "USER_EXISTS", "Username is already taken.")

    settings = AppSettings.singleton()
    bytes_limit = int(payload.get("bytes_limit") or settings.default_quota)
    if bytes_limit <= 0:
        raise APIError(400, "INVALID_QUOTA", "bytes_limit must be > 0")

    user = User(
        username=username,
        bytes_limit=bytes_limit,
        bytes_used=0,
        is_active=bool(payload.get("is_active", True)),
    )
    user.set_password(password)
    user.roles = _resolve_roles(payload)

    db.session.add(user)
    db.session.flush()
    audit(
        action="admin.user_create",
        actor=actor,
        target_type="user",
        target_id=str(user.id),
        details={"username": username},
    )
    db.session.commit()

    return jsonify({"user": user.to_dict()}), 201


@admin_bp.patch("/users/<int:user_id>")
@jwt_required()
@permission_required(PermissionCode.USER_MANAGE)
def update_user(user_id: int):
    actor = current_user(required=True)
    assert actor is not None

    user = db.session.get(User, user_id)
    if user is None:
        raise APIError(404, "USER_NOT_FOUND", "User not found.")

    payload = request.get_json(silent=True) or {}

    if "username" in payload:
        username = (payload.get("username") or "").strip()
        if len(username) < 3:
            raise APIError(400, "INVALID_USERNAME", "Username must be at least 3 characters.")

        conflict = User.query.filter(func.lower(User.username) == username.lower(), User.id != user.id).first()
        if conflict is not None:
            raise APIError(409, "USER_EXISTS", "Username is already taken.")
        user.username = username

    if "password" in payload:
        password = payload.get("password") or ""
        if len(password) < 8:
            raise APIError(400, "INVALID_PASSWORD", "Password must be at least 8 characters.")
        user.set_password(password)

    if "is_active" in payload:
        user.is_active = bool(payload["is_active"])

    if "bytes_limit" in payload:
        value = int(payload["bytes_limit"])
        if value <= 0:
            raise APIError(400, "INVALID_QUOTA", "bytes_limit must be > 0")
        if value < user.bytes_used:
            raise APIError(400, "INVALID_QUOTA", "bytes_limit cannot be lower than current usage")
        user.bytes_limit = value

    if "role_ids" in payload or "role_names" in payload:
        user.roles = _resolve_roles(payload)

    audit(
        action="admin.user_update",
        actor=actor,
        target_type="user",
        target_id=str(user.id),
        details={"username": user.username},
    )
    db.session.commit()

    return jsonify({"user": user.to_dict()})


@admin_bp.delete("/users/<int:user_id>")
@jwt_required()
@permission_required(PermissionCode.USER_MANAGE)
def delete_user(user_id: int):
    actor = current_user(required=True)
    assert actor is not None

    if actor.id == user_id:
        raise APIError(400, "INVALID_OPERATION", "You cannot delete your own account.")

    user = db.session.get(User, user_id)
    if user is None:
        raise APIError(404, "USER_NOT_FOUND", "User not found.")

    storage_root = Path(current_app.config["STORAGE_ROOT"]).resolve()
    nodes = FileNode.query.filter_by(owner_id=user.id).all()
    for node in nodes:
        if node.type == FileNodeType.FILE:
            delete_storage_path(storage_root, node.storage_path)

    db.session.delete(user)
    audit(
        action="admin.user_delete",
        actor=actor,
        target_type="user",
        target_id=str(user_id),
        details={"username": user.username},
    )
    db.session.commit()

    return jsonify({"deleted": True})
