from __future__ import annotations

from flask import current_app

from .extensions import db
from .integration.service import normalize_inventory_pro_base_url
from .models import AppSettings, Permission, PermissionCode, ResourceQuota, Role, User, utc_now


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
    default_user_permissions = [
        PermissionCode.FILE_READ,
        PermissionCode.FILE_WRITE,
        PermissionCode.FILE_DELETE,
        PermissionCode.SHARE_INTERNAL_MANAGE,
        PermissionCode.SHARE_EXTERNAL_MANAGE,
        PermissionCode.SHARE_VIEW_RECEIVED,
        PermissionCode.OFFICE_USE,
        PermissionCode.IDE_USE,
        PermissionCode.MEDIA_VIEW,
    ]
    user_role.permissions = [permission_map[code.value] for code in default_user_permissions]


def ensure_settings() -> AppSettings:
    settings = db.session.get(AppSettings, 1)
    if settings is None:
        try:
            base_url = normalize_inventory_pro_base_url(current_app.config.get("INVENTORY_PRO_BASE_URL", ""))
        except Exception:
            base_url = ""
        settings = AppSettings(
            id=1,
            allow_registration=current_app.config["ALLOW_REGISTRATION"],
            max_upload_size=current_app.config["MAX_UPLOAD_SIZE_BYTES"],
            default_quota=current_app.config["DEFAULT_QUOTA_BYTES"],
            inventory_pro_enabled=current_app.config.get("INVENTORY_PRO_ENABLED", False),
            inventory_pro_base_url=base_url,
            inventory_pro_sync_enabled=current_app.config.get("INVENTORY_PRO_SYNC_ENABLED", True),
            inventory_pro_sso_enabled=current_app.config.get("INVENTORY_PRO_SSO_ENABLED", True),
            inventory_pro_enforce_sso=current_app.config.get("INVENTORY_PRO_ENFORCE_SSO", False),
            inventory_pro_auto_provision_users=current_app.config.get("INVENTORY_PRO_AUTO_PROVISION_USERS", True),
            inventory_pro_dock_enabled=current_app.config.get("INVENTORY_PRO_DOCK_ENABLED", True),
            inventory_pro_default_role_name=current_app.config.get("INVENTORY_PRO_DEFAULT_ROLE_NAME", "user"),
        )
        initial_secret = str(current_app.config.get("INVENTORY_PRO_SHARED_SECRET", "") or "").strip()
        if initial_secret:
            settings.set_inventory_pro_shared_secret(initial_secret)
        db.session.add(settings)
    elif not settings.has_inventory_pro_secret:
        initial_secret = str(current_app.config.get("INVENTORY_PRO_SHARED_SECRET", "") or "").strip()
        if initial_secret:
            settings.set_inventory_pro_shared_secret(initial_secret)
    return settings


def ensure_resource_quotas() -> None:
    for user in User.query.all():
        quota = ResourceQuota.query.filter_by(user_id=user.id).one_or_none()
        if quota is None:
            quota = ResourceQuota(
                user_id=user.id,
                bytes_limit=user.bytes_limit,
                bytes_used=user.bytes_used,
                usage_month=utc_now().strftime("%Y-%m"),
            )
            db.session.add(quota)
        else:
            quota.bytes_limit = user.bytes_limit
            quota.bytes_used = user.bytes_used


def bootstrap_defaults(commit: bool = False) -> None:
    ensure_roles_and_permissions()
    ensure_settings()
    ensure_resource_quotas()
    if commit:
        db.session.commit()
