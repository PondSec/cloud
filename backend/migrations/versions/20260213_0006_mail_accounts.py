"""add mail accounts (IMAP/SMTP)

Revision ID: 20260213_0006
Revises: 20260213_0005
Create Date: 2026-02-13 16:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260213_0006"
down_revision = "20260213_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mail_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("email_address", sa.String(length=255), nullable=False),
        sa.Column("imap_host", sa.String(length=255), nullable=False),
        sa.Column("imap_port", sa.Integer(), nullable=False, server_default="993"),
        sa.Column("imap_security", sa.String(length=16), nullable=False, server_default="ssl"),
        sa.Column("imap_username", sa.String(length=255), nullable=False),
        sa.Column("imap_password_ciphertext", sa.Text(), nullable=False, server_default=""),
        sa.Column("smtp_host", sa.String(length=255), nullable=False),
        sa.Column("smtp_port", sa.Integer(), nullable=False, server_default="465"),
        sa.Column("smtp_security", sa.String(length=16), nullable=False, server_default="ssl"),
        sa.Column("smtp_username", sa.String(length=255), nullable=False),
        sa.Column("smtp_password_ciphertext", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "email_address", name="uq_mail_accounts_user_email"),
    )
    op.create_index(op.f("ix_mail_accounts_user_id"), "mail_accounts", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_mail_accounts_user_id"), table_name="mail_accounts")
    op.drop_table("mail_accounts")

