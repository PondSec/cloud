from __future__ import annotations

import io

from app.extensions import db
from app.models import User


def _access_token(client) -> str:
    login = client.post("/auth/login", json={"username": "alice", "password": "alicepass"})
    assert login.status_code == 200
    return login.get_json()["access_token"]


def test_upload_and_quota_usage(client, app):
    token = _access_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    folder = client.post("/files/folder", json={"name": "docs", "parent_id": None}, headers=headers)
    assert folder.status_code == 201
    folder_id = folder.get_json()["item"]["id"]

    upload = client.post(
        "/files/upload",
        data={
            "parent_id": str(folder_id),
            "file": (io.BytesIO(b"hello cloud"), "note.txt"),
        },
        headers=headers,
        content_type="multipart/form-data",
    )
    assert upload.status_code == 201

    listing = client.get(f"/files/list?parent_id={folder_id}", headers=headers)
    assert listing.status_code == 200
    items = listing.get_json()["items"]
    assert len(items) == 1
    assert items[0]["name"] == "note.txt"

    with app.app_context():
        user = User.query.filter_by(username="alice").one()
        assert user.bytes_used > 0
        db.session.refresh(user)
