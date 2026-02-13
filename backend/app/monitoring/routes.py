from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from flask import Blueprint, current_app, g, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import or_

from ..common.audit import audit
from ..common.errors import APIError
from ..common.rate_limit import monitoring_cache, monitoring_rate_limiter, parse_rate_limit
from ..common.rbac import current_user
from ..extensions import db
from ..models import (
    BackupJob,
    BackupJobStatus,
    BackupJobType,
    ResourceQuota,
    RestorePoint,
    RestoreScope,
    SystemMetricSnapshot,
    User,
    utc_now,
)
from .docker_metrics import collect_container_metrics
from .metrics import collect_host_metrics, network_snapshot_series, network_usage_payload, storage_breakdown
from .quotas import get_or_create_quota, sync_quota_storage_usage


monitoring_bp = Blueprint("monitoring", __name__, url_prefix="/api/monitoring")

USER_VISIBLE_ENDPOINTS = {
    "monitoring.list_quotas",
    "monitoring.quotas_usage",
}


def _parse_iso_datetime(value: str | None, field: str) -> datetime | None:
    if value in (None, ""):
        return None
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError as error:
        raise APIError(400, "INVALID_PARAMETER", f"{field} must be an ISO-8601 datetime.") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_pagination() -> tuple[int, int]:
    try:
        page = max(1, int(request.args.get("page", "1")))
        page_size = min(200, max(1, int(request.args.get("page_size", "25"))))
    except ValueError as error:
        raise APIError(400, "INVALID_PARAMETER", "page and page_size must be integers.") from error
    return page, page_size


def _cache_key(scope: str) -> str:
    user = g.monitoring_user
    assert user is not None
    return f"{scope}:{user.id}:{request.full_path}"


def _cached(scope: str, producer: Any, ttl_seconds: int | None = None):
    ttl = int(ttl_seconds or current_app.config["MONITORING_CACHE_TTL_SECONDS"])
    payload = monitoring_cache.get_or_set(_cache_key(scope), ttl, producer)
    return jsonify(payload)


def _backup_status(status: str | None) -> BackupJobStatus | None:
    if not status:
        return None
    try:
        return BackupJobStatus(status.lower())
    except ValueError as error:
        raise APIError(400, "INVALID_PARAMETER", "Invalid backup status filter.") from error


def _backup_type(job_type: str | None) -> BackupJobType | None:
    if not job_type:
        return None
    try:
        return BackupJobType(job_type.lower())
    except ValueError as error:
        raise APIError(400, "INVALID_PARAMETER", "Invalid backup type filter.") from error


def _restore_scope(scope: str | None) -> RestoreScope:
    if scope in (None, ""):
        return RestoreScope.SYSTEM
    try:
        return RestoreScope(scope.lower())
    except ValueError as error:
        raise APIError(400, "INVALID_PARAMETER", "Invalid restore scope.") from error


def _storage_root() -> Path:
    return Path(current_app.config["STORAGE_ROOT"]).resolve()


def _container_usage_by_user() -> tuple[dict[int, int], bool]:
    data = collect_container_metrics(bool(current_app.config["DOCKER_ENABLED"]))
    if not data.get("available"):
        return {}, False

    usage: dict[int, int] = {}
    for item in data.get("items", []):
        labels = item.get("labels") or {}
        if not isinstance(labels, dict):
            continue
        candidate = labels.get("cloud.user_id") or labels.get("user_id") or labels.get("owner_id")
        try:
            user_id = int(candidate)
        except (TypeError, ValueError):
            continue
        usage[user_id] = usage.get(user_id, 0) + (1 if item.get("running") else 0)
    return usage, True


def _upsert_default_quota_for_user(user: User) -> ResourceQuota:
    quota = db.session.get(ResourceQuota, user.id)
    if quota is None:
        quota = get_or_create_quota(user)
    else:
        sync_quota_storage_usage(user)
    db.session.add(quota)
    return quota


@monitoring_bp.before_request
@jwt_required()
def _monitoring_guard():
    # CORS preflight requests do not carry JWT and must pass untouched.
    if request.method == "OPTIONS":
        return None

    user = current_user(required=True)
    assert user is not None
    g.monitoring_user = user

    if not user.is_admin and (request.endpoint or "") not in USER_VISIBLE_ENDPOINTS:
        raise APIError(403, "FORBIDDEN", "Monitoring is restricted to administrators.")

    max_attempts, window_seconds = parse_rate_limit(str(current_app.config["RATE_LIMIT_MONITORING"]))
    rate_key = f"monitoring:{user.id}:{request.endpoint or 'unknown'}"
    if not monitoring_rate_limiter.allow(rate_key, max_attempts=max_attempts, window_seconds=window_seconds):
        raise APIError(429, "RATE_LIMITED", "Monitoring API rate limit exceeded.")


@monitoring_bp.get("/overview")
def overview():
    def build_payload() -> dict[str, Any]:
        host = collect_host_metrics(_storage_root())
        containers = collect_container_metrics(bool(current_app.config["DOCKER_ENABLED"]))

        running_backups = BackupJob.query.filter(BackupJob.status == BackupJobStatus.RUNNING).count()
        last_success = (
            BackupJob.query.filter(BackupJob.status == BackupJobStatus.SUCCESS)
            .order_by(BackupJob.finished_at.desc(), BackupJob.id.desc())
            .first()
        )
        last_failure = (
            BackupJob.query.filter(BackupJob.status == BackupJobStatus.FAILED)
            .order_by(BackupJob.finished_at.desc(), BackupJob.id.desc())
            .first()
        )
        latest_snapshot = SystemMetricSnapshot.query.order_by(SystemMetricSnapshot.ts.desc()).first()

        messages: list[str] = []
        if not host.get("available"):
            messages.append("Host metric provider is degraded (psutil unavailable).")
        if not containers.get("available"):
            messages.append(str(containers.get("reason") or "Container metrics unavailable."))

        status = "degraded" if messages else "ok"

        container_items = containers.get("items") or []
        return {
            "health": {
                "status": status,
                "degraded_mode": bool(messages),
                "messages": messages,
            },
            "kpis": {
                "cpu_percent": host.get("cpu_percent"),
                "memory_percent": host.get("memory_percent"),
                "disk_percent": host.get("disk_percent"),
                "network_total_bytes": {
                    "sent": host.get("net_bytes_sent"),
                    "recv": host.get("net_bytes_recv"),
                },
            },
            "host": host,
            "containers": {
                "available": bool(containers.get("available")),
                "reason": containers.get("reason"),
                "running": sum(1 for item in container_items if item.get("running")),
                "total": len(container_items),
            },
            "backups": {
                "running": running_backups,
                "last_success_at": last_success.finished_at.isoformat() if last_success and last_success.finished_at else None,
                "last_failure_at": last_failure.finished_at.isoformat() if last_failure and last_failure.finished_at else None,
            },
            "snapshots": {
                "interval_seconds": int(current_app.config["METRICS_SNAPSHOT_INTERVAL_SECONDS"]),
                "retention_days": int(current_app.config["METRICS_RETENTION_DAYS"]),
                "latest_ts": latest_snapshot.ts.isoformat() if latest_snapshot else None,
                "trend_last_hour": network_snapshot_series(1),
            },
            "captured_at": utc_now().isoformat(),
        }

    return _cached("overview", build_payload)


@monitoring_bp.get("/containers")
def containers():
    def build_payload() -> dict[str, Any]:
        payload = collect_container_metrics(bool(current_app.config["DOCKER_ENABLED"]))
        items = payload.get("items") or []
        return {
            "available": bool(payload.get("available")),
            "reason": payload.get("reason"),
            "running_containers": sum(1 for item in items if item.get("running")),
            "total_containers": len(items),
            "items": items,
            "captured_at": utc_now().isoformat(),
        }

    return _cached("containers", build_payload)


@monitoring_bp.get("/storage")
def storage():
    return _cached("storage", lambda: storage_breakdown(_storage_root()))


@monitoring_bp.get("/network")
def network():
    return _cached("network", lambda: network_usage_payload(_storage_root()))


@monitoring_bp.get("/snapshots")
def snapshots():
    try:
        hours = min(168, max(1, int(request.args.get("hours", "24"))))
    except ValueError as error:
        raise APIError(400, "INVALID_PARAMETER", "hours must be an integer.") from error

    rows = (
        SystemMetricSnapshot.query.filter(SystemMetricSnapshot.ts >= utc_now() - timedelta(hours=hours))
        .order_by(SystemMetricSnapshot.ts.desc())
        .all()
    )
    items = [row.to_dict() for row in reversed(rows)]
    return jsonify({"hours": hours, "items": items})


