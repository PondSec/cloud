from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any


GENESIS_HASH = "0" * 64


def _normalize_value(value: Any) -> Any:
    if isinstance(value, datetime):
        # SQLite does not preserve tzinfo reliably; normalize to a UTC naive ISO string
        # so hashing and verification are stable across read/write cycles.
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value.isoformat()
    return value


def canonical_json(value: Any) -> str:
    """
    Canonical JSON encoding used for audit hash chaining.

    Rules:
    - Sort keys for deterministic output.
    - Use compact separators.
    - Ensure ASCII for stable byte-level hashing across environments.
    - Datetimes are converted to ISO-8601 strings.
    """

    def default(obj: Any) -> Any:
        return _normalize_value(obj)

    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        default=default,
    )


def compute_event_hash(prev_hash: str, payload: dict[str, Any]) -> str:
    normalized_prev = (prev_hash or GENESIS_HASH).strip()
    encoded_payload = canonical_json(payload)
    material = f"{normalized_prev}\n{encoded_payload}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()
