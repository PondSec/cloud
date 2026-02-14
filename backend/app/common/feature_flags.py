from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from flask import current_app


def load_feature_flags(path: str | None) -> dict[str, bool]:
    if not path:
        return {}

    candidate = Path(path)
    if not candidate.exists():
        return {}

    try:
        raw = json.loads(candidate.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}

    flags_obj: Any = raw.get("flags") if isinstance(raw, dict) else None
    if not isinstance(flags_obj, dict):
        return {}

    flags: dict[str, bool] = {}
    for key, value in flags_obj.items():
        if not isinstance(key, str):
            continue
        flags[key] = bool(value)
    return flags


def flag_enabled(name: str, *, default: bool = False) -> bool:
    flags = current_app.config.get("FEATURE_FLAGS") or {}
    if not isinstance(flags, dict):
        return default
    value = flags.get(name)
    if value is None:
        return default
    return bool(value)

