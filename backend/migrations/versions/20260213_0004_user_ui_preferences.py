"""add per-user ui preferences

Revision ID: 20260213_0004
Revises: 20260213_0003
Create Date: 2026-02-13 15:20:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260213_0004"
down_revision = "20260213_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_ui_preferences",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("user_ui_preferences")
