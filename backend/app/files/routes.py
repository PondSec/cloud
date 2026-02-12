from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

from flask import Blueprint, current_app, jsonify, request, send_file
from flask_jwt_extended import jwt_required
from sqlalchemy import or_

from ..common.audit import audit
from ..common.errors import APIError
from ..common.rbac import can_manage_node, current_user, scope_query_to_user
from ..common.storage import delete_storage_path, resolve_storage_path, save_upload, validate_node_name
from ..extensions import db
from ..models import AppSettings, FileNode, FileNodeType, User


files_bp = Blueprint("files", __name__, url_prefix="/files")


def _parse_int(value: str | None, field_name: str) -> int:
    try:
        return int(value or "")
    except ValueError as error:
        raise APIError(400, "INVALID_PARAMETER", f"{field_name} must be an integer.") from error


def _parse_nullable_int(value: str | int | None, field_name: str) -> int | None:
    if value in (None, "", "null"):
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as error:
        raise APIError(400, "INVALID_PARAMETER", f"{field_name} must be an integer or null.") from error


def _get_node(node_id: int) -> FileNode:
    node = db.session.get(FileNode, node_id)
    if node is None:
        raise APIError(404, "FILE_NOT_FOUND", "File or folder not found.")
    return node


def _assert_name_available(owner_id: int, parent_id: int | None, name: str, exclude_id: int | None = None) -> None:
    query = FileNode.query.filter_by(owner_id=owner_id, parent_id=parent_id, name=name)
    if exclude_id is not None:
        query = query.filter(FileNode.id != exclude_id)
    if query.first() is not None:
        raise APIError(409, "NAME_CONFLICT", "A file or folder with this name already exists.")


def _build_folder_tree(nodes: list[FileNode]) -> list[dict[str, Any]]:
    indexed: dict[int, dict[str, Any]] = {}
    roots: list[dict[str, Any]] = []

    for node in nodes:
        indexed[node.id] = {
            "id": node.id,
            "name": node.name,
            "parent_id": node.parent_id,
            "owner_id": node.owner_id,
            "children": [],
        }

    for node in nodes:
        mapped = indexed[node.id]
        if node.parent_id and node.parent_id in indexed:
            indexed[node.parent_id]["children"].append(mapped)
        else:
            roots.append(mapped)

    return roots


def _collect_descendants(root: FileNode) -> list[FileNode]:
    stack = [root]
    collected: list[FileNode] = []
    while stack:
        current = stack.pop()
        collected.append(current)
        stack.extend(current.children)
    return collected


def _is_descendant(node: FileNode, maybe_parent: FileNode | None) -> bool:
    current = maybe_parent
    while current is not None:
        if current.id == node.id:
            return True
        current = current.parent
    return False


@files_bp.get("/tree")
@jwt_required()
def tree():
    user = current_user(required=True)
    assert user is not None

    query = FileNode.query.filter(FileNode.type == FileNodeType.FOLDER)
    query = scope_query_to_user(query, user)
    folders = query.order_by(FileNode.name.asc()).all()

    return jsonify({"items": _build_folder_tree(folders)})


@files_bp.get("/list")
@jwt_required()
def list_files():
    user = current_user(required=True)
    assert user is not None

    parent_id = _parse_nullable_int(request.args.get("parent_id"), "parent_id")

    if parent_id is None:
        query = FileNode.query.filter(FileNode.parent_id.is_(None))
        query = scope_query_to_user(query, user)
        items = query.order_by(FileNode.type.asc(), FileNode.name.asc()).all()
        return jsonify({"items": [item.to_dict() for item in items]})

    parent = _get_node(parent_id)
    if parent.type != FileNodeType.FOLDER:
        raise APIError(400, "INVALID_PARENT", "Parent must be a folder.")
    if not can_manage_node(user, parent, "read"):
        raise APIError(403, "FORBIDDEN", "You cannot read this folder.")

    items = FileNode.query.filter(FileNode.parent_id == parent_id).order_by(FileNode.type.asc(), FileNode.name.asc()).all()

    return jsonify({"items": [item.to_dict() for item in items]})


@files_bp.post("/folder")
@jwt_required()
def create_folder():
    user = current_user(required=True)
    assert user is not None

    payload = request.get_json(silent=True) or {}
    name = validate_node_name(payload.get("name") or "")
    parent_id = _parse_nullable_int(payload.get("parent_id"), "parent_id")

    owner_id = user.id
    parent: FileNode | None = None

    if parent_id is not None:
        parent = _get_node(parent_id)
        if parent.type != FileNodeType.FOLDER:
            raise APIError(400, "INVALID_PARENT", "Parent must be a folder.")
        if not can_manage_node(user, parent, "write"):
            raise APIError(403, "FORBIDDEN", "You cannot write in this folder.")
        owner_id = parent.owner_id

    if owner_id != user.id and not user.has_permission("FILE_WRITE"):
        raise APIError(403, "FORBIDDEN", "You cannot create folders for another user.")

    _assert_name_available(owner_id=owner_id, parent_id=parent_id, name=name)

    node = FileNode(
        name=name,
        type=FileNodeType.FOLDER,
        owner_id=owner_id,
        parent_id=parent_id,
        size=0,
        mime="inode/directory",
        storage_path=None,
    )
    db.session.add(node)
    db.session.flush()
    audit(
        action="files.folder_create",
        actor=user,
        target_type="file_node",
        target_id=str(node.id),
        details={"name": name, "parent_id": parent_id},
    )
    db.session.commit()

    return jsonify({"item": node.to_dict()}), 201


@files_bp.post("/upload")
@jwt_required()
def upload_file():
    user = current_user(required=True)
    assert user is not None

    file_obj = request.files.get("file")
    if file_obj is None:
        raise APIError(400, "INVALID_FILE", "Multipart field 'file' is required.")

    parent_id = _parse_nullable_int(request.form.get("parent_id"), "parent_id")
    owner = user

    if parent_id is not None:
        parent = _get_node(parent_id)
        if parent.type != FileNodeType.FOLDER:
            raise APIError(400, "INVALID_PARENT", "Parent must be a folder.")
        if not can_manage_node(user, parent, "write"):
            raise APIError(403, "FORBIDDEN", "You cannot upload to this folder.")
        owner = parent.owner

    file_name = validate_node_name(Path(file_obj.filename or "").name)
    _assert_name_available(owner_id=owner.id, parent_id=parent_id, name=file_name)

    settings = AppSettings.singleton()

    file_obj.stream.seek(0, 2)
    file_size = file_obj.stream.tell()
    file_obj.stream.seek(0)

    if file_size <= 0:
        raise APIError(400, "INVALID_FILE", "File is empty.")

    if file_size > settings.max_upload_size:
        raise APIError(413, "UPLOAD_TOO_LARGE", "File exceeds max upload size.")

    if owner.bytes_used + file_size > owner.bytes_limit:
        raise APIError(413, "QUOTA_EXCEEDED", "User quota exceeded.")

    storage_root = Path(current_app.config["STORAGE_ROOT"]).resolve()
    relative_path, _, mime = save_upload(file_obj, storage_root)

    node = FileNode(
        parent_id=parent_id,
        owner_id=owner.id,
        name=file_name,
        type=FileNodeType.FILE,
        size=file_size,
        mime=mime,
        storage_path=relative_path,
    )
    owner.bytes_used += file_size
    db.session.add(node)
    db.session.flush()

    audit(
        action="files.upload",
        actor=user,
        target_type="file_node",
        target_id=str(node.id),
        details={"name": file_name, "size": file_size, "owner_id": owner.id},
    )
    db.session.commit()

    return jsonify({"item": node.to_dict()}), 201


