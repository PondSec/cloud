from __future__ import annotations

from functools import wraps
from typing import Any, Callable

from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from ..extensions import db
from ..models import FileNode, PermissionCode, User
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


def has_shared_access(_: User, __: FileNode, ___: str) -> bool:
    # Sharing permissions are intentionally stubbed for MVP extension.
    return False


def can_manage_node(user: User, node: FileNode, action: str) -> bool:
    if node.owner_id == user.id:
        return True

    permission_map = {
        "read": PermissionCode.FILE_READ,
        "write": PermissionCode.FILE_WRITE,
        "delete": PermissionCode.FILE_DELETE,
    }
    permission = permission_map.get(action)
    if permission and user.has_permission(permission.value):
        return True

    return has_shared_access(user, node, action)


def scope_query_to_user(query: Any, user: User):
    if user.is_admin and user.has_permission(PermissionCode.FILE_READ.value):
        return query
    return query.filter(FileNode.owner_id == user.id)
