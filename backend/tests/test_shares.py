from __future__ import annotations

import io

from app.extensions import db
from app.models import Role, User


def _token(client, username: str, password: str) -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response.get_json()["access_token"]


def test_internal_share_read_then_write_access(client, app):
    with app.app_context():
        role = Role.query.filter_by(name="user").one()
        bob = User(username="bob", bytes_limit=10 * 1024 * 1024, bytes_used=0, is_active=True)
        bob.set_password("bobpass123")
        bob.roles.append(role)
        db.session.add(bob)
        db.session.commit()

    alice_token = _token(client, "alice", "alicepass")
    alice_headers = {"Authorization": f"Bearer {alice_token}"}

    folder = client.post("/files/folder", json={"name": "team", "parent_id": None}, headers=alice_headers)
    assert folder.status_code == 201
    folder_id = folder.get_json()["item"]["id"]

    upload = client.post(
        "/files/upload",
        data={
            "parent_id": str(folder_id),
            "file": (io.BytesIO(b"draft content"), "draft.txt"),
        },
        headers=alice_headers,
        content_type="multipart/form-data",
    )
    assert upload.status_code == 201
    file_id = upload.get_json()["item"]["id"]

    share_create = client.post(
        "/shares/internal",
        json={"file_id": folder_id, "username": "bob", "access": "read"},
        headers=alice_headers,
    )
    assert share_create.status_code == 201

    bob_token = _token(client, "bob", "bobpass123")
    bob_headers = {"Authorization": f"Bearer {bob_token}"}

    shared_with_me = client.get("/shares/shared-with-me", headers=bob_headers)
    assert shared_with_me.status_code == 200
    assert shared_with_me.get_json()["items"][0]["item"]["id"] == folder_id

    bob_listing = client.get(f"/files/list?parent_id={folder_id}", headers=bob_headers)
    assert bob_listing.status_code == 200
    listed = bob_listing.get_json()["items"]
    assert len(listed) == 1
    assert listed[0]["id"] == file_id

    bob_rename_denied = client.patch(f"/files/{file_id}", json={"name": "draft-2.txt"}, headers=bob_headers)
    assert bob_rename_denied.status_code == 403

    share_upgrade = client.post(
        "/shares/internal",
        json={"file_id": folder_id, "username": "bob", "access": "write"},
        headers=alice_headers,
    )
    assert share_upgrade.status_code == 200

    bob_rename_ok = client.patch(f"/files/{file_id}", json={"name": "draft-2.txt"}, headers=bob_headers)
    assert bob_rename_ok.status_code == 200


def test_external_share_link_download(client):
    alice_token = _token(client, "alice", "alicepass")
    alice_headers = {"Authorization": f"Bearer {alice_token}"}

    upload = client.post(
        "/files/upload",
        data={"file": (io.BytesIO(b"public data"), "public.txt")},
        headers=alice_headers,
        content_type="multipart/form-data",
    )
    assert upload.status_code == 201
    file_id = upload.get_json()["item"]["id"]

    created = client.post("/shares/external", json={"file_id": file_id, "expires_in_days": 7}, headers=alice_headers)
    assert created.status_code == 201
    token = created.get_json()["link"]["token"]

    public_download = client.get(f"/public/shares/{token}")
    assert public_download.status_code == 200
    assert public_download.data == b"public data"
