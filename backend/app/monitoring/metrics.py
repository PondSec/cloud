from __future__ import annotations

import os
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import func

from ..models import FileNode, SystemMetricSnapshot, User

try:
    import psutil  # type: ignore[import-not-found]
except Exception:  # pragma: no cover - import fallback path
    psutil = None


def _directory_size(path: Path, max_depth: int = 5) -> int:
    total = 0
    root_depth = len(path.parts)
    for current_root, dirs, files in os.walk(path):
        current_depth = len(Path(current_root).parts) - root_depth
        if current_depth >= max_depth:
            dirs[:] = []
        for filename in files:
            candidate = Path(current_root) / filename
            try:
                total += candidate.stat().st_size
            except OSError:
                continue
    return total


def _load_average() -> tuple[float | None, float | None, float | None]:
    if hasattr(os, "getloadavg"):
        try:
            load_1, load_5, load_15 = os.getloadavg()
            return float(load_1), float(load_5), float(load_15)
        except OSError:
            pass
    return None, None, None


def _fallback_memory_stats() -> tuple[int | None, int | None, float | None]:
    page_size_key = "SC_PAGE_SIZE" if "SC_PAGE_SIZE" in os.sysconf_names else "SC_PAGESIZE"
    try:
        total_pages = int(os.sysconf("SC_PHYS_PAGES"))
        available_pages = int(os.sysconf("SC_AVPHYS_PAGES"))
        page_size = int(os.sysconf(page_size_key))
        if total_pages <= 0 or page_size <= 0:
            return None, None, None
        total = total_pages * page_size
        available = max(0, available_pages) * page_size
        used = max(0, total - available)
        percent = (used / total * 100.0) if total > 0 else None
        return used, total, percent
    except Exception:
        return None, None, None


def _fallback_network_totals() -> tuple[int | None, int | None]:
    proc_net = Path("/proc/net/dev")
    if not proc_net.exists():
        return None, None
    sent_total = 0
    recv_total = 0
    try:
        for line in proc_net.read_text(encoding="utf-8").splitlines()[2:]:
            if ":" not in line:
                continue
            _, values = line.split(":", 1)
            columns = values.split()
            if len(columns) < 10:
                continue
            recv_total += int(columns[0] or 0)
            sent_total += int(columns[8] or 0)
        return sent_total, recv_total
    except Exception:
        return None, None


def collect_host_metrics(storage_root: Path) -> dict[str, Any]:
    if psutil is None:
        total, used, free = shutil.disk_usage(storage_root)
        load_1, load_5, load_15 = _load_average()
        memory_used, memory_total, memory_percent = _fallback_memory_stats()
        net_sent, net_recv = _fallback_network_totals()
        cpu_count = max(1, int(os.cpu_count() or 1))
        cpu_percent = (min(100.0, max(0.0, (load_1 / cpu_count) * 100.0)) if load_1 is not None else None)
        return {
            "available": False,
            "reason": "psutil is not installed",
            "cpu_percent": cpu_percent,
            "memory_percent": memory_percent,
            "memory_used_bytes": memory_used,
            "memory_total_bytes": memory_total,
            "disk_percent": (used / total * 100.0) if total > 0 else 0.0,
            "disk_used_bytes": used,
            "disk_free_bytes": free,
            "disk_total_bytes": total,
            "disk_read_bytes": None,
            "disk_write_bytes": None,
            "net_bytes_sent": net_sent,
            "net_bytes_recv": net_recv,
            "load_average": {
                "one": load_1,
                "five": load_5,
                "fifteen": load_15,
            },
            "per_interface": [],
            "captured_at": datetime.now(timezone.utc).isoformat(),
        }

    memory = psutil.virtual_memory()
    disk = psutil.disk_usage(str(storage_root))
    disk_io = psutil.disk_io_counters()
    net_total = psutil.net_io_counters()
    per_interface = []
    for name, counters in psutil.net_io_counters(pernic=True).items():
        per_interface.append(
            {
                "name": name,
                "bytes_sent": int(counters.bytes_sent),
                "bytes_recv": int(counters.bytes_recv),
                "packets_sent": int(counters.packets_sent),
                "packets_recv": int(counters.packets_recv),
                "errin": int(counters.errin),
                "errout": int(counters.errout),
                "dropin": int(counters.dropin),
                "dropout": int(counters.dropout),
            }
        )

    load_1, load_5, load_15 = _load_average()

    return {
        "available": True,
        "reason": None,
        "cpu_percent": float(psutil.cpu_percent(interval=None)),
        "memory_percent": float(memory.percent),
        "memory_used_bytes": int(memory.used),
        "memory_total_bytes": int(memory.total),
        "disk_percent": float(disk.percent),
        "disk_used_bytes": int(disk.used),
        "disk_free_bytes": int(disk.free),
        "disk_total_bytes": int(disk.total),
        "disk_read_bytes": int(disk_io.read_bytes) if disk_io else None,
        "disk_write_bytes": int(disk_io.write_bytes) if disk_io else None,
        "net_bytes_sent": int(net_total.bytes_sent) if net_total else None,
        "net_bytes_recv": int(net_total.bytes_recv) if net_total else None,
        "load_average": {
            "one": load_1,
            "five": load_5,
            "fifteen": load_15,
        },
        "per_interface": sorted(per_interface, key=lambda entry: entry["bytes_recv"], reverse=True),
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }


