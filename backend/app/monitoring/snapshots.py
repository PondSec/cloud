from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from flask import Flask

from ..extensions import db
from ..models import SystemMetricSnapshot
from .metrics import collect_host_metrics


class MetricsSnapshotScheduler:
    def __init__(self, app: Flask, interval_seconds: int, retention_days: int) -> None:
        self._app = app
        self._interval_seconds = max(5, int(interval_seconds))
        self._retention_days = max(1, int(retention_days))
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="metrics-snapshot-scheduler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def _run(self) -> None:
        while not self._stop_event.is_set():
            with self._app.app_context():
                try:
                    run_snapshot_cycle(Path(self._app.config["STORAGE_ROOT"]), self._retention_days)
                except Exception as error:  # pragma: no cover - defensive runtime logging
                    self._app.logger.warning("snapshot collection failed: %s", error)
                    db.session.rollback()
            self._stop_event.wait(self._interval_seconds)


def run_snapshot_cycle(storage_root: Path, retention_days: int) -> SystemMetricSnapshot:
    payload = collect_host_metrics(storage_root)
    load = payload.get("load_average") or {}
    provider_status = {
        "psutil": bool(payload.get("available")),
        "reason": payload.get("reason"),
    }

    snapshot = SystemMetricSnapshot(
        ts=datetime.now(timezone.utc),
        cpu_percent=payload.get("cpu_percent"),
        memory_percent=payload.get("memory_percent"),
        disk_percent=payload.get("disk_percent"),
        disk_used_bytes=payload.get("disk_used_bytes"),
        disk_total_bytes=payload.get("disk_total_bytes"),
        disk_read_bytes=payload.get("disk_read_bytes"),
        disk_write_bytes=payload.get("disk_write_bytes"),
        net_bytes_sent=payload.get("net_bytes_sent"),
        net_bytes_recv=payload.get("net_bytes_recv"),
        load_1=load.get("one"),
        load_5=load.get("five"),
        load_15=load.get("fifteen"),
        interfaces_json={item["name"]: {"bytes_sent": item["bytes_sent"], "bytes_recv": item["bytes_recv"]} for item in payload.get("per_interface", [])},
        provider_status_json=provider_status,
    )

    db.session.add(snapshot)
    prune_old_snapshots(retention_days)
    db.session.commit()
    return snapshot


def prune_old_snapshots(retention_days: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, retention_days))
    deleted = SystemMetricSnapshot.query.filter(SystemMetricSnapshot.ts < cutoff).delete()  # type: ignore[call-arg]
    return int(deleted or 0)


def should_start_snapshot_scheduler(app: Flask) -> bool:
    if app.config.get("TESTING"):
        return False

    if app.debug:
        return os.environ.get("WERKZEUG_RUN_MAIN") == "true"
    return True


def start_snapshot_scheduler(app: Flask) -> MetricsSnapshotScheduler | None:
    if not should_start_snapshot_scheduler(app):
        return None
    scheduler = MetricsSnapshotScheduler(
        app=app,
        interval_seconds=int(app.config["METRICS_SNAPSHOT_INTERVAL_SECONDS"]),
        retention_days=int(app.config["METRICS_RETENTION_DAYS"]),
    )
    scheduler.start()
    return scheduler
