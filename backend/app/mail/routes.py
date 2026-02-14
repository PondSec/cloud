from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from ..common.audit import audit
from ..common.errors import APIError
from ..common.rbac import current_user
from ..extensions import db
from ..models import MailAccount
from sqlalchemy.exc import IntegrityError
from .crypto import encrypt_secret
from .service import (
    connect_imap,
    connect_smtp,
    get_message,
    list_mailboxes,
    list_mailboxes_with_status,
    list_messages,
    send_message,
)


mail_bp = Blueprint("mail", __name__, url_prefix="/mail")


def _payload_dict() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    if payload is None:
        return {}
    if not isinstance(payload, dict):
        raise APIError(400, "INVALID_PAYLOAD", "JSON object expected.")
    return payload


def _get_account(account_id: int, user_id: int) -> MailAccount:
    account = db.session.get(MailAccount, account_id)
    if account is None or account.user_id != user_id:
        raise APIError(404, "MAIL_ACCOUNT_NOT_FOUND", "Mail account not found.")
    return account


def _parse_int(value: Any, *, field: str, default: int | None = None) -> int:
    if value in (None, ""):
        if default is None:
            raise APIError(400, "INVALID_PARAMETER", f"{field} is required.")
        return default
    try:
        numeric = int(value)
    except (TypeError, ValueError) as error:
        raise APIError(400, "INVALID_PARAMETER", f"{field} must be an integer.") from error
    return numeric


@mail_bp.get("/context")
@jwt_required()
def context():
    user = current_user(required=True)
    assert user is not None
    count = MailAccount.query.filter_by(user_id=user.id, is_active=True).count()
    return jsonify({"mail": {"available": count > 0, "accounts_count": count}})


@mail_bp.get("/accounts")
@jwt_required()
def list_accounts():
    user = current_user(required=True)
    assert user is not None
    accounts = MailAccount.query.filter_by(user_id=user.id).order_by(MailAccount.updated_at.desc()).all()
    return jsonify({"items": [account.to_dict() for account in accounts]})


@mail_bp.post("/accounts")
@jwt_required()
def create_account():
    user = current_user(required=True)
    assert user is not None

    payload = _payload_dict()
    label = str(payload.get("label") or "").strip()
    email_address = str(payload.get("email_address") or "").strip()
    if not email_address or "@" not in email_address:
        raise APIError(400, "INVALID_PARAMETER", "email_address must be a valid email address.")

    imap_host = str(payload.get("imap_host") or "").strip()
    imap_port = _parse_int(payload.get("imap_port"), field="imap_port", default=993)
    imap_security = str(payload.get("imap_security") or "ssl").strip().lower()
    imap_username = str(payload.get("imap_username") or "").strip()
    imap_password = str(payload.get("imap_password") or "").strip()

    smtp_host = str(payload.get("smtp_host") or "").strip()
    smtp_port = _parse_int(payload.get("smtp_port"), field="smtp_port", default=465)
    smtp_security = str(payload.get("smtp_security") or "ssl").strip().lower()
    smtp_username = str(payload.get("smtp_username") or imap_username).strip()
    smtp_password = str(payload.get("smtp_password") or imap_password).strip()

    allowed_security = {"ssl", "starttls", "none"}
    if imap_security not in allowed_security:
        raise APIError(400, "INVALID_PARAMETER", "imap_security must be one of: ssl, starttls, none.")
    if smtp_security not in allowed_security:
        raise APIError(400, "INVALID_PARAMETER", "smtp_security must be one of: ssl, starttls, none.")

    if not imap_host:
        raise APIError(400, "INVALID_PARAMETER", "imap_host is required.")
    if not imap_username:
        raise APIError(400, "INVALID_PARAMETER", "imap_username is required.")
    if not imap_password:
        raise APIError(400, "INVALID_PARAMETER", "imap_password is required.")
    if not smtp_host:
        raise APIError(400, "INVALID_PARAMETER", "smtp_host is required.")
    if not smtp_username:
        raise APIError(400, "INVALID_PARAMETER", "smtp_username is required.")
    if not smtp_password:
        raise APIError(400, "INVALID_PARAMETER", "smtp_password is required.")

    if imap_port <= 0 or imap_port > 65535:
        raise APIError(400, "INVALID_PARAMETER", "imap_port must be between 1 and 65535.")
    if smtp_port <= 0 or smtp_port > 65535:
        raise APIError(400, "INVALID_PARAMETER", "smtp_port must be between 1 and 65535.")

    account = MailAccount(
        user_id=user.id,
        label=label,
        email_address=email_address,
        imap_host=imap_host,
        imap_port=int(imap_port),
        imap_security=imap_security,
        imap_username=imap_username,
        imap_password_ciphertext=encrypt_secret(imap_password),
        smtp_host=smtp_host,
        smtp_port=int(smtp_port),
        smtp_security=smtp_security,
        smtp_username=smtp_username,
        smtp_password_ciphertext=encrypt_secret(smtp_password),
        is_active=True,
    )
    db.session.add(account)
    db.session.flush()
    audit(
        action="mail.account_create",
        actor=user,
        target_type="mail_account",
        target_id=str(account.id),
        details={"email_address": email_address},
    )
    try:
        db.session.commit()
    except IntegrityError as error:
        db.session.rollback()
        raise APIError(409, "MAIL_ACCOUNT_EXISTS", "This email account already exists.") from error

    return jsonify({"item": account.to_dict()}), 201


