from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from .extensions import db


pwd_hasher = PasswordHasher()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


role_permissions = db.Table(
    "role_permissions",
    db.Column("role_id", db.Integer, db.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    db.Column("permission_id", db.Integer, db.ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)

user_roles = db.Table(
    "user_roles",
    db.Column("user_id", db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    db.Column("role_id", db.Integer, db.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)


class PermissionCode(str, enum.Enum):
    FILE_READ = "FILE_READ"
    FILE_WRITE = "FILE_WRITE"
    FILE_DELETE = "FILE_DELETE"
    SHARE_INTERNAL_MANAGE = "SHARE_INTERNAL_MANAGE"
    SHARE_EXTERNAL_MANAGE = "SHARE_EXTERNAL_MANAGE"
    SHARE_VIEW_RECEIVED = "SHARE_VIEW_RECEIVED"
    OFFICE_USE = "OFFICE_USE"
    IDE_USE = "IDE_USE"
    MEDIA_VIEW = "MEDIA_VIEW"
    USER_MANAGE = "USER_MANAGE"
    ROLE_MANAGE = "ROLE_MANAGE"
    SERVER_SETTINGS = "SERVER_SETTINGS"


class FileNodeType(str, enum.Enum):
    FILE = "file"
    FOLDER = "folder"


class ShareAccessLevel(str, enum.Enum):
    READ = "read"
    WRITE = "write"


class BackupJobType(str, enum.Enum):
    FULL = "full"
    INCREMENTAL = "incremental"


class BackupJobStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


class RestoreScope(str, enum.Enum):
    SYSTEM = "system"
    PROJECT = "project"
    USER = "user"


class Permission(db.Model):
    __tablename__ = "permissions"

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(64), unique=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "code": self.code, "name": self.name}


class Role(db.Model):
    __tablename__ = "roles"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), unique=True, nullable=False)
    description = db.Column(db.String(255), nullable=True)
    permissions = db.relationship("Permission", secondary=role_permissions, lazy="joined")

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "permissions": [permission.to_dict() for permission in self.permissions],
        }


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    bytes_limit = db.Column(db.BigInteger, nullable=False, default=0)
    bytes_used = db.Column(db.BigInteger, nullable=False, default=0)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)
    inventory_pro_user_id = db.Column(db.String(128), unique=True, nullable=True, index=True)

    roles = db.relationship("Role", secondary=user_roles, lazy="joined")
    files = db.relationship("FileNode", back_populates="owner", cascade="all, delete-orphan")
    quota = db.relationship("ResourceQuota", back_populates="user", uselist=False, cascade="all, delete-orphan")
    ui_preferences = db.relationship(
        "UserUiPreference",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    mail_accounts = db.relationship(
        "MailAccount",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    def set_password(self, password: str) -> None:
        self.password_hash = pwd_hasher.hash(password)

    def verify_password(self, password: str) -> bool:
        try:
            return pwd_hasher.verify(self.password_hash, password)
        except VerifyMismatchError:
            return False

    @property
    def is_admin(self) -> bool:
        return any(role.name == "admin" for role in self.roles)

    def has_permission(self, code: str) -> bool:
        for role in self.roles:
            for permission in role.permissions:
                if permission.code == code:
                    return True
        return False

    def to_dict(self) -> dict[str, Any]:
        permission_codes = sorted({permission.code for role in self.roles for permission in role.permissions})
        return {
            "id": self.id,
            "username": self.username,
            "is_active": self.is_active,
            "bytes_limit": self.bytes_limit,
            "bytes_used": self.bytes_used,
            "roles": [role.to_dict() for role in self.roles],
            "permissions": permission_codes,
            "inventory_pro_user_id": self.inventory_pro_user_id,
            "identity_provider": "inventory_pro" if self.inventory_pro_user_id else "local",
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class UserUiPreference(db.Model):
    __tablename__ = "user_ui_preferences"

    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    payload_json = db.Column("payload", db.JSON, nullable=False, default=dict)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    user = db.relationship("User", back_populates="ui_preferences")

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "payload": self.payload_json or {},
            "updated_at": self.updated_at.isoformat(),
        }


class MailAccount(db.Model):
    __tablename__ = "mail_accounts"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    label = db.Column(db.String(120), nullable=False, default="")
    email_address = db.Column(db.String(255), nullable=False)

    imap_host = db.Column(db.String(255), nullable=False)
    imap_port = db.Column(db.Integer, nullable=False, default=993)
    imap_security = db.Column(db.String(16), nullable=False, default="ssl")
    imap_username = db.Column(db.String(255), nullable=False)
    imap_password_ciphertext = db.Column(db.Text, nullable=False, default="")

    smtp_host = db.Column(db.String(255), nullable=False)
    smtp_port = db.Column(db.Integer, nullable=False, default=465)
    smtp_security = db.Column(db.String(16), nullable=False, default="ssl")
    smtp_username = db.Column(db.String(255), nullable=False)
    smtp_password_ciphertext = db.Column(db.Text, nullable=False, default="")

    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    user = db.relationship("User", back_populates="mail_accounts")

    __table_args__ = (db.UniqueConstraint("user_id", "email_address", name="uq_mail_accounts_user_email"),)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "label": (self.label or "").strip(),
            "email_address": (self.email_address or "").strip(),
            "imap_host": (self.imap_host or "").strip(),
            "imap_port": int(self.imap_port or 0),
            "imap_security": (self.imap_security or "ssl").strip(),
            "imap_username": (self.imap_username or "").strip(),
            "smtp_host": (self.smtp_host or "").strip(),
            "smtp_port": int(self.smtp_port or 0),
            "smtp_security": (self.smtp_security or "ssl").strip(),
            "smtp_username": (self.smtp_username or "").strip(),
            "is_active": bool(self.is_active),
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class FileNode(db.Model):
    __tablename__ = "file_nodes"

    id = db.Column(db.Integer, primary_key=True)
    parent_id = db.Column(db.Integer, db.ForeignKey("file_nodes.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    type = db.Column(db.Enum(FileNodeType), nullable=False, default=FileNodeType.FILE)
    size = db.Column(db.BigInteger, nullable=False, default=0)
    mime = db.Column(db.String(255), nullable=True)
    storage_path = db.Column(db.String(512), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    parent = db.relationship("FileNode", remote_side=[id], back_populates="children")
    children = db.relationship("FileNode", back_populates="parent", cascade="all, delete-orphan")
    owner = db.relationship("User", back_populates="files")

    __table_args__ = (db.UniqueConstraint("owner_id", "parent_id", "name", name="uq_file_owner_parent_name"),)

    @property
    def is_folder(self) -> bool:
        return self.type == FileNodeType.FOLDER

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "parent_id": self.parent_id,
            "owner_id": self.owner_id,
            "name": self.name,
            "type": self.type.value,
            "size": self.size,
            "mime": self.mime,
            "storage_path": self.storage_path,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class ShareLink(db.Model):
    __tablename__ = "share_links"

    id = db.Column(db.Integer, primary_key=True)
    file_id = db.Column(db.Integer, db.ForeignKey("file_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token = db.Column(db.String(128), unique=True, nullable=False, default=lambda: uuid4().hex)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)

    file = db.relationship("FileNode")
    created_by = db.relationship("User")

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "file_id": self.file_id,
            "created_by_id": self.created_by_id,
            "token": self.token,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "created_at": self.created_at.isoformat(),
        }


class InternalShare(db.Model):
    __tablename__ = "internal_shares"

    id = db.Column(db.Integer, primary_key=True)
    file_id = db.Column(db.Integer, db.ForeignKey("file_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    shared_with_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    access = db.Column(db.Enum(ShareAccessLevel), nullable=False, default=ShareAccessLevel.READ)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    file = db.relationship("FileNode")
    shared_with_user = db.relationship("User", foreign_keys=[shared_with_user_id])
    created_by = db.relationship("User", foreign_keys=[created_by_id])

    __table_args__ = (db.UniqueConstraint("file_id", "shared_with_user_id", name="uq_internal_share_file_user"),)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "file_id": self.file_id,
            "shared_with_user_id": self.shared_with_user_id,
            "shared_with_username": self.shared_with_user.username if self.shared_with_user else None,
            "created_by_id": self.created_by_id,
            "created_by_username": self.created_by.username if self.created_by else None,
            "access": self.access.value,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class AppSettings(db.Model):
    __tablename__ = "app_settings"

    id = db.Column(db.Integer, primary_key=True, default=1)
    allow_registration = db.Column(db.Boolean, nullable=False, default=False)
    max_upload_size = db.Column(db.BigInteger, nullable=False, default=25 * 1024 * 1024)
    default_quota = db.Column(db.BigInteger, nullable=False, default=5 * 1024 * 1024 * 1024)
    inventory_pro_enabled = db.Column(db.Boolean, nullable=False, default=False)
    inventory_pro_base_url = db.Column(db.String(512), nullable=False, default="")
    inventory_pro_sync_enabled = db.Column(db.Boolean, nullable=False, default=True)
    inventory_pro_sso_enabled = db.Column(db.Boolean, nullable=False, default=True)
    inventory_pro_enforce_sso = db.Column(db.Boolean, nullable=False, default=False)
    inventory_pro_auto_provision_users = db.Column(db.Boolean, nullable=False, default=True)
    inventory_pro_dock_enabled = db.Column(db.Boolean, nullable=False, default=True)
    inventory_pro_default_role_name = db.Column(db.String(64), nullable=False, default="user")
    inventory_pro_shared_secret_hash = db.Column(db.String(255), nullable=False, default="")
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    @classmethod
    def singleton(cls) -> "AppSettings":
        settings = db.session.get(cls, 1)
        if settings is None:
            settings = cls(id=1)
            db.session.add(settings)
            db.session.flush()
        return settings

    @property
    def has_inventory_pro_secret(self) -> bool:
        return bool((self.inventory_pro_shared_secret_hash or "").strip())

    def set_inventory_pro_shared_secret(self, secret: str) -> None:
        cleaned = secret.strip()
        if not cleaned:
            self.inventory_pro_shared_secret_hash = ""
            return
        self.inventory_pro_shared_secret_hash = pwd_hasher.hash(cleaned)

    def clear_inventory_pro_shared_secret(self) -> None:
        self.inventory_pro_shared_secret_hash = ""

    def verify_inventory_pro_shared_secret(self, secret: str) -> bool:
        candidate = secret.strip()
        if not candidate or not self.has_inventory_pro_secret:
            return False
        try:
            return pwd_hasher.verify(self.inventory_pro_shared_secret_hash, candidate)
        except (VerifyMismatchError, InvalidHashError):
            return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "allow_registration": self.allow_registration,
            "max_upload_size": self.max_upload_size,
            "default_quota": self.default_quota,
            "inventory_pro": {
                "enabled": self.inventory_pro_enabled,
                "base_url": (self.inventory_pro_base_url or "").strip(),
                "sync_enabled": self.inventory_pro_sync_enabled,
                "sso_enabled": self.inventory_pro_sso_enabled,
                "enforce_sso": self.inventory_pro_enforce_sso,
                "auto_provision_users": self.inventory_pro_auto_provision_users,
                "dock_enabled": self.inventory_pro_dock_enabled,
                "default_role_name": (self.inventory_pro_default_role_name or "user").strip() or "user",
                "has_shared_secret": self.has_inventory_pro_secret,
                "sync_endpoint": "/integration/inventorypro/users/sync",
                "sso_ticket_endpoint": "/integration/inventorypro/sso/ticket",
                "sso_exchange_endpoint": "/auth/inventorypro/exchange",
            },
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class AuditLog(db.Model):
    __tablename__ = "audit_logs"

    id = db.Column(db.Integer, primary_key=True)
    ts = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, index=True)
    actor_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_ip = db.Column(db.String(64), nullable=True)
    user_agent = db.Column(db.String(255), nullable=True)
    action = db.Column(db.String(128), nullable=False, index=True)
    entity_type = db.Column(db.String(64), nullable=True, index=True)
    entity_id = db.Column(db.String(128), nullable=True)
    metadata_json = db.Column("metadata", db.JSON, nullable=True)
    severity = db.Column(db.String(16), nullable=False, default="info", index=True)
    success = db.Column(db.Boolean, nullable=False, default=True, index=True)

    actor = db.relationship("User", foreign_keys=[actor_user_id])

    __table_args__ = (
        db.Index("ix_audit_logs_ts_actor", "ts", "actor_user_id"),
        db.Index("ix_audit_logs_ts_action", "ts", "action"),
    )

    @property
    def target_type(self) -> str | None:
        return self.entity_type

    @target_type.setter
    def target_type(self, value: str | None) -> None:
        self.entity_type = value

    @property
    def target_id(self) -> str | None:
        return self.entity_id

    @target_id.setter
    def target_id(self, value: str | None) -> None:
        self.entity_id = value

    @property
    def details(self) -> dict[str, Any] | None:
        return self.metadata_json

    @details.setter
    def details(self, value: dict[str, Any] | None) -> None:
        self.metadata_json = value

    @property
    def created_at(self) -> datetime:
        return self.ts

    @created_at.setter
    def created_at(self, value: datetime) -> None:
        self.ts = value

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "ts": self.ts.isoformat(),
            "created_at": self.ts.isoformat(),
            "actor_user_id": self.actor_user_id,
            "actor_username": self.actor.username if self.actor is not None else None,
            "actor_ip": self.actor_ip,
            "user_agent": self.user_agent,
            "action": self.action,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "metadata": self.metadata_json or {},
            "severity": self.severity,
            "success": bool(self.success),
        }


class BackupJob(db.Model):
    __tablename__ = "backup_jobs"

    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.Enum(BackupJobType), nullable=False, default=BackupJobType.FULL, index=True)
    status = db.Column(db.Enum(BackupJobStatus), nullable=False, default=BackupJobStatus.SCHEDULED, index=True)
    started_at = db.Column(db.DateTime(timezone=True), nullable=True, index=True)
    finished_at = db.Column(db.DateTime(timezone=True), nullable=True)
    size_bytes = db.Column(db.BigInteger, nullable=True)
    target = db.Column(db.String(512), nullable=False)
    logs = db.Column(db.Text, nullable=True)
    error_message = db.Column(db.Text, nullable=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    created_by = db.relationship("User", foreign_keys=[created_by_id])

    __table_args__ = (
        db.Index("ix_backup_jobs_status_started", "status", "started_at"),
        db.Index("ix_backup_jobs_type_started", "type", "started_at"),
    )

    def to_dict(self, include_logs: bool = False) -> dict[str, Any]:
        payload = {
            "id": self.id,
            "type": self.type.value,
            "status": self.status.value,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "size_bytes": self.size_bytes,
            "target": self.target,
            "error_message": self.error_message,
            "created_by_id": self.created_by_id,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
        if include_logs:
            payload["logs"] = self.logs or ""
        return payload


class RestorePoint(db.Model):
    __tablename__ = "restore_points"

    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, index=True)
    label = db.Column(db.String(255), nullable=False)
    source_backup_job_id = db.Column(db.Integer, db.ForeignKey("backup_jobs.id", ondelete="SET NULL"), nullable=True)
    scope = db.Column(db.Enum(RestoreScope), nullable=False, default=RestoreScope.SYSTEM, index=True)
    metadata_json = db.Column("metadata", db.JSON, nullable=True)
    size_bytes = db.Column(db.BigInteger, nullable=True)

    source_backup_job = db.relationship("BackupJob", foreign_keys=[source_backup_job_id])

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat(),
            "label": self.label,
            "source_backup_job_id": self.source_backup_job_id,
            "scope": self.scope.value,
            "metadata": self.metadata_json or {},
            "size_bytes": self.size_bytes,
        }


class ResourceQuota(db.Model):
    __tablename__ = "resource_quotas"

    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    bytes_limit = db.Column(db.BigInteger, nullable=False, default=0)
    bytes_used = db.Column(db.BigInteger, nullable=False, default=0)
    max_running_containers = db.Column(db.Integer, nullable=False, default=0)
    max_cpu_percent = db.Column(db.Float, nullable=False, default=0.0)
    max_ram_mb = db.Column(db.Integer, nullable=False, default=0)
    monthly_bytes_in_limit = db.Column(db.BigInteger, nullable=False, default=0)
    monthly_bytes_out_limit = db.Column(db.BigInteger, nullable=False, default=0)
    monthly_bytes_in_used = db.Column(db.BigInteger, nullable=False, default=0)
    monthly_bytes_out_used = db.Column(db.BigInteger, nullable=False, default=0)
    usage_month = db.Column(db.String(7), nullable=False, default=lambda: utc_now().strftime("%Y-%m"))
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    user = db.relationship("User", back_populates="quota")

    def to_dict(self, include_username: bool = True) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "username": self.user.username if include_username and self.user else None,
            "bytes_limit": self.bytes_limit,
            "bytes_used": self.bytes_used,
            "max_running_containers": self.max_running_containers,
            "max_cpu_percent": self.max_cpu_percent,
            "max_ram_mb": self.max_ram_mb,
            "monthly_bytes_in_limit": self.monthly_bytes_in_limit,
            "monthly_bytes_out_limit": self.monthly_bytes_out_limit,
            "monthly_bytes_in_used": self.monthly_bytes_in_used,
            "monthly_bytes_out_used": self.monthly_bytes_out_used,
            "usage_month": self.usage_month,
            "updated_at": self.updated_at.isoformat(),
        }


class SystemMetricSnapshot(db.Model):
    __tablename__ = "system_metric_snapshots"

    id = db.Column(db.Integer, primary_key=True)
    ts = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, index=True)
    cpu_percent = db.Column(db.Float, nullable=True)
    memory_percent = db.Column(db.Float, nullable=True)
    disk_percent = db.Column(db.Float, nullable=True)
    disk_used_bytes = db.Column(db.BigInteger, nullable=True)
    disk_total_bytes = db.Column(db.BigInteger, nullable=True)
    disk_read_bytes = db.Column(db.BigInteger, nullable=True)
    disk_write_bytes = db.Column(db.BigInteger, nullable=True)
    net_bytes_sent = db.Column(db.BigInteger, nullable=True)
    net_bytes_recv = db.Column(db.BigInteger, nullable=True)
    load_1 = db.Column(db.Float, nullable=True)
    load_5 = db.Column(db.Float, nullable=True)
    load_15 = db.Column(db.Float, nullable=True)
    interfaces_json = db.Column("interfaces", db.JSON, nullable=True)
    provider_status_json = db.Column("provider_status", db.JSON, nullable=True)

    __table_args__ = (db.Index("ix_metric_snapshots_ts_net", "ts", "net_bytes_sent", "net_bytes_recv"),)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "ts": self.ts.isoformat(),
            "cpu_percent": self.cpu_percent,
            "memory_percent": self.memory_percent,
            "disk_percent": self.disk_percent,
            "disk_used_bytes": self.disk_used_bytes,
            "disk_total_bytes": self.disk_total_bytes,
            "disk_read_bytes": self.disk_read_bytes,
            "disk_write_bytes": self.disk_write_bytes,
            "net_bytes_sent": self.net_bytes_sent,
            "net_bytes_recv": self.net_bytes_recv,
            "load_1": self.load_1,
            "load_5": self.load_5,
            "load_15": self.load_15,
            "interfaces": self.interfaces_json or {},
            "provider_status": self.provider_status_json or {},
        }