@monitoring_bp.get("/backups")
def list_backups():
    status_filter = _backup_status(request.args.get("status"))
    type_filter = _backup_type(request.args.get("type"))
    q = (request.args.get("q") or "").strip()
    from_dt = _parse_iso_datetime(request.args.get("from"), "from")
    to_dt = _parse_iso_datetime(request.args.get("to"), "to")
    page, page_size = _parse_pagination()

    query = BackupJob.query
    if status_filter is not None:
        query = query.filter(BackupJob.status == status_filter)
    if type_filter is not None:
        query = query.filter(BackupJob.type == type_filter)
    if from_dt is not None:
        query = query.filter(BackupJob.started_at >= from_dt)
    if to_dt is not None:
        query = query.filter(BackupJob.started_at <= to_dt)
    if q:
        query = query.filter(
            or_(
                BackupJob.target.ilike(f"%{q}%"),
                BackupJob.error_message.ilike(f"%{q}%"),
                BackupJob.logs.ilike(f"%{q}%"),
            )
        )

    total = query.count()
    items = (
        query.order_by(BackupJob.started_at.desc().nullslast(), BackupJob.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return jsonify(
        {
            "items": [item.to_dict(include_logs=False) for item in items],
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": (total + page_size - 1) // page_size,
            },
        }
    )


@monitoring_bp.get("/backups/<int:backup_id>")
def backup_details(backup_id: int):
    item = db.session.get(BackupJob, backup_id)
    if item is None:
        raise APIError(404, "NOT_FOUND", "Backup job not found.")
    return jsonify({"backup": item.to_dict(include_logs=True)})


def _backup_audit_action(status: BackupJobStatus) -> tuple[str, str, bool]:
    if status == BackupJobStatus.RUNNING:
        return "backup.start", "info", True
    if status == BackupJobStatus.SUCCESS:
        return "backup.success", "info", True
    if status == BackupJobStatus.FAILED:
        return "backup.failure", "error", False
    return "backup.scheduled", "info", True


@monitoring_bp.post("/backups")
def create_backup_job():
    actor = g.monitoring_user
    assert actor is not None and actor.is_admin

    payload = request.get_json(silent=True) or {}
    backup_type = _backup_type(payload.get("type")) or BackupJobType.FULL
    status = _backup_status(payload.get("status")) or BackupJobStatus.SCHEDULED
    target = (payload.get("target") or "").strip()
    if not target:
        raise APIError(400, "INVALID_PARAMETER", "target is required.")

    started_at = _parse_iso_datetime(payload.get("started_at"), "started_at")
    finished_at = _parse_iso_datetime(payload.get("finished_at"), "finished_at")

    job = BackupJob(
        type=backup_type,
        status=status,
        started_at=started_at,
        finished_at=finished_at,
        size_bytes=int(payload.get("size_bytes")) if payload.get("size_bytes") not in (None, "") else None,
        target=target,
        logs=str(payload.get("logs") or ""),
        error_message=(payload.get("error_message") or None),
        created_by_id=actor.id,
    )

    if job.status == BackupJobStatus.RUNNING and job.started_at is None:
        job.started_at = utc_now()
    if job.status in {BackupJobStatus.SUCCESS, BackupJobStatus.FAILED} and job.finished_at is None:
        job.finished_at = utc_now()

    db.session.add(job)
    db.session.flush()

    action, severity, success = _backup_audit_action(job.status)
    audit(
        action=action,
        actor=actor,
        entity_type="backup_job",
        entity_id=str(job.id),
        metadata={"status": job.status.value, "type": job.type.value, "target": job.target},
        severity=severity,
        success=success,
    )

    db.session.commit()
    return jsonify({"backup": job.to_dict(include_logs=True)}), 201


@monitoring_bp.patch("/backups/<int:backup_id>")
def update_backup_job(backup_id: int):
    actor = g.monitoring_user
    assert actor is not None and actor.is_admin

    job = db.session.get(BackupJob, backup_id)
    if job is None:
        raise APIError(404, "NOT_FOUND", "Backup job not found.")

    payload = request.get_json(silent=True) or {}

    if "type" in payload:
        job.type = _backup_type(payload.get("type")) or job.type
    if "status" in payload:
        job.status = _backup_status(payload.get("status")) or job.status
    if "started_at" in payload:
        job.started_at = _parse_iso_datetime(payload.get("started_at"), "started_at")
    if "finished_at" in payload:
        job.finished_at = _parse_iso_datetime(payload.get("finished_at"), "finished_at")
    if "size_bytes" in payload:
        value = payload.get("size_bytes")
        job.size_bytes = None if value in (None, "") else int(value)
    if "target" in payload:
        target = (payload.get("target") or "").strip()
        if not target:
            raise APIError(400, "INVALID_PARAMETER", "target cannot be empty.")
        job.target = target
    if "error_message" in payload:
        job.error_message = (payload.get("error_message") or None)
    if "logs" in payload:
        job.logs = str(payload.get("logs") or "")
    if "logs_append" in payload:
        append_chunk = str(payload.get("logs_append") or "")
        job.logs = f"{job.logs or ''}{append_chunk}"

    if job.status == BackupJobStatus.RUNNING and job.started_at is None:
        job.started_at = utc_now()
    if job.status in {BackupJobStatus.SUCCESS, BackupJobStatus.FAILED} and job.finished_at is None:
        job.finished_at = utc_now()

    action, severity, success = _backup_audit_action(job.status)
    audit(
        action=action,
        actor=actor,
        entity_type="backup_job",
        entity_id=str(job.id),
        metadata={"status": job.status.value, "type": job.type.value},
        severity=severity,
        success=success,
    )

    db.session.commit()
    return jsonify({"backup": job.to_dict(include_logs=True)})


@monitoring_bp.get("/restore-points")
def list_restore_points():
    scope_filter = request.args.get("scope")
    page, page_size = _parse_pagination()

    query = RestorePoint.query
    if scope_filter:
        query = query.filter(RestorePoint.scope == _restore_scope(scope_filter))

    total = query.count()
    items = (
        query.order_by(RestorePoint.created_at.desc(), RestorePoint.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return jsonify(
        {
            "items": [item.to_dict() for item in items],
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": (total + page_size - 1) // page_size,
            },
        }
    )


@monitoring_bp.post("/restore-points")
def create_restore_point():
    actor = g.monitoring_user
    assert actor is not None and actor.is_admin

    payload = request.get_json(silent=True) or {}
    label = (payload.get("label") or "").strip()
    if len(label) < 2:
        raise APIError(400, "INVALID_PARAMETER", "label is required.")

    source_backup_job_id = payload.get("source_backup_job_id")
    if source_backup_job_id not in (None, ""):
        try:
            source_backup_job_id = int(source_backup_job_id)
        except (TypeError, ValueError) as error:
            raise APIError(400, "INVALID_PARAMETER", "source_backup_job_id must be an integer.") from error
        if db.session.get(BackupJob, source_backup_job_id) is None:
            raise APIError(404, "NOT_FOUND", "source_backup_job_id does not exist.")
    else:
        source_backup_job_id = None

    scope = _restore_scope(payload.get("scope"))
    metadata = payload.get("metadata")
    if metadata is not None and not isinstance(metadata, dict):
        raise APIError(400, "INVALID_PARAMETER", "metadata must be a JSON object.")

    restore_point = RestorePoint(
        label=label,
        source_backup_job_id=source_backup_job_id,
        scope=scope,
        metadata_json=metadata or {},
        size_bytes=int(payload.get("size_bytes")) if payload.get("size_bytes") not in (None, "") else None,
    )

    db.session.add(restore_point)
    db.session.flush()
    audit(
        action="restore.point_created",
        actor=actor,
        entity_type="restore_point",
        entity_id=str(restore_point.id),
        metadata={"scope": restore_point.scope.value, "label": restore_point.label},
    )
    db.session.commit()

    return jsonify({"restore_point": restore_point.to_dict()}), 201


@monitoring_bp.post("/restore-points/<int:restore_point_id>/restore")
def restore_stub(restore_point_id: int):
    item = db.session.get(RestorePoint, restore_point_id)
    if item is None:
        raise APIError(404, "NOT_FOUND", "Restore point not found.")
    return (
        jsonify(
            {
                "supported": False,
                "message": "Restore execution is not implemented in this MVP. Use this endpoint as integration hook.",
                "restore_point": item.to_dict(),
            }
        ),
        501,
    )


@monitoring_bp.get("/quotas")
def list_quotas():
    viewer = g.monitoring_user
    assert viewer is not None

    if viewer.is_admin:
        users = User.query.order_by(User.username.asc()).all()
    else:
        users = [viewer]

    items = []
    for user in users:
        quota = _upsert_default_quota_for_user(user)
        items.append(quota.to_dict(include_username=True))

    db.session.commit()
    return jsonify({"items": items})


@monitoring_bp.put("/quotas/<int:user_id>")
def update_quota(user_id: int):
    actor = g.monitoring_user
    assert actor is not None
    if not actor.is_admin:
        raise APIError(403, "FORBIDDEN", "Admin access required.")

    user = db.session.get(User, user_id)
    if user is None:
        raise APIError(404, "NOT_FOUND", "User not found.")

    payload = request.get_json(silent=True) or {}
    quota = _upsert_default_quota_for_user(user)

    def _coerce_non_negative(name: str, value: Any, integer: bool = True) -> int | float:
        try:
            parsed: int | float = int(value) if integer else float(value)
        except (TypeError, ValueError) as error:
            raise APIError(400, "INVALID_PARAMETER", f"{name} must be numeric.") from error
        if parsed < 0:
            raise APIError(400, "INVALID_PARAMETER", f"{name} must be >= 0.")
        return parsed

    if "bytes_limit" in payload:
        next_limit = int(_coerce_non_negative("bytes_limit", payload["bytes_limit"], integer=True))
        if next_limit < user.bytes_used:
            raise APIError(400, "INVALID_PARAMETER", "bytes_limit cannot be lower than current usage.")
        user.bytes_limit = next_limit
        quota.bytes_limit = next_limit

    if "max_running_containers" in payload:
        quota.max_running_containers = int(
            _coerce_non_negative("max_running_containers", payload["max_running_containers"], integer=True)
        )
    if "max_cpu_percent" in payload:
        quota.max_cpu_percent = float(_coerce_non_negative("max_cpu_percent", payload["max_cpu_percent"], integer=False))
    if "max_ram_mb" in payload:
        quota.max_ram_mb = int(_coerce_non_negative("max_ram_mb", payload["max_ram_mb"], integer=True))

    if "monthly_bytes_in_limit" in payload:
        quota.monthly_bytes_in_limit = int(
            _coerce_non_negative("monthly_bytes_in_limit", payload["monthly_bytes_in_limit"], integer=True)
        )
    if "monthly_bytes_out_limit" in payload:
        quota.monthly_bytes_out_limit = int(
            _coerce_non_negative("monthly_bytes_out_limit", payload["monthly_bytes_out_limit"], integer=True)
        )

    if "monthly_bytes_in_used" in payload:
        quota.monthly_bytes_in_used = int(
            _coerce_non_negative("monthly_bytes_in_used", payload["monthly_bytes_in_used"], integer=True)
        )
    if "monthly_bytes_out_used" in payload:
        quota.monthly_bytes_out_used = int(
            _coerce_non_negative("monthly_bytes_out_used", payload["monthly_bytes_out_used"], integer=True)
        )

    quota.bytes_used = user.bytes_used

    audit(
        action="monitoring.quota_update",
        actor=actor,
        entity_type="resource_quota",
        entity_id=str(user.id),
        metadata={"user_id": user.id, "username": user.username},
    )

    db.session.add(user)
    db.session.add(quota)
    db.session.commit()

    return jsonify({"quota": quota.to_dict(include_username=True)})


@monitoring_bp.get("/quotas/usage")
def quotas_usage():
    viewer = g.monitoring_user
    assert viewer is not None

    if viewer.is_admin:
        users = User.query.order_by(User.username.asc()).all()
    else:
        users = [viewer]

    container_usage, container_available = _container_usage_by_user()
    items = []
    for user in users:
        quota = _upsert_default_quota_for_user(user)
        items.append(
            {
                "user_id": user.id,
                "username": user.username,
                "storage": {
                    "bytes_used": int(user.bytes_used),
                    "bytes_limit": int(user.bytes_limit),
                    "usage_percent": (float(user.bytes_used) / float(user.bytes_limit) * 100.0) if user.bytes_limit else None,
                },
                "containers": {
                    "running": container_usage.get(user.id) if container_available else None,
                    "max_running_containers": quota.max_running_containers,
                    "max_cpu_percent": quota.max_cpu_percent,
                    "max_ram_mb": quota.max_ram_mb,
                },
                "bandwidth": {
                    "usage_month": quota.usage_month,
                    "bytes_in_used": quota.monthly_bytes_in_used,
                    "bytes_out_used": quota.monthly_bytes_out_used,
                    "bytes_in_limit": quota.monthly_bytes_in_limit,
                    "bytes_out_limit": quota.monthly_bytes_out_limit,
                },
            }
        )

    db.session.commit()
    return jsonify(
        {
            "items": items,
            "container_metrics_available": container_available,
            "captured_at": utc_now().isoformat(),
        }
    )
