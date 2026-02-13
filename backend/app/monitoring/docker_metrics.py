from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _parse_docker_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"

    if "." in raw:
        prefix, suffix = raw.split(".", 1)
        if "+" in suffix:
            frac, tz = suffix.split("+", 1)
            raw = f"{prefix}.{frac[:6]}+{tz}"
        elif "-" in suffix:
            frac, tz = suffix.split("-", 1)
            raw = f"{prefix}.{frac[:6]}-{tz}"
        else:
            raw = f"{prefix}.{suffix[:6]}"

    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _container_cpu_percent(stats: dict[str, Any]) -> float | None:
    try:
        cpu_delta = (
            float(stats["cpu_stats"]["cpu_usage"]["total_usage"])
            - float(stats["precpu_stats"]["cpu_usage"]["total_usage"])
        )
        system_delta = float(stats["cpu_stats"]["system_cpu_usage"]) - float(stats["precpu_stats"]["system_cpu_usage"])
        online_cpus = int(stats["cpu_stats"].get("online_cpus") or 0) or len(
            stats["cpu_stats"]["cpu_usage"].get("percpu_usage") or []
        )
        if cpu_delta <= 0 or system_delta <= 0:
            return 0.0
        if online_cpus <= 0:
            online_cpus = 1
        return (cpu_delta / system_delta) * online_cpus * 100.0
    except Exception:
        return None


def _container_mem(stats: dict[str, Any]) -> tuple[int | None, int | None, float | None]:
    try:
        usage = int(stats.get("memory_stats", {}).get("usage") or 0)
        limit = int(stats.get("memory_stats", {}).get("limit") or 0)
        percent = (usage / limit * 100.0) if limit > 0 else None
        return usage, limit, percent
    except Exception:
        return None, None, None


def _port_mappings(raw_ports: dict[str, Any] | None) -> list[dict[str, str | int]]:
    if not raw_ports:
        return []
    mappings: list[dict[str, str | int]] = []
    for container_port, hosts in raw_ports.items():
        if not hosts:
            continue
        for host in hosts:
            host_port = host.get("HostPort") if isinstance(host, dict) else None
            host_ip = host.get("HostIp") if isinstance(host, dict) else None
            if host_port is None:
                continue
            try:
                host_port_int: int | str = int(host_port)
            except (TypeError, ValueError):
                host_port_int = str(host_port)
            mappings.append(
                {
                    "container_port": container_port,
                    "host_port": host_port_int,
                    "host_ip": str(host_ip or "0.0.0.0"),
                }
            )
    return mappings


def _redacted_env_summary(raw_env: list[str] | None) -> dict[str, Any]:
    if not raw_env:
        return {"count": 0, "keys": []}
    keys: list[str] = []
    for item in raw_env:
        if "=" not in item:
            continue
        key, _ = item.split("=", 1)
        if key:
            keys.append(key)
    keys = sorted(set(keys))
    return {"count": len(keys), "keys": keys[:60]}


def _safe_labels(raw_labels: dict[str, str] | None) -> dict[str, str]:
    if not raw_labels:
        return {}
    safe: dict[str, str] = {}
    for key, value in raw_labels.items():
        lower = key.lower()
        if "user" in lower or "owner" in lower or key in {"cloud.user_id", "user_id", "owner_id"}:
            safe[key] = value
    return safe


def collect_container_metrics(docker_enabled: bool) -> dict[str, Any]:
    if not docker_enabled:
        return {
            "available": False,
            "reason": "Docker metrics are disabled by configuration.",
            "items": [],
        }

    try:
        import docker  # type: ignore[import-not-found]
    except Exception:
        return {
            "available": False,
            "reason": "Docker SDK is not installed.",
            "items": [],
        }

    try:
        client = docker.from_env()
        client.ping()
    except Exception:
        return {
            "available": False,
            "reason": "Docker engine is not reachable.",
            "items": [],
        }

    containers = client.containers.list(all=True)
    now = datetime.now(timezone.utc)

    items: list[dict[str, Any]] = []
    for container in containers:
        attrs = container.attrs or {}
        state = attrs.get("State") or {}
        config = attrs.get("Config") or {}
        network = attrs.get("NetworkSettings") or {}
        started_at = _parse_docker_timestamp(state.get("StartedAt"))
        finished_at = _parse_docker_timestamp(state.get("FinishedAt"))
        uptime_seconds = None
        if started_at is not None:
            end_time = now if str(state.get("Status") or "").lower() == "running" else finished_at or now
            uptime_seconds = max(0, int((end_time - started_at).total_seconds()))

        cpu_percent: float | None = None
        mem_usage_bytes: int | None = None
        mem_limit_bytes: int | None = None
        mem_percent: float | None = None
        try:
            stats = container.stats(stream=False)
            cpu_percent = _container_cpu_percent(stats)
            mem_usage_bytes, mem_limit_bytes, mem_percent = _container_mem(stats)
        except Exception:
            pass

        raw_ports = network.get("Ports") if isinstance(network, dict) else None
        image_name = str(config.get("Image") or "")
        if not image_name:
            tags = list(container.image.tags or [])
            image_name = tags[0] if tags else "unknown"
        items.append(
            {
                "id": str(container.id),
                "name": str(container.name),
                "image": image_name,
                "status": str(state.get("Status") or container.status or "unknown"),
                "running": bool(state.get("Running")),
                "started_at": started_at.isoformat() if started_at else None,
                "uptime_seconds": uptime_seconds,
                "cpu_percent": cpu_percent,
                "memory_usage_bytes": mem_usage_bytes,
                "memory_limit_bytes": mem_limit_bytes,
                "memory_percent": mem_percent,
                "restart_count": int(state.get("RestartCount") or 0),
                "ports": _port_mappings(raw_ports),
                "labels": _safe_labels(config.get("Labels") if isinstance(config, dict) else None),
                "env_summary": _redacted_env_summary(config.get("Env") if isinstance(config, dict) else None),
            }
        )

    return {
        "available": True,
        "reason": None,
        "items": sorted(items, key=lambda item: (0 if item["running"] else 1, str(item["name"]))),
    }
