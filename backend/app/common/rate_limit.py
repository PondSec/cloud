from __future__ import annotations

import threading
import time
from collections import defaultdict
from collections.abc import Callable


class LoginRateLimiter:
    def __init__(self) -> None:
        self._attempts: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def is_blocked(self, key: str, window_seconds: int, max_attempts: int) -> bool:
        now = time.time()
        with self._lock:
            recent = [value for value in self._attempts[key] if now - value <= window_seconds]
            self._attempts[key] = recent
            return len(recent) >= max_attempts

    def add_failure(self, key: str) -> None:
        with self._lock:
            self._attempts[key].append(time.time())

    def clear(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)


login_rate_limiter = LoginRateLimiter()


class SlidingWindowRateLimiter:
    def __init__(self) -> None:
        self._attempts: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def allow(self, key: str, max_attempts: int, window_seconds: int) -> bool:
        now = time.time()
        with self._lock:
            recent = [value for value in self._attempts[key] if now - value <= window_seconds]
            if len(recent) >= max_attempts:
                self._attempts[key] = recent
                return False
            recent.append(now)
            self._attempts[key] = recent
            return True


def parse_rate_limit(spec: str, default_attempts: int = 60, default_window: int = 60) -> tuple[int, int]:
    cleaned = (spec or "").strip().lower()
    if not cleaned:
        return default_attempts, default_window

    if "/" in cleaned:
        raw_attempts, raw_window = cleaned.split("/", 1)
        try:
            attempts = max(1, int(raw_attempts.strip()))
        except ValueError:
            return default_attempts, default_window

        token = raw_window.strip()
        if token in {"min", "minute"}:
            return attempts, 60
        if token in {"hour", "hr"}:
            return attempts, 3600
        if token in {"sec", "second"}:
            return attempts, 1
        if token.endswith("s"):
            token = token[:-1]
        try:
            seconds = max(1, int(token))
            return attempts, seconds
        except ValueError:
            return default_attempts, default_window

    try:
        attempts = max(1, int(cleaned))
    except ValueError:
        return default_attempts, default_window
    return attempts, default_window


class TTLCache:
    def __init__(self) -> None:
        self._values: dict[str, tuple[float, object]] = {}
        self._lock = threading.Lock()

    def get_or_set(self, key: str, ttl_seconds: int, producer: Callable[[], object]) -> object:
        now = time.time()
        with self._lock:
            hit = self._values.get(key)
            if hit is not None:
                expires_at, value = hit
                if now <= expires_at:
                    return value
                self._values.pop(key, None)

        value = producer()

        with self._lock:
            self._values[key] = (now + max(1, ttl_seconds), value)
        return value

    def clear(self) -> None:
        with self._lock:
            self._values.clear()


monitoring_rate_limiter = SlidingWindowRateLimiter()
monitoring_cache = TTLCache()