def storage_breakdown(storage_root: Path) -> dict[str, Any]:
    host = collect_host_metrics(storage_root)
    total_storage = host.get("disk_total_bytes")
    used_storage = host.get("disk_used_bytes")
    free_storage = host.get("disk_free_bytes")

    user_usage = (
        User.query.with_entities(User.id, User.username, User.bytes_used, User.bytes_limit)
        .order_by(User.bytes_used.desc())
        .all()
    )
    per_user = [
        {
            "user_id": row[0],
            "username": row[1],
            "bytes_used": int(row[2] or 0),
            "bytes_limit": int(row[3] or 0),
            "usage_percent": (float(row[2] or 0) / float(row[3]) * 100.0) if row[3] else None,
        }
        for row in user_usage
    ]

    top_dirs: list[dict[str, Any]] = []
    if storage_root.exists():
        for entry in storage_root.iterdir():
            if not entry.is_dir():
                continue
            size = _directory_size(entry)
            top_dirs.append({"path": str(entry.relative_to(storage_root)), "size_bytes": size})
        top_dirs.sort(key=lambda item: item["size_bytes"], reverse=True)

    projects_root = storage_root / "projects"
    per_project: list[dict[str, Any]] = []
    if projects_root.exists() and projects_root.is_dir():
        for entry in projects_root.iterdir():
            if not entry.is_dir():
                continue
            per_project.append(
                {
                    "project": entry.name,
                    "size_bytes": _directory_size(entry),
                }
            )
        per_project.sort(key=lambda item: item["size_bytes"], reverse=True)

    if not per_project:
        file_counts_by_user = (
            User.query.join(FileNode, FileNode.owner_id == User.id)
            .with_entities(User.id, User.username, func.count(FileNode.id), func.sum(FileNode.size))
            .group_by(User.id, User.username)
            .order_by(func.sum(FileNode.size).desc())
            .all()
        )
        per_project = [
            {
                "project": f"user:{row[1]}",
                "size_bytes": int(row[3] or 0),
                "file_count": int(row[2] or 0),
            }
            for row in file_counts_by_user
        ]

    return {
        "total_bytes": int(total_storage or 0),
        "used_bytes": int(used_storage or 0),
        "free_bytes": int(free_storage or 0),
        "per_user": per_user,
        "per_project": per_project,
        "top_directories": top_dirs[:12],
        "provider": {
            "psutil": bool(host.get("available")),
        },
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }


def network_snapshot_series(hours: int) -> list[dict[str, Any]]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, hours))
    snapshots = (
        SystemMetricSnapshot.query.filter(SystemMetricSnapshot.ts >= cutoff)
        .order_by(SystemMetricSnapshot.ts.asc())
        .all()
    )
    return [
        {
            "ts": item.ts.isoformat(),
            "net_bytes_sent": item.net_bytes_sent,
            "net_bytes_recv": item.net_bytes_recv,
            "cpu_percent": item.cpu_percent,
            "memory_percent": item.memory_percent,
            "disk_percent": item.disk_percent,
        }
        for item in snapshots
    ]


def network_usage_payload(storage_root: Path) -> dict[str, Any]:
    host = collect_host_metrics(storage_root)
    return {
        "totals": {
            "bytes_sent": host.get("net_bytes_sent"),
            "bytes_recv": host.get("net_bytes_recv"),
        },
        "interfaces": host.get("per_interface") or [],
        "provider": {
            "psutil": bool(host.get("available")),
            "reason": host.get("reason"),
        },
        "trends": {
            "last_hour": network_snapshot_series(1),
            "last_day": network_snapshot_series(24),
        },
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }
