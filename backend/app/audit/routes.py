from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from flask import Blueprint, current_app, g, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import cast, distinct, or_

from ..common.errors import APIError
from ..common.rate_limit import monitoring_rate_limiter, parse_rate_limit
from ..common.rbac import current_user
from ..extensions import db
from ..models import AuditLog


audit_bp = Blueprint("audit", __name__, url_prefix="/api/audit")


def _parse_iso_datetime(value: str | None, field_name: str) -> datetime | None:
    if value in (None, ""):
        return None
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError as error:
        raise APIError(400, "INVALID_PARAMETER", f"{field_name} must be an ISO-8601 datetime.") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_bool(value: str | None, field_name: str) -> bool | None:
    if value in (None, ""):
        return None
    cleaned = value.strip().lower()
    if cleaned in {"1", "true", "yes"}:
        return True
    if cleaned in {"0", "false", "no"}:
        return False
    raise APIError(400, "INVALID_PARAMETER", f"{field_name} must be true or false.")


def _filtered_query():
    from_dt = _parse_iso_datetime(request.args.get("from"), "from")
    to_dt = _parse_iso_datetime(request.args.get("to"), "to")
    q = (request.args.get("q") or "").strip()
    action = (request.args.get("action") or "").strip()
    user_id = request.args.get("user_id")
    success = _parse_bool(request.args.get("success"), "success")
    severity = (request.args.get("severity") or "").strip().lower()

    query = AuditLog.query
    if from_dt is not None:
        query = query.filter(AuditLog.ts >= from_dt)
    if to_dt is not None:
        query = query.filter(AuditLog.ts <= to_dt)
    if action:
        query = query.filter(AuditLog.action == action)
    if user_id not in (None, ""):
        try:
            query = query.filter(AuditLog.actor_user_id == int(user_id))
        except ValueError as error:
            raise APIError(400, "INVALID_PARAMETER", "user_id must be an integer.") from error
    if success is not None:
        query = query.filter(AuditLog.success == success)
    if severity:
        query = query.filter(AuditLog.severity == severity)
    if q:
        wildcard = f"%{q}%"
        query = query.filter(
            or_(
                AuditLog.action.ilike(wildcard),
                AuditLog.entity_type.ilike(wildcard),
                AuditLog.entity_id.ilike(wildcard),
                cast(AuditLog.metadata_json, db.String).ilike(wildcard),
            )
        )

    return query


@audit_bp.before_request
@jwt_required()
def _guard_admin():
    # CORS preflight requests do not carry JWT and must pass untouched.
    if request.method == "OPTIONS":
        return None

    user = current_user(required=True)
    assert user is not None
    if not user.is_admin:
        raise APIError(403, "FORBIDDEN", "Audit logs are restricted to administrators.")
    g.audit_user = user

    max_attempts, window_seconds = parse_rate_limit(str(current_app.config["RATE_LIMIT_MONITORING"]))
    rate_key = f"audit:{user.id}:{request.endpoint or 'unknown'}"
    if not monitoring_rate_limiter.allow(rate_key, max_attempts=max_attempts, window_seconds=window_seconds):
        raise APIError(429, "RATE_LIMITED", "Audit API rate limit exceeded.")


@audit_bp.get("/logs")
def list_logs():
    query = _filtered_query()

    export = (request.args.get("export") or "").strip().lower()
    if export == "csv":
        rows = query.order_by(AuditLog.ts.desc(), AuditLog.id.desc()).limit(10000).all()
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "id",
                "ts",
                "actor_user_id",
                "actor_ip",
                "user_agent",
                "action",
                "entity_type",
                "entity_id",
                "severity",
                "success",
                "metadata",
            ]
        )
        for row in rows:
            writer.writerow(
                [
                    row.id,
                    row.ts.isoformat(),
                    row.actor_user_id,
                    row.actor_ip,
                    row.user_agent,
                    row.action,
                    row.entity_type,
                    row.entity_id,
                    row.severity,
                    "true" if row.success else "false",
                    row.metadata_json or {},
                ]
            )

        payload = buffer.getvalue()
        return (
            payload,
            200,
            {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": f'attachment; filename="audit-logs-{datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")}.csv"',
            },
        )

    try:
        page = max(1, int(request.args.get("page", "1")))
        page_size = min(200, max(1, int(request.args.get("page_size", "50"))))
    except ValueError as error:
        raise APIError(400, "INVALID_PARAMETER", "page and page_size must be integers.") from error

    total = query.count()
    items = (
        query.order_by(AuditLog.ts.desc(), AuditLog.id.desc())
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


@audit_bp.get("/actions")
def list_actions():
    actions = [
        row[0]
        for row in db.session.query(distinct(AuditLog.action))
        .filter(AuditLog.action.isnot(None))
        .order_by(AuditLog.action.asc())
        .all()
        if row[0]
    ]
    return jsonify({"items": actions})
