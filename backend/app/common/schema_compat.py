from __future__ import annotations

from flask import current_app
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from ..extensions import db


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

