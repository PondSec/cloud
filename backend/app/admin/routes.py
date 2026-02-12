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
from ..models import AppSettings, FileNode, FileNodeType, Permission, PermissionCode, Role, User


admin_bp = Blueprint("admin", __name__, url_prefix="/admin")
SYSTEM_ROLE_NAMES = {"admin", "user"}


def _resolve_roles(payload: dict) -> list[Role]:
    has_role_filter = "role_ids" in payload or "role_names" in payload
    role_ids = payload.get("role_ids") or []
    role_names = payload.get("role_names") or []

    roles: list[Role] = []
    if role_ids:
        try:
            normalized_ids = [int(item) for item in role_ids]
        except (TypeError, ValueError) as error:
            raise APIError(400, "INVALID_ROLE", "role_ids must be integers.") from error
        found = Role.query.filter(Role.id.in_(normalized_ids)).all()
        if len({role.id for role in found}) != len(set(normalized_ids)):
            raise APIError(400, "INVALID_ROLE", "One or more role_ids are invalid.")
        roles.extend(found)
    if role_names:
        found = Role.query.filter(Role.name.in_(role_names)).all()
        if len({role.name for role in found}) != len(set(role_names)):
            raise APIError(400, "INVALID_ROLE", "One or more role_names are invalid.")
        roles.extend(found)

    if not roles and has_role_filter:
        raise APIError(400, "INVALID_ROLE", "At least one valid role is required.")

    if not roles and not has_role_filter:
        default_role = Role.query.filter_by(name="user").one_or_none()
        if default_role is None:
            raise APIError(500, "RBAC_NOT_READY", "Default user role is missing.")
        roles = [default_role]

    unique_by_id: dict[int, Role] = {role.id: role for role in roles}
    return list(unique_by_id.values())


def _resolve_permissions(payload: dict) -> list[Permission] | None:
    has_permission_filter = "permission_ids" in payload or "permission_codes" in payload
    if not has_permission_filter:
        return None

    permission_ids = payload.get("permission_ids") or []
    permission_codes = payload.get("permission_codes") or []

    permissions: list[Permission] = []
    if permission_ids:
        try:
            normalized_ids = [int(item) for item in permission_ids]
        except (TypeError, ValueError) as error:
            raise APIError(400, "INVALID_PERMISSION", "permission_ids must be integers.") from error
        found = Permission.query.filter(Permission.id.in_(normalized_ids)).all()
        if len({permission.id for permission in found}) != len(set(normalized_ids)):
            raise APIError(400, "INVALID_PERMISSION", "One or more permission_ids are invalid.")
        permissions.extend(found)
    if permission_codes:
        found = Permission.query.filter(Permission.code.in_(permission_codes)).all()
        if len({permission.code for permission in found}) != len(set(permission_codes)):
            raise APIError(400, "INVALID_PERMISSION", "One or more permission_codes are invalid.")
        permissions.extend(found)

    unique_by_id: dict[int, Permission] = {permission.id: permission for permission in permissions}
    return list(unique_by_id.values())


def _role_name_taken(name: str, exclude_role_id: int | None = None) -> bool:
    query = Role.query.filter(func.lower(Role.name) == name.lower())
    if exclude_role_id is not None:
        query = query.filter(Role.id != exclude_role_id)
    return query.first() is not None


@admin_bp.get("/permissions")
@jwt_required()
@permission_required(PermissionCode.ROLE_MANAGE, PermissionCode.USER_MANAGE, PermissionCode.SERVER_SETTINGS)
def list_permissions():
    items = Permission.query.order_by(Permission.code.asc()).all()
    return jsonify({"items": [item.to_dict() for item in items]})


@admin_bp.get("/roles")
@jwt_required()
@permission_required(PermissionCode.ROLE_MANAGE, PermissionCode.USER_MANAGE)
def list_roles():
    roles = Role.query.order_by(Role.name.asc()).all()
    return jsonify({"items": [role.to_dict() for role in roles]})


