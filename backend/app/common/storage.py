from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from uuid import uuid4

from werkzeug.datastructures import FileStorage

from .errors import APIError


INVALID_NAME_PATTERN = re.compile(r"[\\/\x00]")


def validate_node_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise APIError(400, "INVALID_NAME", "Name cannot be empty.")
    if len(cleaned) > 255:
        raise APIError(400, "INVALID_NAME", "Name must be <= 255 characters.")
    if INVALID_NAME_PATTERN.search(cleaned):
        raise APIError(400, "INVALID_NAME", "Name contains invalid characters.")
    if cleaned in {".", ".."}:
        raise APIError(400, "INVALID_NAME", "Reserved name.")
    return cleaned


def _safe_resolve(storage_root: Path, relative_path: str) -> Path:
    root = storage_root.resolve()
    candidate = (root / relative_path).resolve()
    if os.path.commonpath([str(root), str(candidate)]) != str(root):
        raise APIError(400, "INVALID_PATH", "Invalid storage path.")
    return candidate


def save_upload(file_obj: FileStorage, storage_root: Path) -> tuple[str, int, str | None]:
    if not file_obj.filename:
        raise APIError(400, "INVALID_FILE", "File name is required.")

    ext = Path(file_obj.filename).suffix
    internal_name = f"{uuid4().hex}{ext}"
    bucket = uuid4().hex[:2]
    relative_path = f"{bucket}/{internal_name}"

    target_path = _safe_resolve(storage_root, relative_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    stream = file_obj.stream
    current = stream.tell()
    stream.seek(0, os.SEEK_END)
    size = stream.tell()
    stream.seek(current)

    with target_path.open("wb") as output:
        shutil.copyfileobj(stream, output)

    return relative_path, size, file_obj.mimetype


def delete_storage_path(storage_root: Path, relative_path: str | None) -> None:
    if not relative_path:
        return

    target_path = _safe_resolve(storage_root, relative_path)
    if target_path.exists():
        target_path.unlink()


def resolve_storage_path(storage_root: Path, relative_path: str) -> Path:
    return _safe_resolve(storage_root, relative_path)
