"""add internal shares

Revision ID: 20260212_0002
Revises: 20260212_0001
Create Date: 2026-02-12 00:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260212_0002"
down_revision = "20260212_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "internal_shares",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("file_id", sa.Integer(), nullable=False),
        sa.Column("shared_with_user_id", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("access", sa.Enum("READ", "WRITE", name="shareaccesslevel"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["file_id"], ["file_nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shared_with_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("file_id", "shared_with_user_id", name="uq_internal_share_file_user"),
    )
    op.create_index(op.f("ix_internal_shares_created_by_id"), "internal_shares", ["created_by_id"], unique=False)
    op.create_index(op.f("ix_internal_shares_file_id"), "internal_shares", ["file_id"], unique=False)
    op.create_index(
        op.f("ix_internal_shares_shared_with_user_id"),
        "internal_shares",
        ["shared_with_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_internal_shares_shared_with_user_id"), table_name="internal_shares")
    op.drop_index(op.f("ix_internal_shares_file_id"), table_name="internal_shares")
    op.drop_index(op.f("ix_internal_shares_created_by_id"), table_name="internal_shares")
    op.drop_table("internal_shares")
