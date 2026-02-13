from __future__ import annotations

from flask import current_app
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from ..extensions import db


def ensure_inventorypro_schema_compat() -> None:
    """Best-effort repair for legacy app_settings/users schema.

    Existing installations may not have run Alembic migrations yet.
    This adds InventoryPro integration columns so settings can persist.
    """

    bind = db.session.get_bind()
    inspector = inspect(bind)
    table_names = set(inspector.get_table_names())
    statements: list[str] = []

    if "users" in table_names:
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        if "inventory_pro_user_id" not in user_columns:
            statements.append("ALTER TABLE users ADD COLUMN inventory_pro_user_id VARCHAR(128)")

    if "app_settings" in table_names:
        settings_columns = {column["name"] for column in inspector.get_columns("app_settings")}
        if "inventory_pro_enabled" not in settings_columns:
            statements.append("ALTER TABLE app_settings ADD COLUMN inventory_pro_enabled BOOLEAN NOT NULL DEFAULT 0")
        if "inventory_pro_base_url" not in settings_columns:
            statements.append("ALTER TABLE app_settings ADD COLUMN inventory_pro_base_url VARCHAR(512) NOT NULL DEFAULT ''")
        if "inventory_pro_sync_enabled" not in settings_columns:
            statements.append("ALTER TABLE app_settings ADD COLUMN inventory_pro_sync_enabled BOOLEAN NOT NULL DEFAULT 1")
        if "inventory_pro_sso_enabled" not in settings_columns:
            statements.append("ALTER TABLE app_settings ADD COLUMN inventory_pro_sso_enabled BOOLEAN NOT NULL DEFAULT 1")
        if "inventory_pro_enforce_sso" not in settings_columns:
            statements.append("ALTER TABLE app_settings ADD COLUMN inventory_pro_enforce_sso BOOLEAN NOT NULL DEFAULT 0")
        if "inventory_pro_auto_provision_users" not in settings_columns:
            statements.append(
                "ALTER TABLE app_settings ADD COLUMN inventory_pro_auto_provision_users BOOLEAN NOT NULL DEFAULT 1"
            )
        if "inventory_pro_dock_enabled" not in settings_columns:
            statements.append("ALTER TABLE app_settings ADD COLUMN inventory_pro_dock_enabled BOOLEAN NOT NULL DEFAULT 1")
        if "inventory_pro_default_role_name" not in settings_columns:
            statements.append(
                "ALTER TABLE app_settings ADD COLUMN inventory_pro_default_role_name VARCHAR(64) NOT NULL DEFAULT 'user'"
            )
        if "inventory_pro_shared_secret_hash" not in settings_columns:
            statements.append(
                "ALTER TABLE app_settings ADD COLUMN inventory_pro_shared_secret_hash VARCHAR(255) NOT NULL DEFAULT ''"
            )

    if not statements:
        return

    try:
        with bind.begin() as connection:
            for statement in statements:
                connection.execute(text(statement))
            connection.execute(
                text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_inventory_pro_user_id ON users (inventory_pro_user_id)")
            )
    except SQLAlchemyError:
        current_app.logger.warning("InventoryPro schema compatibility patch failed", exc_info=True)


def ensure_audit_schema_compat() -> None:
    """Best-effort repair for legacy audit_logs schema.

    Older DBs used created_at/target_type/target_id/details columns.
    Newer code expects ts/entity_type/entity_id/metadata plus extra fields.
    """

    bind = db.session.get_bind()
    inspector = inspect(bind)
    if "audit_logs" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("audit_logs")}
    statements: list[str] = []

    if "ts" not in columns and "created_at" in columns:
        statements.append("ALTER TABLE audit_logs RENAME COLUMN created_at TO ts")
        columns.remove("created_at")
        columns.add("ts")

    if "entity_type" not in columns and "target_type" in columns:
        statements.append("ALTER TABLE audit_logs RENAME COLUMN target_type TO entity_type")
        columns.remove("target_type")
        columns.add("entity_type")

    if "entity_id" not in columns and "target_id" in columns:
        statements.append("ALTER TABLE audit_logs RENAME COLUMN target_id TO entity_id")
        columns.remove("target_id")
        columns.add("entity_id")

    if "metadata" not in columns and "details" in columns:
        statements.append('ALTER TABLE audit_logs RENAME COLUMN details TO "metadata"')
        columns.remove("details")
        columns.add("metadata")

    if "actor_ip" not in columns:
        statements.append("ALTER TABLE audit_logs ADD COLUMN actor_ip VARCHAR(64)")
        columns.add("actor_ip")

    if "user_agent" not in columns:
        statements.append("ALTER TABLE audit_logs ADD COLUMN user_agent VARCHAR(255)")
        columns.add("user_agent")

    if "severity" not in columns:
        statements.append("ALTER TABLE audit_logs ADD COLUMN severity VARCHAR(16) NOT NULL DEFAULT 'info'")
        columns.add("severity")

    if "success" not in columns:
        statements.append("ALTER TABLE audit_logs ADD COLUMN success BOOLEAN NOT NULL DEFAULT 1")
        columns.add("success")

    if not statements and "ts" in columns:
        # Already compatible.
        return

    try:
        with bind.begin() as connection:
            for statement in statements:
                connection.execute(text(statement))

            if "ts" in columns:
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_ts ON audit_logs (ts)"))
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_ts_actor ON audit_logs (ts, actor_user_id)"))
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_ts_action ON audit_logs (ts, action)"))
            if "entity_type" in columns:
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_entity_type ON audit_logs (entity_type)"))
            if "severity" in columns:
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_severity ON audit_logs (severity)"))
            if "success" in columns:
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_success ON audit_logs (success)"))
    except SQLAlchemyError:
        current_app.logger.warning("Audit schema compatibility patch failed", exc_info=True)
