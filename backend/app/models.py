from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

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
    USER_MANAGE = "USER_MANAGE"
    SERVER_SETTINGS = "SERVER_SETTINGS"


class FileNodeType(str, enum.Enum):
    FILE = "file"
    FOLDER = "folder"


class ShareAccessLevel(str, enum.Enum):
    READ = "read"
    WRITE = "write"


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

    roles = db.relationship("Role", secondary=user_roles, lazy="joined")
    files = db.relationship("FileNode", back_populates="owner", cascade="all, delete-orphan")

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
        return {
            "id": self.id,
            "username": self.username,
            "is_active": self.is_active,
            "bytes_limit": self.bytes_limit,
            "bytes_used": self.bytes_used,
            "roles": [role.to_dict() for role in self.roles],
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
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    @classmethod
    def singleton(cls) -> "AppSettings":
        settings = db.session.get(cls, 1)
        if settings is None:
            settings = cls(id=1)
            db.session.add(settings)
            db.session.flush()
        return settings

    def to_dict(self) -> dict[str, Any]:
        return {
            "allow_registration": self.allow_registration,
            "max_upload_size": self.max_upload_size,
            "default_quota": self.default_quota,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class AuditLog(db.Model):
    __tablename__ = "audit_logs"

    id = db.Column(db.Integer, primary_key=True)
    actor_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action = db.Column(db.String(128), nullable=False, index=True)
    target_type = db.Column(db.String(64), nullable=True)
    target_id = db.Column(db.String(128), nullable=True)
    details = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "actor_user_id": self.actor_user_id,
            "action": self.action,
            "target_type": self.target_type,
            "target_id": self.target_id,
            "details": self.details,
            "created_at": self.created_at.isoformat(),
        }
