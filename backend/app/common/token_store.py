from __future__ import annotations

import time
from threading import Lock


class UsedRefreshTokenStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._used: dict[str, int] = {}

    def _cleanup(self) -> None:
        now = int(time.time())
        expired = [jti for jti, exp in self._used.items() if exp <= now]
        for jti in expired:
            self._used.pop(jti, None)

    def was_used(self, jti: str) -> bool:
        with self._lock:
            self._cleanup()
            return jti in self._used

    def mark_used(self, jti: str, exp: int) -> None:
        with self._lock:
            self._cleanup()
            self._used[jti] = exp


used_refresh_tokens = UsedRefreshTokenStore()
