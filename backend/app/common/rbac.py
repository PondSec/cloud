from __future__ import annotations

from functools import wraps
from typing import Any, Callable

from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from sqlalchemy import false

from ..extensions import db
from ..models import FileNode, InternalShare, PermissionCode, ShareAccessLevel, User
from .errors import APIError


def current_user(required: bool = True) -> User | None:
    identity = get_jwt_identity()
    if identity is None:
        if required:
            raise APIError(401, "UNAUTHENTICATED", "Authentication required.")
        return None

    user = db.session.get(User, int(identity))
    if user is None and required:
        raise APIError(401, "UNAUTHENTICATED", "Invalid session.")
    return user


def permission_required(*codes: PermissionCode) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            verify_jwt_in_request()
            user = current_user(required=True)
            assert user is not None
            for code in codes:
                if user.has_permission(code.value):
                    return func(*args, **kwargs)
            raise APIError(403, "FORBIDDEN", "Insufficient permissions.")

        return wrapper

    return decorator


def admin_required(func: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        verify_jwt_in_request()
        user = current_user(required=True)
        assert user is not None
        if not user.is_admin:
            raise APIError(403, "FORBIDDEN", "Admin access required.")
        return func(*args, **kwargs)

    return wrapper


def permission_for_node_action(action: str) -> PermissionCode | None:
    permission_map = {
        "read": PermissionCode.FILE_READ,
        "write": PermissionCode.FILE_WRITE,
        "delete": PermissionCode.FILE_DELETE,
    }
    return permission_map.get(action)


def _shared_access_level(user: User, node: FileNode) -> ShareAccessLevel | None:
    ancestor_ids: list[int] = []
    cursor: FileNode | None = node
    while cursor is not None:
        ancestor_ids.append(cursor.id)
        cursor = cursor.parent

    if not ancestor_ids:
        return None

    shares = (
        InternalShare.query.filter(
            InternalShare.shared_with_user_id == user.id,
            InternalShare.file_id.in_(ancestor_ids),
        )
        .order_by(InternalShare.updated_at.desc())
        .all()
    )
    if not shares:
        return None

    if any(share.access == ShareAccessLevel.WRITE for share in shares):
        return ShareAccessLevel.WRITE
    return ShareAccessLevel.READ


def has_shared_access(user: User, node: FileNode, action: str) -> bool:
    access_level = _shared_access_level(user, node)
    if access_level is None:
        return False

    if action == "read":
        return True
    if action in {"write", "delete"}:
        return access_level == ShareAccessLevel.WRITE
    return False


def can_manage_node(user: User, node: FileNode, action: str) -> bool:
    required_permission = permission_for_node_action(action)
    if required_permission and not user.has_permission(required_permission.value):
        return False

    if node.owner_id == user.id:
        return True

    if user.is_admin:
        return True

    return has_shared_access(user, node, action)


def scope_query_to_user(query: Any, user: User):
    if not user.has_permission(PermissionCode.FILE_READ.value):
        return query.filter(false())
    if user.is_admin and user.has_permission(PermissionCode.FILE_READ.value):
        return query
    return query.filter(FileNode.owner_id == user.id)