@admin_bp.post("/roles")
@jwt_required()
@permission_required(PermissionCode.ROLE_MANAGE)
def create_role():
    actor = current_user(required=True)
    assert actor is not None

    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    if len(name) < 3:
        raise APIError(400, "INVALID_ROLE_NAME", "Role name must be at least 3 characters.")
    if _role_name_taken(name):
        raise APIError(409, "ROLE_EXISTS", "Role name already exists.")
    if name.lower() in SYSTEM_ROLE_NAMES:
        raise APIError(400, "INVALID_ROLE_NAME", "Reserved role names cannot be created.")

    permissions = _resolve_permissions(payload)
    role = Role(
        name=name,
        description=(payload.get("description") or "").strip() or None,
    )
    role.permissions = permissions or []

    db.session.add(role)
    db.session.flush()
    audit(
        action="admin.role_create",
        actor=actor,
        target_type="role",
        target_id=str(role.id),
        details={"name": role.name, "permission_codes": [permission.code for permission in role.permissions]},
    )
    db.session.commit()
    return jsonify({"role": role.to_dict()}), 201


@admin_bp.patch("/roles/<int:role_id>")
@jwt_required()
@permission_required(PermissionCode.ROLE_MANAGE)
def update_role(role_id: int):
    actor = current_user(required=True)
    assert actor is not None

    role = db.session.get(Role, role_id)
    if role is None:
        raise APIError(404, "ROLE_NOT_FOUND", "Role not found.")

    payload = request.get_json(silent=True) or {}
    is_system_role = role.name.lower() in SYSTEM_ROLE_NAMES

    if "name" in payload:
        next_name = (payload.get("name") or "").strip()
        if len(next_name) < 3:
            raise APIError(400, "INVALID_ROLE_NAME", "Role name must be at least 3 characters.")
        if is_system_role and next_name.lower() != role.name.lower():
            raise APIError(400, "SYSTEM_ROLE_LOCKED", "System role names cannot be changed.")
        if _role_name_taken(next_name, exclude_role_id=role.id):
            raise APIError(409, "ROLE_EXISTS", "Role name already exists.")
        role.name = next_name

    if "description" in payload:
        role.description = (payload.get("description") or "").strip() or None

    permissions = _resolve_permissions(payload)
    if permissions is not None:
        if is_system_role:
            raise APIError(400, "SYSTEM_ROLE_LOCKED", "System role permissions are managed by bootstrap.")
        role.permissions = permissions

    audit(
        action="admin.role_update",
        actor=actor,
        target_type="role",
        target_id=str(role.id),
        details={"name": role.name, "permission_codes": [permission.code for permission in role.permissions]},
    )
    db.session.commit()
    return jsonify({"role": role.to_dict()})


@admin_bp.delete("/roles/<int:role_id>")
@jwt_required()
@permission_required(PermissionCode.ROLE_MANAGE)
def delete_role(role_id: int):
    actor = current_user(required=True)
    assert actor is not None

    role = db.session.get(Role, role_id)
    if role is None:
        raise APIError(404, "ROLE_NOT_FOUND", "Role not found.")
    if role.name.lower() in SYSTEM_ROLE_NAMES:
        raise APIError(400, "SYSTEM_ROLE_LOCKED", "System roles cannot be deleted.")

    assigned_count = User.query.join(User.roles).filter(Role.id == role.id).count()
    if assigned_count > 0:
        raise APIError(400, "ROLE_IN_USE", "Role is still assigned to one or more users.")

    db.session.delete(role)
    audit(
        action="admin.role_delete",
        actor=actor,
        target_type="role",
        target_id=str(role_id),
        details={"name": role.name},
    )
    db.session.commit()
    return jsonify({"deleted": True})


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

    if ("role_ids" in payload or "role_names" in payload) and not actor.has_permission(PermissionCode.ROLE_MANAGE.value):
        raise APIError(403, "FORBIDDEN", "Missing permission to assign roles.")
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
        if not actor.has_permission(PermissionCode.ROLE_MANAGE.value):
            raise APIError(403, "FORBIDDEN", "Missing permission to change user roles.")
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