@files_bp.get("/download/<int:node_id>")
@jwt_required()
def download_file(node_id: int):
    user = current_user(required=True)
    assert user is not None

    node = _get_node(node_id)
    if node.type != FileNodeType.FILE:
        raise APIError(400, "NOT_A_FILE", "Only files can be downloaded.")
    if not can_manage_node(user, node, "read"):
        raise APIError(403, "FORBIDDEN", "You cannot download this file.")
    if not node.storage_path:
        raise APIError(404, "FILE_MISSING", "Storage path is missing.")

    storage_root = Path(current_app.config["STORAGE_ROOT"]).resolve()
    abs_path = resolve_storage_path(storage_root, node.storage_path)
    if not abs_path.exists():
        raise APIError(404, "FILE_MISSING", "File data not found on disk.")

    return send_file(abs_path, as_attachment=True, download_name=node.name, mimetype=node.mime)


@files_bp.patch("/<int:node_id>")
@jwt_required()
def update_node(node_id: int):
    user = current_user(required=True)
    assert user is not None

    node = _get_node(node_id)
    if not can_manage_node(user, node, "write"):
        raise APIError(403, "FORBIDDEN", "You cannot modify this file.")

    payload = request.get_json(silent=True) or {}

    target_parent_id = node.parent_id
    if "parent_id" in payload:
        target_parent_id = _parse_nullable_int(payload.get("parent_id"), "parent_id")

    target_parent: FileNode | None = None
    if target_parent_id is not None:
        target_parent = _get_node(target_parent_id)
        if target_parent.type != FileNodeType.FOLDER:
            raise APIError(400, "INVALID_PARENT", "Parent must be a folder.")
        if not can_manage_node(user, target_parent, "write"):
            raise APIError(403, "FORBIDDEN", "You cannot move into this folder.")
        if node.owner_id != target_parent.owner_id:
            raise APIError(400, "INVALID_MOVE", "Cannot move items across different owners.")
        if node.type == FileNodeType.FOLDER and _is_descendant(node, target_parent):
            raise APIError(400, "INVALID_MOVE", "Cannot move a folder into itself.")

    target_name = node.name
    if "name" in payload:
        target_name = validate_node_name(payload.get("name") or "")

    _assert_name_available(node.owner_id, target_parent_id, target_name, exclude_id=node.id)

    node.name = target_name
    node.parent_id = target_parent_id

    audit(
        action="files.update",
        actor=user,
        target_type="file_node",
        target_id=str(node.id),
        details={"name": target_name, "parent_id": target_parent_id},
    )
    db.session.commit()

    return jsonify({"item": node.to_dict()})


@files_bp.delete("/<int:node_id>")
@jwt_required()
def delete_node(node_id: int):
    user = current_user(required=True)
    assert user is not None

    node = _get_node(node_id)
    if not can_manage_node(user, node, "delete"):
        raise APIError(403, "FORBIDDEN", "You cannot delete this file.")

    descendants = _collect_descendants(node)
    owner_size_map: dict[int, int] = defaultdict(int)

    storage_root = Path(current_app.config["STORAGE_ROOT"]).resolve()

    for item in descendants:
        if item.type == FileNodeType.FILE:
            owner_size_map[item.owner_id] += item.size
            delete_storage_path(storage_root, item.storage_path)

    for owner_id, size in owner_size_map.items():
        owner = db.session.get(User, owner_id)
        if owner is not None:
            owner.bytes_used = max(0, owner.bytes_used - size)

    db.session.delete(node)
    audit(
        action="files.delete",
        actor=user,
        target_type="file_node",
        target_id=str(node_id),
        details={"deleted_count": len(descendants)},
    )
    db.session.commit()

    return jsonify({"deleted_count": len(descendants)})


@files_bp.get("/recents")
@jwt_required()
def recents():
    user = current_user(required=True)
    assert user is not None

    limit = min(_parse_int(request.args.get("limit", "20"), "limit"), 100)
    query = scope_query_to_user(FileNode.query, user)
    items = query.order_by(FileNode.updated_at.desc()).limit(limit).all()

    return jsonify({"items": [item.to_dict() for item in items]})


@files_bp.get("/search")
@jwt_required()
def search():
    user = current_user(required=True)
    assert user is not None

    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"items": []})

    query = scope_query_to_user(FileNode.query, user)
    query = query.filter(FileNode.name.ilike(f"%{q}%"))
    items = query.order_by(FileNode.updated_at.desc()).limit(200).all()

    return jsonify({"items": [item.to_dict() for item in items]})
