from __future__ import annotations

import hashlib
import mimetypes
import urllib.error
import urllib.request
from datetime import timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote

import jwt
from flask import Blueprint, current_app, jsonify, request, send_file
from flask_jwt_extended import jwt_required

from ..common.audit import audit
from ..common.errors import APIError
from ..common.rbac import can_manage_node, current_user, permission_required
from ..common.storage import resolve_storage_path
from ..extensions import db
from ..models import FileNode, FileNodeType, PermissionCode, utc_now


office_bp = Blueprint("office", __name__, url_prefix="/office")

OFFICE_EXTENSIONS: dict[str, str] = {
    "doc": "word",
    "docx": "word",
    "odt": "word",
    "rtf": "word",
    "txt": "word",
    "pdf": "pdf",
    "xls": "cell",
    "xlsx": "cell",
    "ods": "cell",
    "csv": "cell",
    "ppt": "slide",
    "pptx": "slide",
    "odp": "slide",
}

NON_EDITABLE_EXTENSIONS = {"pdf"}


def _get_node(file_id: int) -> FileNode:
    node = db.session.get(FileNode, file_id)
    if node is None:
        raise APIError(404, "FILE_NOT_FOUND", "File not found.")
    if node.type != FileNodeType.FILE:
        raise APIError(400, "NOT_A_FILE", "Only files can be opened in Office.")
    return node


def _file_extension(name: str) -> str:
    return Path(name).suffix.lower().lstrip(".")


def _issue_signed_token(scope: str, file_id: int) -> str:
    now = utc_now()
    ttl_seconds = int(current_app.config["ONLYOFFICE_TOKEN_TTL_SECONDS"])
    payload = {
        "scope": scope,
        "file_id": file_id,
        "iat": now,
        "exp": now + timedelta(seconds=max(60, ttl_seconds)),
    }
    secret = current_app.config["ONLYOFFICE_TOKEN_SECRET"]
    return jwt.encode(payload, secret, algorithm="HS256")


def _verify_signed_token(token: str | None, expected_scope: str, file_id: int) -> None:
    if not token:
        raise APIError(401, "INVALID_TOKEN", "Missing Office token.")
    secret = current_app.config["ONLYOFFICE_TOKEN_SECRET"]
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError as error:
        raise APIError(401, "INVALID_TOKEN", "Invalid or expired Office token.") from error

    if payload.get("scope") != expected_scope or int(payload.get("file_id", -1)) != file_id:
        raise APIError(401, "INVALID_TOKEN", "Office token scope mismatch.")


def _office_config_token(config: dict[str, Any]) -> str | None:
    secret = (current_app.config.get("ONLYOFFICE_JWT_SECRET") or "").strip()
    if not secret:
        return None
    return jwt.encode(config, secret, algorithm="HS256")


def _public_backend_base() -> str:
    return str(current_app.config["ONLYOFFICE_PUBLIC_BACKEND_URL"]).rstrip("/")


def _document_server_base() -> str:
    return str(current_app.config["ONLYOFFICE_DOCUMENT_SERVER_URL"]).rstrip("/")

def _document_server_public_base() -> str:
    return str(current_app.config.get("ONLYOFFICE_PUBLIC_DOCUMENT_SERVER_URL") or _document_server_base()).rstrip("/")


def _document_server_script_url() -> str:
    return f"{_document_server_base()}/web-apps/apps/api/documents/api.js"


def _ensure_document_server_reachable() -> None:
    if current_app.testing:
        return

    script_url = _document_server_script_url()
    request_obj = urllib.request.Request(script_url, method="GET")
    try:
        with urllib.request.urlopen(request_obj, timeout=4) as response:
            if response.status < 200 or response.status >= 300:
                raise APIError(
                    503,
                    "DOCUMENT_SERVER_UNREACHABLE",
                    f"OnlyOffice Document Server is not reachable at {script_url}.",
                )
            content_type = (response.headers.get("Content-Type") or "").lower()
            if "javascript" not in content_type and "application/x-javascript" not in content_type:
                raise APIError(
                    503,
                    "DOCUMENT_SERVER_UNREACHABLE",
                    f"OnlyOffice script endpoint is invalid at {script_url}.",
                )
            response.read(1)
    except APIError:
        raise
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise APIError(
            503,
            "DOCUMENT_SERVER_UNREACHABLE",
            f"OnlyOffice Document Server is not reachable at {script_url}.",
        ) from error


def _office_document_key(node: FileNode) -> str:
    updated = int(node.updated_at.timestamp()) if node.updated_at else 0
    material = f"{node.id}:{node.size}:{updated}:{node.name}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:40]


def _write_office_file_data(node: FileNode, data: bytes) -> None:
    if not node.storage_path:
        raise APIError(404, "FILE_MISSING", "Storage path is missing.")

    owner = node.owner
    if owner is None:
        raise APIError(404, "OWNER_NOT_FOUND", "Owner not found.")

    old_size = int(node.size or 0)
    new_size = len(data)
    delta = new_size - old_size

    if delta > 0 and owner.bytes_used + delta > owner.bytes_limit:
        raise APIError(413, "QUOTA_EXCEEDED", "Quota exceeded while saving Office document.")

    storage_root = Path(current_app.config["STORAGE_ROOT"]).resolve()
    abs_path = resolve_storage_path(storage_root, node.storage_path)
    abs_path.parent.mkdir(parents=True, exist_ok=True)

    with abs_path.open("wb") as output:
        output.write(data)

    owner.bytes_used = max(0, owner.bytes_used + delta)
    node.size = new_size
    guessed_mime, _ = mimetypes.guess_type(node.name)
    if guessed_mime:
        node.mime = guessed_mime


