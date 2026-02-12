from __future__ import annotations

import io
from urllib.parse import urlparse


def _access_token(client) -> str:
    login = client.post("/auth/login", json={"username": "alice", "password": "alicepass"})
    assert login.status_code == 200
    return login.get_json()["access_token"]


def test_onlyoffice_session_and_signed_file_endpoint(client):
    token = _access_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    upload = client.post(
        "/files/upload",
        data={"file": (io.BytesIO(b"office-content"), "report.docx")},
        headers=headers,
        content_type="multipart/form-data",
    )
    assert upload.status_code == 201
    file_id = upload.get_json()["item"]["id"]

    session = client.post("/office/session", json={"file_id": file_id}, headers=headers)
    assert session.status_code == 200
    payload = session.get_json()
    assert payload["document_server_url"]
    assert payload["config"]["document"]["fileType"] == "docx"

    file_url = payload["config"]["document"]["url"]
    parsed = urlparse(file_url)
    signed_file = client.get(f"{parsed.path}?{parsed.query}")
    assert signed_file.status_code == 200
    assert signed_file.data == b"office-content"
