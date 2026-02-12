from __future__ import annotations

from datetime import timedelta, timezone
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_file
from flask_jwt_extended import jwt_required
from markupsafe import escape
from sqlalchemy import func

from ..common.audit import audit
from ..common.errors import APIError
from ..common.rbac import current_user, permission_required
from ..common.storage import resolve_storage_path
from ..extensions import db
from ..models import FileNode, FileNodeType, InternalShare, PermissionCode, ShareAccessLevel, ShareLink, User, utc_now


shares_bp = Blueprint("shares", __name__, url_prefix="/shares")
public_shares_bp = Blueprint("public_shares", __name__)


def _get_node(node_id: int) -> FileNode:
    node = db.session.get(FileNode, node_id)
    if node is None:
        raise APIError(404, "FILE_NOT_FOUND", "File or folder not found.")
    return node


def _ensure_owner_or_admin(user: User, node: FileNode) -> None:
    if node.owner_id != user.id and not user.is_admin:
        raise APIError(403, "FORBIDDEN", "Only the owner or admin can manage shares.")


def _parse_access(value: str | None) -> ShareAccessLevel:
    normalized = (value or "read").strip().lower()
    if normalized == ShareAccessLevel.READ.value:
        return ShareAccessLevel.READ
    if normalized == ShareAccessLevel.WRITE.value:
        return ShareAccessLevel.WRITE
    raise APIError(400, "INVALID_ACCESS", "Access must be 'read' or 'write'.")


def _is_descendant_or_self(node: FileNode, ancestor: FileNode) -> bool:
    cursor: FileNode | None = node
    while cursor is not None:
        if cursor.id == ancestor.id:
            return True
        cursor = cursor.parent
    return False


def _public_url_for_token(token: str) -> str:
    return f"{request.host_url.rstrip('/')}/public/shares/{token}"


def _share_link_payload(link: ShareLink) -> dict:
    payload = link.to_dict()
    payload["public_url"] = _public_url_for_token(link.token)
    payload["item"] = link.file.to_dict() if link.file else None
    return payload


def _validated_share_link(token: str) -> ShareLink:
    link = ShareLink.query.filter_by(token=token).one_or_none()
    if link is None:
        raise APIError(404, "SHARE_NOT_FOUND", "Share link not found.")
    expires_at = link.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < utc_now():
        raise APIError(410, "SHARE_EXPIRED", "This share link has expired.")
    return link


