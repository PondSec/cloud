from __future__ import annotations

import os
from datetime import timedelta
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parents[2]


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def env_str(name: str, default: str) -> str:
    raw = os.getenv(name)
    if raw is None:
        return default
    cleaned = raw.strip()
    return cleaned or default


def env_origins() -> list[str]:
    raw_origins = os.getenv("FRONTEND_ORIGINS")
    if raw_origins:
        origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
        if origins:
            return origins

    raw_origin = os.getenv("FRONTEND_ORIGIN")
    if raw_origin:
        origin = raw_origin.strip()
        if origin:
            return [origin]

    return ["http://localhost:5173", "http://127.0.0.1:5173"]


class Config:
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'cloud.db'}")
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret-key-change-me-at-least-32-bytes")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=env_int("ACCESS_TOKEN_EXPIRES_MINUTES", 15))
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=env_int("REFRESH_TOKEN_EXPIRES_DAYS", 7))

    FRONTEND_ORIGINS = env_origins()
    FRONTEND_ORIGIN = FRONTEND_ORIGINS[0]
    STORAGE_ROOT = os.getenv("STORAGE_ROOT", str(BASE_DIR / "storage"))
    ONLYOFFICE_ENABLED = env_bool("ONLYOFFICE_ENABLED", True)
    ONLYOFFICE_DOCUMENT_SERVER_URL = os.getenv("ONLYOFFICE_DOCUMENT_SERVER_URL", "http://127.0.0.1:8080")
    ONLYOFFICE_PUBLIC_BACKEND_URL = os.getenv("ONLYOFFICE_PUBLIC_BACKEND_URL", "http://127.0.0.1:5000")
    ONLYOFFICE_TOKEN_SECRET = os.getenv("ONLYOFFICE_TOKEN_SECRET", JWT_SECRET_KEY)
    ONLYOFFICE_TOKEN_TTL_SECONDS = env_int("ONLYOFFICE_TOKEN_TTL_SECONDS", 3600)
    ONLYOFFICE_JWT_SECRET = os.getenv("ONLYOFFICE_JWT_SECRET", "")

    ALLOW_REGISTRATION = env_bool("ALLOW_REGISTRATION", False)
    DEFAULT_QUOTA_BYTES = env_int("DEFAULT_QUOTA_BYTES", 5 * 1024 * 1024 * 1024)
    MAX_UPLOAD_SIZE_BYTES = env_int("MAX_UPLOAD_SIZE_BYTES", 25 * 1024 * 1024)

    LOGIN_RATE_LIMIT_WINDOW_SECONDS = env_int("LOGIN_RATE_LIMIT_WINDOW_SECONDS", 300)
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS = env_int("LOGIN_RATE_LIMIT_MAX_ATTEMPTS", 5)

    INVENTORY_PRO_ENABLED = env_bool("INVENTORY_PRO_ENABLED", False)
    INVENTORY_PRO_BASE_URL = env_str("INVENTORY_PRO_BASE_URL", "")
    INVENTORY_PRO_SYNC_ENABLED = env_bool("INVENTORY_PRO_SYNC_ENABLED", True)
    INVENTORY_PRO_SSO_ENABLED = env_bool("INVENTORY_PRO_SSO_ENABLED", True)
    INVENTORY_PRO_ENFORCE_SSO = env_bool("INVENTORY_PRO_ENFORCE_SSO", False)
    INVENTORY_PRO_AUTO_PROVISION_USERS = env_bool("INVENTORY_PRO_AUTO_PROVISION_USERS", True)
    INVENTORY_PRO_DOCK_ENABLED = env_bool("INVENTORY_PRO_DOCK_ENABLED", True)
    INVENTORY_PRO_DEFAULT_ROLE_NAME = env_str("INVENTORY_PRO_DEFAULT_ROLE_NAME", "user")
    INVENTORY_PRO_SHARED_SECRET = env_str("INVENTORY_PRO_SHARED_SECRET", "")

    METRICS_SNAPSHOT_INTERVAL_SECONDS = max(5, env_int("METRICS_SNAPSHOT_INTERVAL_SECONDS", 30))
    METRICS_RETENTION_DAYS = max(1, env_int("METRICS_RETENTION_DAYS", 7))
    DOCKER_ENABLED = env_bool("DOCKER_ENABLED", True)
    RATE_LIMIT_MONITORING = env_str("RATE_LIMIT_MONITORING", "60/min")
    MONITORING_CACHE_TTL_SECONDS = max(1, env_int("MONITORING_CACHE_TTL_SECONDS", 3))

    MAX_CONTENT_LENGTH = env_int("MAX_CONTENT_LENGTH", 1024 * 1024 * 1024)


class TestingConfig(Config):
    TESTING = True


AppConfig = dict[str, Any] | type[Config]
