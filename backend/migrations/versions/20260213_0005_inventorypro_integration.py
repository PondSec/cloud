"""add inventorypro integration settings and user mapping

Revision ID: 20260213_0005
Revises: 20260213_0004
Create Date: 2026-02-13 15:55:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260213_0005"
down_revision = "20260213_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("inventory_pro_user_id", sa.String(length=128), nullable=True))
    op.create_index(op.f("ix_users_inventory_pro_user_id"), "users", ["inventory_pro_user_id"], unique=True)

    op.add_column(
        "app_settings",
        sa.Column("inventory_pro_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "app_settings",
        sa.Column("inventory_pro_base_url", sa.String(length=512), nullable=False, server_default=""),
    )
    op.add_column(
        "app_settings",
        sa.Column("inventory_pro_sync_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "app_settings",
        sa.Column("inventory_pro_sso_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "app_settings",
        sa.Column("inventory_pro_enforce_sso", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "app_settings",
        sa.Column("inventory_pro_auto_provision_users", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "app_settings",
        sa.Column("inventory_pro_dock_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "app_settings",
        sa.Column("inventory_pro_default_role_name", sa.String(length=64), nullable=False, server_default="user"),
    )
    op.add_column(
        "app_settings",
        sa.Column("inventory_pro_shared_secret_hash", sa.String(length=255), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "inventory_pro_shared_secret_hash")
    op.drop_column("app_settings", "inventory_pro_default_role_name")
    op.drop_column("app_settings", "inventory_pro_dock_enabled")
    op.drop_column("app_settings", "inventory_pro_auto_provision_users")
    op.drop_column("app_settings", "inventory_pro_enforce_sso")
    op.drop_column("app_settings", "inventory_pro_sso_enabled")
    op.drop_column("app_settings", "inventory_pro_sync_enabled")
    op.drop_column("app_settings", "inventory_pro_base_url")
    op.drop_column("app_settings", "inventory_pro_enabled")

    op.drop_index(op.f("ix_users_inventory_pro_user_id"), table_name="users")
    op.drop_column("users", "inventory_pro_user_id")
