"""monitoring dashboard schema

Revision ID: 20260213_0003
Revises: 20260212_0002
Create Date: 2026-02-13 00:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260213_0003"
down_revision = "20260212_0002"
branch_labels = None
depends_on = None


backupjobtype = sa.Enum("FULL", "INCREMENTAL", name="backupjobtype")
backupjobstatus = sa.Enum("SCHEDULED", "RUNNING", "SUCCESS", "FAILED", name="backupjobstatus")
restorescope = sa.Enum("SYSTEM", "PROJECT", "USER", name="restorescope")


def upgrade() -> None:
    with op.batch_alter_table("audit_logs", schema=None) as batch_op:
        batch_op.alter_column("created_at", new_column_name="ts", existing_type=sa.DateTime(timezone=True), existing_nullable=False)
        batch_op.alter_column("target_type", new_column_name="entity_type", existing_type=sa.String(length=64), existing_nullable=True)
        batch_op.alter_column("target_id", new_column_name="entity_id", existing_type=sa.String(length=128), existing_nullable=True)
        batch_op.alter_column("details", new_column_name="metadata", existing_type=sa.JSON(), existing_nullable=True)
        batch_op.add_column(sa.Column("actor_ip", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("user_agent", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("severity", sa.String(length=16), nullable=False, server_default="info"))
        batch_op.add_column(sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.true()))

    op.create_index("ix_audit_logs_ts", "audit_logs", ["ts"], unique=False)
    op.create_index("ix_audit_logs_entity_type", "audit_logs", ["entity_type"], unique=False)
    op.create_index("ix_audit_logs_severity", "audit_logs", ["severity"], unique=False)
    op.create_index("ix_audit_logs_success", "audit_logs", ["success"], unique=False)
    op.create_index("ix_audit_logs_ts_actor", "audit_logs", ["ts", "actor_user_id"], unique=False)
    op.create_index("ix_audit_logs_ts_action", "audit_logs", ["ts", "action"], unique=False)

    op.create_table(
        "backup_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("type", backupjobtype, nullable=False),
        sa.Column("status", backupjobstatus, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("target", sa.String(length=512), nullable=False),
        sa.Column("logs", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_backup_jobs_status"), "backup_jobs", ["status"], unique=False)
    op.create_index(op.f("ix_backup_jobs_type"), "backup_jobs", ["type"], unique=False)
    op.create_index(op.f("ix_backup_jobs_started_at"), "backup_jobs", ["started_at"], unique=False)
    op.create_index("ix_backup_jobs_status_started", "backup_jobs", ["status", "started_at"], unique=False)
    op.create_index("ix_backup_jobs_type_started", "backup_jobs", ["type", "started_at"], unique=False)

    op.create_table(
        "restore_points",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("source_backup_job_id", sa.Integer(), nullable=True),
        sa.Column("scope", restorescope, nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["source_backup_job_id"], ["backup_jobs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_restore_points_created_at"), "restore_points", ["created_at"], unique=False)
    op.create_index(op.f("ix_restore_points_scope"), "restore_points", ["scope"], unique=False)

    op.create_table(
        "resource_quotas",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("bytes_limit", sa.BigInteger(), nullable=False),
        sa.Column("bytes_used", sa.BigInteger(), nullable=False),
        sa.Column("max_running_containers", sa.Integer(), nullable=False),
        sa.Column("max_cpu_percent", sa.Float(), nullable=False),
        sa.Column("max_ram_mb", sa.Integer(), nullable=False),
        sa.Column("monthly_bytes_in_limit", sa.BigInteger(), nullable=False),
        sa.Column("monthly_bytes_out_limit", sa.BigInteger(), nullable=False),
        sa.Column("monthly_bytes_in_used", sa.BigInteger(), nullable=False),
        sa.Column("monthly_bytes_out_used", sa.BigInteger(), nullable=False),
        sa.Column("usage_month", sa.String(length=7), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )

    op.create_table(
        "system_metric_snapshots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cpu_percent", sa.Float(), nullable=True),
        sa.Column("memory_percent", sa.Float(), nullable=True),
        sa.Column("disk_percent", sa.Float(), nullable=True),
        sa.Column("disk_used_bytes", sa.BigInteger(), nullable=True),
        sa.Column("disk_total_bytes", sa.BigInteger(), nullable=True),
        sa.Column("disk_read_bytes", sa.BigInteger(), nullable=True),
        sa.Column("disk_write_bytes", sa.BigInteger(), nullable=True),
        sa.Column("net_bytes_sent", sa.BigInteger(), nullable=True),
        sa.Column("net_bytes_recv", sa.BigInteger(), nullable=True),
        sa.Column("load_1", sa.Float(), nullable=True),
        sa.Column("load_5", sa.Float(), nullable=True),
        sa.Column("load_15", sa.Float(), nullable=True),
        sa.Column("interfaces", sa.JSON(), nullable=True),
        sa.Column("provider_status", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_system_metric_snapshots_ts"), "system_metric_snapshots", ["ts"], unique=False)
    op.create_index(
        "ix_metric_snapshots_ts_net",
        "system_metric_snapshots",
        ["ts", "net_bytes_sent", "net_bytes_recv"],
        unique=False,
    )

    op.execute(
        """
        INSERT INTO resource_quotas (
            user_id,
            bytes_limit,
            bytes_used,
            max_running_containers,
            max_cpu_percent,
            max_ram_mb,
            monthly_bytes_in_limit,
            monthly_bytes_out_limit,
            monthly_bytes_in_used,
            monthly_bytes_out_used,
            usage_month,
            updated_at
        )
        SELECT
            id,
            bytes_limit,
            bytes_used,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            strftime('%Y-%m', 'now'),
            CURRENT_TIMESTAMP
        FROM users
        """
    )


def downgrade() -> None:
    op.drop_index("ix_metric_snapshots_ts_net", table_name="system_metric_snapshots")
    op.drop_index(op.f("ix_system_metric_snapshots_ts"), table_name="system_metric_snapshots")
    op.drop_table("system_metric_snapshots")

    op.drop_table("resource_quotas")

    op.drop_index(op.f("ix_restore_points_scope"), table_name="restore_points")
    op.drop_index(op.f("ix_restore_points_created_at"), table_name="restore_points")
    op.drop_table("restore_points")

    op.drop_index("ix_backup_jobs_type_started", table_name="backup_jobs")
    op.drop_index("ix_backup_jobs_status_started", table_name="backup_jobs")
    op.drop_index(op.f("ix_backup_jobs_started_at"), table_name="backup_jobs")
    op.drop_index(op.f("ix_backup_jobs_type"), table_name="backup_jobs")
    op.drop_index(op.f("ix_backup_jobs_status"), table_name="backup_jobs")
    op.drop_table("backup_jobs")

    op.drop_index("ix_audit_logs_ts_action", table_name="audit_logs")
    op.drop_index("ix_audit_logs_ts_actor", table_name="audit_logs")
    op.drop_index("ix_audit_logs_success", table_name="audit_logs")
    op.drop_index("ix_audit_logs_severity", table_name="audit_logs")
    op.drop_index("ix_audit_logs_entity_type", table_name="audit_logs")
    op.drop_index("ix_audit_logs_ts", table_name="audit_logs")

    with op.batch_alter_table("audit_logs", schema=None) as batch_op:
        batch_op.drop_column("success")
        batch_op.drop_column("severity")
        batch_op.drop_column("user_agent")
        batch_op.drop_column("actor_ip")
        batch_op.alter_column("metadata", new_column_name="details", existing_type=sa.JSON(), existing_nullable=True)
        batch_op.alter_column("entity_id", new_column_name="target_id", existing_type=sa.String(length=128), existing_nullable=True)
        batch_op.alter_column("entity_type", new_column_name="target_type", existing_type=sa.String(length=64), existing_nullable=True)
        batch_op.alter_column("ts", new_column_name="created_at", existing_type=sa.DateTime(timezone=True), existing_nullable=False)

    backupjobtype.drop(op.get_bind(), checkfirst=True)
    backupjobstatus.drop(op.get_bind(), checkfirst=True)
    restorescope.drop(op.get_bind(), checkfirst=True)