@office_bp.post("/session")
@jwt_required()
@permission_required(PermissionCode.OFFICE_USE)
def create_session():
    if not current_app.config["ONLYOFFICE_ENABLED"]:
        raise APIError(503, "ONLYOFFICE_DISABLED", "OnlyOffice integration is disabled.")

    _ensure_document_server_reachable()

    user = current_user(required=True)
    assert user is not None

    payload = request.get_json(silent=True) or {}
    file_id = payload.get("file_id")
    if not isinstance(file_id, int):
        raise APIError(400, "INVALID_PARAMETER", "file_id must be an integer.")

    node = _get_node(file_id)
    if not can_manage_node(user, node, "read"):
        raise APIError(403, "FORBIDDEN", "You cannot read this file.")

    ext = _file_extension(node.name)
    document_type = OFFICE_EXTENSIONS.get(ext)
    if not document_type:
        raise APIError(400, "UNSUPPORTED_FILE_TYPE", f"File type '.{ext or 'unknown'}' is not supported by Office.")

    can_edit = can_manage_node(user, node, "write") and ext not in NON_EDITABLE_EXTENSIONS

    file_token = _issue_signed_token("file", node.id)
    callback_token = _issue_signed_token("callback", node.id)
    backend_base = _public_backend_base()
    file_url = f"{backend_base}/office/file/{node.id}?token={quote(file_token)}"
    callback_url = f"{backend_base}/office/callback/{node.id}?token={quote(callback_token)}"

    config: dict[str, Any] = {
        "document": {
            "fileType": ext,
            "title": node.name,
            "key": _office_document_key(node),
            "url": file_url,
            "permissions": {
                "edit": can_edit,
                "download": True,
                "print": True,
                "copy": True,
            },
        },
        "documentType": document_type,
        "editorConfig": {
            "mode": "edit" if can_edit else "view",
            "callbackUrl": callback_url,
            "lang": "en",
            "user": {
                "id": str(user.id),
                "name": user.username,
            },
        },
    }

    config_token = _office_config_token(config)
    if config_token:
        config["token"] = config_token

    return jsonify(
        {
            "file_id": node.id,
            "can_edit": can_edit,
            "document_server_url": _document_server_public_base(),
            "config": config,
        }
    )


@office_bp.get("/file/<int:file_id>")
def office_file(file_id: int):
    token = request.args.get("token")
    _verify_signed_token(token, expected_scope="file", file_id=file_id)

    node = _get_node(file_id)
    if not node.storage_path:
        raise APIError(404, "FILE_MISSING", "Storage path is missing.")

    storage_root = Path(current_app.config["STORAGE_ROOT"]).resolve()
    abs_path = resolve_storage_path(storage_root, node.storage_path)
    if not abs_path.exists():
        raise APIError(404, "FILE_MISSING", "File data not found on disk.")

    return send_file(abs_path, as_attachment=False, download_name=node.name, mimetype=node.mime)


@office_bp.post("/callback/<int:file_id>")
def office_callback(file_id: int):
    token = request.args.get("token")
    _verify_signed_token(token, expected_scope="callback", file_id=file_id)

    node = _get_node(file_id)
    payload = request.get_json(silent=True) or {}
    status = int(payload.get("status") or 0)

    # Status 2/6 indicates a saved version is available via payload.url.
    if status not in {2, 6}:
        return jsonify({"error": 0})

    source_url = payload.get("url")
    if not isinstance(source_url, str) or not source_url:
        current_app.logger.warning("OnlyOffice callback missing download URL for file_id=%s", file_id)
        return jsonify({"error": 1})

    try:
        with urllib.request.urlopen(source_url, timeout=45) as response:
            data = response.read()
    except (urllib.error.URLError, TimeoutError, OSError):
        current_app.logger.exception("OnlyOffice callback download failed for file_id=%s", file_id)
        return jsonify({"error": 1})

    if not data:
        current_app.logger.warning("OnlyOffice callback returned empty payload for file_id=%s", file_id)
        return jsonify({"error": 1})

    try:
        _write_office_file_data(node, data)
        audit(
            action="office.save",
            actor=None,
            target_type="file_node",
            target_id=str(node.id),
            details={"status": status, "size": len(data)},
        )
        db.session.commit()
    except APIError:
        db.session.rollback()
        raise
    except Exception:
        db.session.rollback()
        current_app.logger.exception("OnlyOffice callback save failed for file_id=%s", file_id)
        return jsonify({"error": 1})

    return jsonify({"error": 0})


@office_bp.get("/supported")
@jwt_required()
@permission_required(PermissionCode.OFFICE_USE)
def supported_extensions():
    return jsonify({"extensions": sorted(OFFICE_EXTENSIONS.keys())})
