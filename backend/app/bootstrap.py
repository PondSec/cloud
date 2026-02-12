from __future__ import annotations

from flask import current_app

from .extensions import db
from .models import AppSettings, Permission, PermissionCode, Role


def ensure_roles_and_permissions() -> None:
    permission_map: dict[str, Permission] = {}
    for code in PermissionCode:
        permission = Permission.query.filter_by(code=code.value).one_or_none()
        if permission is None:
            permission = Permission(code=code.value, name=code.value.replace("_", " ").title())
            db.session.add(permission)
            db.session.flush()
        permission_map[code.value] = permission

    admin_role = Role.query.filter_by(name="admin").one_or_none()
    if admin_role is None:
        admin_role = Role(name="admin", description="Full access")
        db.session.add(admin_role)
    admin_role.permissions = list(permission_map.values())

    user_role = Role.query.filter_by(name="user").one_or_none()
    if user_role is None:
        user_role = Role(name="user", description="Standard workspace user")
        db.session.add(user_role)
    user_role.permissions = [
        permission_map[PermissionCode.FILE_READ.value],
        permission_map[PermissionCode.FILE_WRITE.value],
        permission_map[PermissionCode.FILE_DELETE.value],
    ]


def ensure_settings() -> AppSettings:
    settings = db.session.get(AppSettings, 1)
    if settings is None:
        settings = AppSettings(
            id=1,
            allow_registration=current_app.config["ALLOW_REGISTRATION"],
            max_upload_size=current_app.config["MAX_UPLOAD_SIZE_BYTES"],
            default_quota=current_app.config["DEFAULT_QUOTA_BYTES"],
        )
        db.session.add(settings)
    return settings


def bootstrap_defaults(commit: bool = False) -> None:
    ensure_roles_and_permissions()
    ensure_settings()
    if commit:
        db.session.commit()