@mail_bp.delete("/accounts/<int:account_id>")
@jwt_required()
def delete_account(account_id: int):
    user = current_user(required=True)
    assert user is not None

    account = _get_account(account_id, user.id)
    db.session.delete(account)
    audit(
        action="mail.account_delete",
        actor=user,
        target_type="mail_account",
        target_id=str(account.id),
        details={"email_address": account.email_address},
    )
    db.session.commit()
    return jsonify({"ok": True})


@mail_bp.post("/accounts/<int:account_id>/test")
@jwt_required()
def test_account(account_id: int):
    user = current_user(required=True)
    assert user is not None
    account = _get_account(account_id, user.id)

    imap_ok = False
    smtp_ok = False
    inbox_messages: int | None = None
    inbox_uid_count: int | None = None
    try:
        client = connect_imap(account)
        try:
            typ, data = client.select("INBOX", readonly=True)
            imap_ok = typ == "OK"
            if imap_ok and data and data[0]:
                try:
                    inbox_messages = int(data[0])
                except Exception:
                    inbox_messages = None
            if imap_ok:
                typ, search_data = client.uid("search", None, "ALL")
                if typ == "OK" and search_data and search_data[0]:
                    inbox_uid_count = len([uid for uid in search_data[0].split() if uid])
                else:
                    # Fallback: Some servers behave oddly with UID SEARCH.
                    typ, search_data = client.search(None, "ALL")
                    if typ == "OK" and search_data and search_data[0]:
                        inbox_uid_count = len([uid for uid in search_data[0].split() if uid])
                    else:
                        inbox_uid_count = 0
        finally:
            try:
                client.logout()
            except Exception:
                pass
    except APIError:
        imap_ok = False

    try:
        client = connect_smtp(account)
        try:
            smtp_ok = True
        finally:
            try:
                client.quit()
            except Exception:
                pass
    except APIError:
        smtp_ok = False

    return jsonify(
        {
            "imap_ok": imap_ok,
            "smtp_ok": smtp_ok,
            "ok": imap_ok and smtp_ok,
            "inbox_messages": inbox_messages,
            "inbox_uid_count": inbox_uid_count,
        }
    )


@mail_bp.get("/accounts/<int:account_id>/mailboxes")
@jwt_required()
def mailboxes(account_id: int):
    user = current_user(required=True)
    assert user is not None
    account = _get_account(account_id, user.id)
    return jsonify({"items": list_mailboxes(account)})


@mail_bp.get("/accounts/<int:account_id>/mailboxes/status")
@jwt_required()
def mailboxes_status(account_id: int):
    user = current_user(required=True)
    assert user is not None
    account = _get_account(account_id, user.id)
    return jsonify({"items": list_mailboxes_with_status(account)})


@mail_bp.get("/accounts/<int:account_id>/messages")
@jwt_required()
def messages(account_id: int):
    user = current_user(required=True)
    assert user is not None
    account = _get_account(account_id, user.id)

    mailbox = str(request.args.get("mailbox") or "INBOX").strip() or "INBOX"
    limit = _parse_int(request.args.get("limit"), field="limit", default=50)
    offset = _parse_int(request.args.get("offset"), field="offset", default=0)
    summaries = list_messages(account, mailbox=mailbox, limit=limit, offset=offset)
    return jsonify({"items": [summary.__dict__ for summary in summaries]})


@mail_bp.get("/accounts/<int:account_id>/messages/<uid>")
@jwt_required()
def message(account_id: int, uid: str):
    user = current_user(required=True)
    assert user is not None
    account = _get_account(account_id, user.id)

    mailbox = str(request.args.get("mailbox") or "INBOX").strip() or "INBOX"
    return jsonify({"item": get_message(account, mailbox=mailbox, uid=uid)})


@mail_bp.post("/accounts/<int:account_id>/send")
@jwt_required()
def send(account_id: int):
    user = current_user(required=True)
    assert user is not None
    account = _get_account(account_id, user.id)

    payload = _payload_dict()
    to_raw = payload.get("to") or []
    cc_raw = payload.get("cc") or []
    bcc_raw = payload.get("bcc") or []
    to_list = [str(item or "").strip() for item in (to_raw if isinstance(to_raw, list) else [to_raw])]
    cc_list = [str(item or "").strip() for item in (cc_raw if isinstance(cc_raw, list) else [cc_raw])]
    bcc_list = [str(item or "").strip() for item in (bcc_raw if isinstance(bcc_raw, list) else [bcc_raw])]
    subject = str(payload.get("subject") or "").strip()
    body_text = str(payload.get("body_text") or payload.get("body") or "").rstrip()

    send_message(account, to=to_list, cc=cc_list, bcc=bcc_list, subject=subject, body_text=body_text)
    audit(
        action="mail.send",
        actor=user,
        target_type="mail_account",
        target_id=str(account.id),
        details={"to_count": len([addr for addr in to_list if addr])},
    )
    db.session.commit()
    return jsonify({"ok": True})
