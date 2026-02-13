from __future__ import annotations

from datetime import datetime, timezone

from ..extensions import db
from ..models import ResourceQuota, User


def current_usage_month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _reset_month_if_needed(quota: ResourceQuota) -> None:
    month = current_usage_month()
    if quota.usage_month != month:
        quota.usage_month = month
        quota.monthly_bytes_in_used = 0
        quota.monthly_bytes_out_used = 0


def get_or_create_quota(user: User) -> ResourceQuota:
    quota = db.session.get(ResourceQuota, user.id)
    if quota is None:
        quota = ResourceQuota(
            user_id=user.id,
            bytes_limit=user.bytes_limit,
            bytes_used=user.bytes_used,
            max_running_containers=0,
            max_cpu_percent=0.0,
            max_ram_mb=0,
            monthly_bytes_in_limit=0,
            monthly_bytes_out_limit=0,
            monthly_bytes_in_used=0,
            monthly_bytes_out_used=0,
            usage_month=current_usage_month(),
        )
        db.session.add(quota)
    else:
        _reset_month_if_needed(quota)
        quota.bytes_limit = user.bytes_limit
        quota.bytes_used = user.bytes_used
    return quota


def track_bandwidth_usage(user_id: int, *, bytes_in: int = 0, bytes_out: int = 0) -> None:
    user = db.session.get(User, user_id)
    if user is None:
        return
    quota = get_or_create_quota(user)
    if bytes_in > 0:
        quota.monthly_bytes_in_used += int(bytes_in)
    if bytes_out > 0:
        quota.monthly_bytes_out_used += int(bytes_out)
    db.session.add(quota)


def sync_quota_storage_usage(user: User) -> ResourceQuota:
    quota = get_or_create_quota(user)
    quota.bytes_limit = user.bytes_limit
    quota.bytes_used = user.bytes_used
    return quota
