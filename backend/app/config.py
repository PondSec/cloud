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


class Config:
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'cloud.db'}")
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-me")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=env_int("ACCESS_TOKEN_EXPIRES_MINUTES", 15))
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=env_int("REFRESH_TOKEN_EXPIRES_DAYS", 7))

    FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    STORAGE_ROOT = os.getenv("STORAGE_ROOT", str(BASE_DIR / "storage"))

    ALLOW_REGISTRATION = env_bool("ALLOW_REGISTRATION", False)
    DEFAULT_QUOTA_BYTES = env_int("DEFAULT_QUOTA_BYTES", 5 * 1024 * 1024 * 1024)
    MAX_UPLOAD_SIZE_BYTES = env_int("MAX_UPLOAD_SIZE_BYTES", 25 * 1024 * 1024)

    LOGIN_RATE_LIMIT_WINDOW_SECONDS = env_int("LOGIN_RATE_LIMIT_WINDOW_SECONDS", 300)
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS = env_int("LOGIN_RATE_LIMIT_MAX_ATTEMPTS", 5)

    MAX_CONTENT_LENGTH = env_int("MAX_CONTENT_LENGTH", 1024 * 1024 * 1024)


class TestingConfig(Config):
    TESTING = True


AppConfig = dict[str, Any] | type[Config]
