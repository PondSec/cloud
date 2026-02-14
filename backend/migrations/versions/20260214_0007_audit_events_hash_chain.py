"""add audit_events with hash chain

Revision ID: 20260214_0007
Revises: 20260213_0006
Create Date: 2026-02-14 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260214_0007"
down_revision = "20260213_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("action", sa.String(length=128), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=True),
        sa.Column("entity_id", sa.String(length=128), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("severity", sa.String(length=16), nullable=False, server_default="info"),
        sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("prev_hash", sa.String(length=64), nullable=False),
        sa.Column("event_hash", sa.String(length=64), nullable=False),
    )

    op.create_index(op.f("ix_audit_events_ts"), "audit_events", ["ts"], unique=False)
    op.create_index(op.f("ix_audit_events_actor_user_id"), "audit_events", ["actor_user_id"], unique=False)
    op.create_index(op.f("ix_audit_events_action"), "audit_events", ["action"], unique=False)
    op.create_index(op.f("ix_audit_events_severity"), "audit_events", ["severity"], unique=False)
    op.create_index(op.f("ix_audit_events_success"), "audit_events", ["success"], unique=False)
    op.create_index(op.f("ix_audit_events_event_hash"), "audit_events", ["event_hash"], unique=False)
    op.create_index("ix_audit_events_ts_actor", "audit_events", ["ts", "actor_user_id"], unique=False)
    op.create_index("ix_audit_events_ts_action", "audit_events", ["ts", "action"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_audit_events_ts_action", table_name="audit_events")
    op.drop_index("ix_audit_events_ts_actor", table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_event_hash"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_success"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_severity"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_action"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_actor_user_id"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_ts"), table_name="audit_events")
    op.drop_table("audit_events")