def _folder_share_html(token: str, root: FileNode, parent: FileNode, items: list[FileNode], link: ShareLink) -> str:
    rows: list[str] = []
    if parent.id != root.id and parent.parent_id is not None:
        rows.append(
            f'<li><a href="/public/shares/{escape(token)}?parent_id={parent.parent_id}">.. (Up)</a></li>'
        )

    for item in items:
        if item.type == FileNodeType.FOLDER:
            href = f"/public/shares/{escape(token)}?parent_id={item.id}"
        else:
            href = f"/public/shares/{escape(token)}/download/{item.id}"
        rows.append(f'<li><a href="{href}">{escape(item.name)}</a> <small>({escape(item.type.value)})</small></li>')

    expires_label = link.expires_at.isoformat() if link.expires_at else "never"
    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Shared Folder - {escape(root.name)}</title>
    <style>
      body {{ font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; margin: 2rem; background: #0b1220; color: #e2e8f0; }}
      .panel {{ max-width: 860px; margin: 0 auto; padding: 1.25rem; border: 1px solid #334155; border-radius: 14px; background: #0f172a; }}
      h1 {{ font-size: 1.15rem; margin: 0 0 .5rem 0; }}
      p {{ color: #94a3b8; margin: 0.25rem 0; }}
      ul {{ margin-top: 1rem; padding-left: 1.2rem; }}
      li {{ margin: 0.5rem 0; }}
      a {{ color: #67e8f9; text-decoration: none; }}
      a:hover {{ text-decoration: underline; }}
      small {{ color: #94a3b8; }}
    </style>
  </head>
  <body>
    <div class="panel">
      <h1>Shared Folder: {escape(root.name)}</h1>
      <p>Current folder: {escape(parent.name)}</p>
      <p>Link expires: {escape(expires_label)}</p>
      <ul>
        {''.join(rows) or '<li><small>Folder is empty.</small></li>'}
      </ul>
    </div>
  </body>
</html>
"""


@shares_bp.get("/internal")
@jwt_required()
@permission_required(PermissionCode.SHARE_INTERNAL_MANAGE)
def list_internal_shares():
    user = current_user(required=True)
    assert user is not None

    file_id_raw = request.args.get("file_id")
    if not file_id_raw:
        raise APIError(400, "INVALID_PARAMETER", "file_id is required.")
    try:
        file_id = int(file_id_raw)
    except ValueError as error:
        raise APIError(400, "INVALID_PARAMETER", "file_id must be an integer.") from error

    node = _get_node(file_id)
    _ensure_owner_or_admin(user, node)

    shares = (
        InternalShare.query.filter_by(file_id=node.id)
        .order_by(InternalShare.updated_at.desc(), InternalShare.id.desc())
        .all()
    )
    return jsonify({"items": [share.to_dict() for share in shares]})


@shares_bp.post("/internal")
@jwt_required()
@permission_required(PermissionCode.SHARE_INTERNAL_MANAGE)
def create_or_update_internal_share():
    actor = current_user(required=True)
    assert actor is not None

    payload = request.get_json(silent=True) or {}
    file_id = payload.get("file_id")
    username = (payload.get("username") or "").strip()

    if not isinstance(file_id, int):
        raise APIError(400, "INVALID_PARAMETER", "file_id must be an integer.")
    if len(username) < 3:
        raise APIError(400, "INVALID_PARAMETER", "username is required.")

    node = _get_node(file_id)
    _ensure_owner_or_admin(actor, node)

    target = User.query.filter(func.lower(User.username) == username.lower()).one_or_none()
    if target is None:
        raise APIError(404, "USER_NOT_FOUND", "User not found.")
    if target.id == node.owner_id:
        raise APIError(400, "INVALID_SHARE", "Owner already has full access.")

    access = _parse_access(payload.get("access"))

    share = InternalShare.query.filter_by(file_id=node.id, shared_with_user_id=target.id).one_or_none()
    created = False
    if share is None:
        share = InternalShare(file_id=node.id, shared_with_user_id=target.id, created_by_id=actor.id, access=access)
        created = True
    else:
        share.access = access

    db.session.add(share)
    db.session.flush()
    audit(
        action="shares.internal_upsert",
        actor=actor,
        target_type="file_node",
        target_id=str(node.id),
        details={
            "share_id": share.id,
            "shared_with_user_id": target.id,
            "access": share.access.value,
            "created": created,
        },
    )
    db.session.commit()

    return jsonify({"share": share.to_dict(), "created": created}), 201 if created else 200


@shares_bp.delete("/internal/<int:share_id>")
@jwt_required()
@permission_required(PermissionCode.SHARE_INTERNAL_MANAGE)
def delete_internal_share(share_id: int):
    actor = current_user(required=True)
    assert actor is not None

    share = db.session.get(InternalShare, share_id)
    if share is None:
        raise APIError(404, "SHARE_NOT_FOUND", "Internal share not found.")

    node = _get_node(share.file_id)
    _ensure_owner_or_admin(actor, node)

    db.session.delete(share)
    audit(
        action="shares.internal_delete",
        actor=actor,
        target_type="file_node",
        target_id=str(node.id),
        details={"share_id": share_id},
    )
    db.session.commit()
    return jsonify({"deleted": True})


@shares_bp.get("/shared-with-me")
@jwt_required()
@permission_required(PermissionCode.SHARE_VIEW_RECEIVED)
def shared_with_me():
    user = current_user(required=True)
    assert user is not None

    shares = (
        InternalShare.query.filter_by(shared_with_user_id=user.id)
        .order_by(InternalShare.updated_at.desc(), InternalShare.id.desc())
        .all()
    )
    items = [{"share": share.to_dict(), "item": share.file.to_dict()} for share in shares if share.file is not None]
    return jsonify({"items": items})


@shares_bp.get("/external")
@jwt_required()
@permission_required(PermissionCode.SHARE_EXTERNAL_MANAGE)
def list_external_links():
    actor = current_user(required=True)
    assert actor is not None

    file_id_raw = request.args.get("file_id")
    if not file_id_raw:
        raise APIError(400, "INVALID_PARAMETER", "file_id is required.")
    try:
        file_id = int(file_id_raw)
    except ValueError as error:
        raise APIError(400, "INVALID_PARAMETER", "file_id must be an integer.") from error

    node = _get_node(file_id)
    _ensure_owner_or_admin(actor, node)

    links = ShareLink.query.filter_by(file_id=node.id).order_by(ShareLink.created_at.desc(), ShareLink.id.desc()).all()
    return jsonify({"items": [_share_link_payload(link) for link in links]})


@shares_bp.post("/external")
@jwt_required()
@permission_required(PermissionCode.SHARE_EXTERNAL_MANAGE)
def create_external_link():
    actor = current_user(required=True)
    assert actor is not None

    payload = request.get_json(silent=True) or {}
    file_id = payload.get("file_id")
    if not isinstance(file_id, int):
        raise APIError(400, "INVALID_PARAMETER", "file_id must be an integer.")

    node = _get_node(file_id)
    _ensure_owner_or_admin(actor, node)

    expires_in_days = payload.get("expires_in_days")
    expires_at = None
    if expires_in_days not in (None, ""):
        try:
            days = int(expires_in_days)
        except (TypeError, ValueError) as error:
            raise APIError(400, "INVALID_PARAMETER", "expires_in_days must be an integer.") from error
        if days <= 0 or days > 3650:
            raise APIError(400, "INVALID_PARAMETER", "expires_in_days must be between 1 and 3650.")
        expires_at = utc_now() + timedelta(days=days)

    link = ShareLink(file_id=node.id, created_by_id=actor.id, expires_at=expires_at)
    db.session.add(link)
    db.session.flush()
    audit(
        action="shares.external_create",
        actor=actor,
        target_type="file_node",
        target_id=str(node.id),
        details={"link_id": link.id, "expires_at": link.expires_at.isoformat() if link.expires_at else None},
    )
    db.session.commit()

    return jsonify({"link": _share_link_payload(link)}), 201


@shares_bp.delete("/external/<int:link_id>")
@jwt_required()
@permission_required(PermissionCode.SHARE_EXTERNAL_MANAGE)
def delete_external_link(link_id: int):
    actor = current_user(required=True)
    assert actor is not None

    link = db.session.get(ShareLink, link_id)
    if link is None:
        raise APIError(404, "SHARE_NOT_FOUND", "External share link not found.")

    node = _get_node(link.file_id)
    _ensure_owner_or_admin(actor, node)

    db.session.delete(link)
    audit(
        action="shares.external_delete",
        actor=actor,
        target_type="file_node",
        target_id=str(node.id),
        details={"link_id": link_id},
    )
    db.session.commit()
    return jsonify({"deleted": True})


@public_shares_bp.get("/public/shares/<string:token>")
def public_share_root(token: str):
    link = _validated_share_link(token)
    node = link.file
    if node is None:
        raise APIError(404, "FILE_NOT_FOUND", "Shared item no longer exists.")

    if node.type == FileNodeType.FILE:
        if not node.storage_path:
            raise APIError(404, "FILE_MISSING", "File data is missing.")
        storage_root = Path(current_app.config["STORAGE_ROOT"]).resolve()
        abs_path = resolve_storage_path(storage_root, node.storage_path)
        if not abs_path.exists():
            raise APIError(404, "FILE_MISSING", "File data not found on disk.")
        return send_file(abs_path, as_attachment=True, download_name=node.name, mimetype=node.mime)

    parent_id_raw = request.args.get("parent_id")
    if parent_id_raw:
        try:
            parent_id = int(parent_id_raw)
        except ValueError as error:
            raise APIError(400, "INVALID_PARAMETER", "parent_id must be an integer.") from error
    else:
        parent_id = node.id

    parent = _get_node(parent_id)
    if parent.type != FileNodeType.FOLDER:
        raise APIError(400, "INVALID_PARENT", "parent_id must reference a folder.")
    if not _is_descendant_or_self(parent, node):
        raise APIError(403, "FORBIDDEN", "Requested folder is outside this share.")

    children = FileNode.query.filter(FileNode.parent_id == parent.id).order_by(FileNode.type.asc(), FileNode.name.asc()).all()
    wants_json = request.args.get("format") == "json" or "application/json" in request.headers.get("Accept", "")
    if not wants_json:
        return _folder_share_html(token=token, root=node, parent=parent, items=children, link=link)

    return jsonify(
        {
            "share": _share_link_payload(link),
            "root": node.to_dict(),
            "parent": parent.to_dict(),
            "items": [child.to_dict() for child in children],
        }
    )


@public_shares_bp.get("/public/shares/<string:token>/download/<int:node_id>")
def public_share_download(token: str, node_id: int):
    link = _validated_share_link(token)
    root = link.file
    if root is None:
        raise APIError(404, "FILE_NOT_FOUND", "Shared item no longer exists.")

    node = _get_node(node_id)
    if node.type != FileNodeType.FILE:
        raise APIError(400, "NOT_A_FILE", "Requested item is not a file.")
    if not _is_descendant_or_self(node, root):
        raise APIError(403, "FORBIDDEN", "Requested file is outside this share.")
    if not node.storage_path:
        raise APIError(404, "FILE_MISSING", "File data is missing.")

    storage_root = Path(current_app.config["STORAGE_ROOT"]).resolve()
    abs_path = resolve_storage_path(storage_root, node.storage_path)
    if not abs_path.exists():
        raise APIError(404, "FILE_MISSING", "File data not found on disk.")

    return send_file(abs_path, as_attachment=True, download_name=node.name, mimetype=node.mime)
