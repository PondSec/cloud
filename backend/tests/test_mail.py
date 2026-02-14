from __future__ import annotations

from app.mail.service import _parse_flags_and_meta, _parse_seq_from_meta, _parse_status_response


def test_mail_account_create_list_context_delete(client):
    login = client.post("/auth/login", json={"username": "alice", "password": "alicepass"})
    assert login.status_code == 200
    token = login.get_json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    empty_ctx = client.get("/mail/context", headers=headers)
    assert empty_ctx.status_code == 200
    assert empty_ctx.get_json()["mail"]["available"] is False
    assert empty_ctx.get_json()["mail"]["accounts_count"] == 0

    created = client.post(
        "/mail/accounts",
        headers=headers,
        json={
            "label": "Work",
            "email_address": "alice@example.com",
            "imap_host": "imap.example.com",
            "imap_port": 993,
            "imap_security": "ssl",
            "imap_username": "alice@example.com",
            "imap_password": "secret",
            "smtp_host": "smtp.example.com",
            "smtp_port": 465,
            "smtp_security": "ssl",
            "smtp_username": "alice@example.com",
            "smtp_password": "secret",
        },
    )
    assert created.status_code == 201
    item = created.get_json()["item"]
    assert item["email_address"] == "alice@example.com"
    assert "imap_password" not in item
    assert "smtp_password" not in item

    ctx = client.get("/mail/context", headers=headers)
    assert ctx.status_code == 200
    assert ctx.get_json()["mail"]["available"] is True
    assert ctx.get_json()["mail"]["accounts_count"] == 1

    listed = client.get("/mail/accounts", headers=headers)
    assert listed.status_code == 200
    items = listed.get_json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == item["id"]

    deleted = client.delete(f"/mail/accounts/{item['id']}", headers=headers)
    assert deleted.status_code == 200

    ctx_after = client.get("/mail/context", headers=headers)
    assert ctx_after.status_code == 200
    assert ctx_after.get_json()["mail"]["available"] is False
    assert ctx_after.get_json()["mail"]["accounts_count"] == 0


def test_mail_parse_status_response():
    messages, unseen = _parse_status_response([b'"INBOX" (MESSAGES 7674 UNSEEN 2)'])
    assert messages == 7674
    assert unseen == 2


def test_mail_parse_flags_and_meta():
    meta = b'1 (UID 8256 RFC822.SIZE 12345 FLAGS (\\Seen) BODY[HEADER.FIELDS (SUBJECT FROM DATE)] {342}'
    uid, seen, size = _parse_flags_and_meta(meta)
    assert uid == "8256"
    assert seen is True
    assert size == 12345


def test_mail_parse_seq_from_meta():
    seq = _parse_seq_from_meta(b"123 (UID 456 FLAGS (\\\\Seen))")
    assert seq == "123"
