from __future__ import annotations

import threading
import time
from collections import defaultdict


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
