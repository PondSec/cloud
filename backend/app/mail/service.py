from __future__ import annotations

import email
import imaplib
import re
import smtplib
from dataclasses import dataclass
from email.header import decode_header, make_header
from email.message import EmailMessage, Message
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from typing import Any

from ..common.errors import APIError
from ..models import MailAccount
from .crypto import decrypt_secret


SUPPORTED_SECURITY = {"ssl", "starttls", "none"}


def _decode_mime_words(value: str) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def _parse_email_date(value: str) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
        return dt.isoformat()
    except Exception:
        return None


def _ensure_port(value: Any, *, field: str) -> int:
    try:
        port = int(value)
    except (TypeError, ValueError) as error:
        raise APIError(400, "INVALID_PARAMETER", f"{field} must be an integer.") from error
    if port <= 0 or port > 65535:
        raise APIError(400, "INVALID_PARAMETER", f"{field} must be between 1 and 65535.")
    return port


def _normalize_security(value: Any, *, field: str) -> str:
    cleaned = str(value or "").strip().lower()
    if cleaned not in SUPPORTED_SECURITY:
        raise APIError(400, "INVALID_PARAMETER", f"{field} must be one of: ssl, starttls, none.")
    return cleaned


def _imap_timeout_seconds() -> float:
    # Keep requests responsive even if mail servers are slow/unreachable.
    return 10.0


def _smtp_timeout_seconds() -> float:
    return 10.0


def _imap_quote(value: str) -> str:
    """Quote IMAP string arguments (e.g. mailbox names with spaces)."""

    cleaned = (value or "").strip()
    escaped = cleaned.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def connect_imap(account: MailAccount) -> imaplib.IMAP4:
    host = (account.imap_host or "").strip()
    if not host:
        raise APIError(400, "INVALID_ACCOUNT", "IMAP host is missing.")

    security = (account.imap_security or "ssl").strip().lower()
    if security not in SUPPORTED_SECURITY:
        security = "ssl"

    port = int(account.imap_port or 0) or (993 if security == "ssl" else 143)
    port = _ensure_port(port, field="imap_port")

    username = (account.imap_username or "").strip()
    try:
        password = decrypt_secret(account.imap_password_ciphertext or "")
    except ValueError as error:
        raise APIError(500, "MAIL_CREDENTIALS_INVALID", "IMAP credential decryption failed.", {"reason": str(error)}) from error
    if not username or not password:
        raise APIError(400, "INVALID_ACCOUNT", "IMAP credentials are missing.")

    try:
        if security == "ssl":
            client = imaplib.IMAP4_SSL(host, port, timeout=_imap_timeout_seconds())
        else:
            client = imaplib.IMAP4(host, port, timeout=_imap_timeout_seconds())
            if security == "starttls":
                client.starttls()
        client.login(username, password)
        return client
    except (imaplib.IMAP4.error, OSError, TimeoutError) as error:
        raise APIError(502, "MAIL_IMAP_FAILED", "IMAP connection/login failed.", {"reason": str(error)}) from error


def connect_smtp(account: MailAccount) -> smtplib.SMTP:
    host = (account.smtp_host or "").strip()
    if not host:
        raise APIError(400, "INVALID_ACCOUNT", "SMTP host is missing.")

    security = (account.smtp_security or "ssl").strip().lower()
    if security not in SUPPORTED_SECURITY:
        security = "ssl"

    port = int(account.smtp_port or 0) or (465 if security == "ssl" else 587)
    port = _ensure_port(port, field="smtp_port")

    username = (account.smtp_username or "").strip() or (account.imap_username or "").strip()
    try:
        password = decrypt_secret(account.smtp_password_ciphertext or "") or decrypt_secret(account.imap_password_ciphertext or "")
    except ValueError as error:
        raise APIError(500, "MAIL_CREDENTIALS_INVALID", "SMTP credential decryption failed.", {"reason": str(error)}) from error
    if not username or not password:
        raise APIError(400, "INVALID_ACCOUNT", "SMTP credentials are missing.")

    try:
        if security == "ssl":
            client: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=_smtp_timeout_seconds())
        else:
            client = smtplib.SMTP(host, port, timeout=_smtp_timeout_seconds())
            client.ehlo()
            if security == "starttls":
                client.starttls()
                client.ehlo()
        client.login(username, password)
        return client
    except (smtplib.SMTPException, OSError, TimeoutError) as error:
        raise APIError(502, "MAIL_SMTP_FAILED", "SMTP connection/login failed.", {"reason": str(error)}) from error


def _select_mailbox(client: imaplib.IMAP4, mailbox: str) -> int | None:
    mailbox_clean = (mailbox or "INBOX").strip() or "INBOX"
    mailbox_arg = _imap_quote(mailbox_clean)

    # Prefer SELECT (read-write) because some servers behave oddly on EXAMINE.
    typ, data = client.select(mailbox_arg, readonly=False)
    if typ != "OK":
        typ, data = client.select(mailbox_arg, readonly=True)
    if typ != "OK":
        raise APIError(404, "MAILBOX_NOT_FOUND", "Mailbox not found.")

    if data and data[0]:
        try:
            raw = data[0].decode("utf-8", errors="replace") if isinstance(data[0], (bytes, bytearray)) else str(data[0])
            return int(raw.strip() or "0")
        except Exception:
            return None
    return 0


def _split_id_list(raw: Any) -> list[bytes]:
    if not raw:
        return []
    if isinstance(raw, (bytes, bytearray)):
        return [item for item in bytes(raw).split() if item]
    if isinstance(raw, str):
        return [item.encode("utf-8") for item in raw.split() if item]
    return []


def _uid_search_all(client: imaplib.IMAP4) -> list[bytes]:
    typ, data = client.uid("search", None, "ALL")
    if typ != "OK" or not data or not data[0]:
        return []
    return _split_id_list(data[0])


def _seq_search_all(client: imaplib.IMAP4) -> list[bytes]:
    typ, data = client.search(None, "ALL")
    if typ != "OK" or not data or not data[0]:
        return []
    return _split_id_list(data[0])


def _parse_seq_from_meta(fetch_header: bytes) -> str | None:
    stripped = fetch_header.strip()
    match = re.match(rb"^(\d+)\s", stripped)
    if not match:
        return None
    try:
        return match.group(1).decode("utf-8", errors="replace")
    except Exception:
        return None


def _parse_mailbox_list_response(data: Any) -> list[str]:
    names: list[str] = []
    for raw in data or []:
        if not raw:
            continue
        try:
            line = raw.decode("utf-8", errors="replace") if isinstance(raw, (bytes, bytearray)) else str(raw)
            # Typical:
            #   '(\\HasNoChildren) "/" "INBOX"'
            #   '(\\HasNoChildren) "/" Sent Messages'
            # Keep everything after the delimiter token as mailbox name (may include spaces).
            parsed = re.match(r'^\((?P<flags>[^)]*)\)\s+(?P<delim>NIL|\"[^\"]*\")\s+(?P<name>.*)$', line)
            if parsed:
                name = (parsed.group("name") or "").strip()
            else:
                match = re.search(r'"([^"]+)"\s*$', line)
                name = match.group(1) if match else line
            name = name.strip()
            if name.startswith('"') and name.endswith('"') and len(name) >= 2:
                name = name[1:-1]
            name = name.strip()
            if not name:
                continue
            names.append(name)
        except Exception:
            continue

    # Dedupe while keeping stable order.
    seen: set[str] = set()
    unique: list[str] = []
    for name in names:
        if name in seen:
            continue
        seen.add(name)
        unique.append(name)
    return unique


def list_mailboxes(account: MailAccount) -> list[dict[str, Any]]:
    client = connect_imap(account)
    try:
        typ, data = client.list()
        if typ != "OK":
            raise APIError(502, "MAIL_IMAP_FAILED", "Failed to list mailboxes.")
        result = [{"name": name} for name in _parse_mailbox_list_response(data)]
        # Keep a stable, useful order.
        preferred = ["INBOX", "Sent", "Drafts", "Trash", "Junk", "Archive"]
        order = {name: i for i, name in enumerate(preferred)}
        result.sort(key=lambda item: (order.get(item["name"], 999), item["name"].lower()))
        return result
    finally:
        try:
            client.logout()
        except Exception:
            pass


def _parse_status_response(data: Any) -> tuple[int | None, int | None]:
    if not data:
        return None, None
    first = data[0] if isinstance(data, list) and data else data
    if not first:
        return None, None
    line = first.decode("utf-8", errors="replace") if isinstance(first, (bytes, bytearray)) else str(first)
    messages_match = re.search(r"\bMESSAGES\s+(\d+)\b", line, flags=re.IGNORECASE)
    unseen_match = re.search(r"\bUNSEEN\s+(\d+)\b", line, flags=re.IGNORECASE)
    messages = int(messages_match.group(1)) if messages_match else None
    unseen = int(unseen_match.group(1)) if unseen_match else None
    return messages, unseen


def list_mailboxes_with_status(account: MailAccount) -> list[dict[str, Any]]:
    client = connect_imap(account)
    try:
        typ, data = client.list()
        if typ != "OK":
            raise APIError(502, "MAIL_IMAP_FAILED", "Failed to list mailboxes.")

        names = _parse_mailbox_list_response(data)
        result: list[dict[str, Any]] = []
        for name in names:
            try:
                typ, status_data = client.status(_imap_quote(name), "(MESSAGES UNSEEN)")
                if typ != "OK":
                    result.append({"name": name, "messages": None, "unseen": None})
                    continue
                messages, unseen = _parse_status_response(status_data)
                result.append({"name": name, "messages": messages, "unseen": unseen})
            except Exception:
                result.append({"name": name, "messages": None, "unseen": None})

        preferred = ["INBOX", "Sent", "Drafts", "Trash", "Junk", "Archive"]
        order = {box: i for i, box in enumerate(preferred)}
        result.sort(key=lambda item: (order.get(item["name"], 999), item["name"].lower()))
        return result
    finally:
        try:
            client.logout()
        except Exception:
            pass


@dataclass(frozen=True)
class MailMessageSummary:
    uid: str
    subject: str
    from_name: str
    from_email: str
    date: str | None
    seen: bool
    size: int | None


def _parse_flags_and_meta(fetch_header: bytes) -> tuple[str | None, bool, int | None]:
    text = fetch_header.decode("utf-8", errors="replace")
    uid_match = re.search(r"\bUID\s+(\d+)\b", text, flags=re.IGNORECASE)
    flags_match = re.search(r"\bFLAGS\s+\(([^)]*)\)", text, flags=re.IGNORECASE)
    size_match = re.search(r"\bRFC822\.SIZE\s+(\d+)\b", text, flags=re.IGNORECASE)
    uid = uid_match.group(1) if uid_match else None
    flags_text = flags_match.group(1) if flags_match else ""
    flags = set(flags_text.split())
    seen = "\\Seen" in flags
    size = int(size_match.group(1)) if size_match else None
    return uid, seen, size


def list_messages(
    account: MailAccount,
    *,
    mailbox: str = "INBOX",
    limit: int = 50,
    offset: int = 0,
) -> list[MailMessageSummary]:
    limit = max(1, min(200, int(limit)))
    offset = max(0, int(offset))

    client = connect_imap(account)
    try:
        _select_mailbox(client, mailbox)

        fetch_spec = "(UID BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE MESSAGE-ID)] FLAGS RFC822.SIZE)"

        uids = _uid_search_all(client)
        if uids:
            uids.reverse()  # newest first (approx.)
            page = uids[offset : offset + limit]
            if not page:
                return []

            uid_csv = b",".join(page)
            typ, fetch_data = client.uid("fetch", uid_csv, fetch_spec)
            if typ != "OK":
                raise APIError(502, "MAIL_IMAP_FAILED", "Failed to fetch message headers.")

            by_uid: dict[str, dict[str, Any]] = {}
            for part in fetch_data or []:
                if not isinstance(part, tuple):
                    continue
                meta, payload = part
                if not isinstance(meta, (bytes, bytearray)) or not isinstance(payload, (bytes, bytearray)):
                    continue
                uid, seen, size = _parse_flags_and_meta(bytes(meta))
                if not uid:
                    continue
                msg = email.message_from_bytes(bytes(payload))
                subject = _decode_mime_words(str(msg.get("Subject") or ""))
                from_raw = _decode_mime_words(str(msg.get("From") or ""))
                from_email = parseaddr(from_raw)[1] or ""
                from_name = parseaddr(from_raw)[0] or ""
                date_iso = _parse_email_date(str(msg.get("Date") or ""))
                by_uid[uid] = {
                    "uid": uid,
                    "subject": subject,
                    "from_name": from_name,
                    "from_email": from_email,
                    "date": date_iso,
                    "seen": bool(seen),
                    "size": size,
                }

            result: list[MailMessageSummary] = []
            for raw in page:
                uid_str = raw.decode("utf-8", errors="replace")
                item = by_uid.get(uid_str)
                if not item:
                    continue
                result.append(
                    MailMessageSummary(
                        uid=item["uid"],
                        subject=item["subject"],
                        from_name=item["from_name"],
                        from_email=item["from_email"],
                        date=item["date"],
                        seen=item["seen"],
                        size=item["size"],
                    )
                )
            return result

        # Fallback: Some servers behave badly with UID SEARCH.
        seqs = _seq_search_all(client)
        if not seqs:
            return []

        seqs.reverse()  # newest first (approx.)
        seq_page = seqs[offset : offset + limit]
        if not seq_page:
            return []

        seq_csv = b",".join(seq_page)
        typ, fetch_data = client.fetch(seq_csv, fetch_spec)
        if typ != "OK":
            raise APIError(502, "MAIL_IMAP_FAILED", "Failed to fetch message headers.")

        by_seq: dict[str, dict[str, Any]] = {}
        for part in fetch_data or []:
            if not isinstance(part, tuple):
                continue
            meta, payload = part
            if not isinstance(meta, (bytes, bytearray)) or not isinstance(payload, (bytes, bytearray)):
                continue
            seq = _parse_seq_from_meta(bytes(meta))
            uid, seen, size = _parse_flags_and_meta(bytes(meta))
            if not seq or not uid:
                continue
            msg = email.message_from_bytes(bytes(payload))
            subject = _decode_mime_words(str(msg.get("Subject") or ""))
            from_raw = _decode_mime_words(str(msg.get("From") or ""))
            from_email = parseaddr(from_raw)[1] or ""
            from_name = parseaddr(from_raw)[0] or ""
            date_iso = _parse_email_date(str(msg.get("Date") or ""))
            by_seq[seq] = {
                "uid": uid,
                "subject": subject,
                "from_name": from_name,
                "from_email": from_email,
                "date": date_iso,
                "seen": bool(seen),
                "size": size,
            }

        result: list[MailMessageSummary] = []
        for raw in seq_page:
            seq_str = raw.decode("utf-8", errors="replace")
            item = by_seq.get(seq_str)
            if not item:
                continue
            result.append(
                MailMessageSummary(
                    uid=item["uid"],
                    subject=item["subject"],
                    from_name=item["from_name"],
                    from_email=item["from_email"],
                    date=item["date"],
                    seen=item["seen"],
                    size=item["size"],
                )
            )
        return result
    finally:
        try:
            client.logout()
        except Exception:
            pass


def _extract_best_body(message: Message) -> tuple[str, str]:
    text_parts: list[str] = []
    html_parts: list[str] = []

    if message.is_multipart():
        for part in message.walk():
            if part.get_content_maintype() == "multipart":
                continue
            if part.get("Content-Disposition", "").lower().startswith("attachment"):
                continue
            content_type = (part.get_content_type() or "").lower()
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            charset = part.get_content_charset() or "utf-8"
            try:
                decoded = payload.decode(charset, errors="replace")
            except LookupError:
                decoded = payload.decode("utf-8", errors="replace")
            if content_type == "text/plain":
                text_parts.append(decoded)
            elif content_type == "text/html":
                html_parts.append(decoded)
    else:
        payload = message.get_payload(decode=True)
        if payload is not None:
            charset = message.get_content_charset() or "utf-8"
            try:
                decoded = payload.decode(charset, errors="replace")
            except LookupError:
                decoded = payload.decode("utf-8", errors="replace")
            if (message.get_content_type() or "").lower() == "text/html":
                html_parts.append(decoded)
            else:
                text_parts.append(decoded)

    return ("\n".join(text_parts).strip(), "\n".join(html_parts).strip())


def get_message(account: MailAccount, *, mailbox: str, uid: str) -> dict[str, Any]:
    mailbox = (mailbox or "INBOX").strip() or "INBOX"
    uid_clean = str(uid or "").strip()
    if not uid_clean.isdigit():
        raise APIError(400, "INVALID_PARAMETER", "uid must be a numeric IMAP UID.")

    client = connect_imap(account)
    try:
        _select_mailbox(client, mailbox)

        fetch_spec = "(UID BODY.PEEK[] FLAGS RFC822.SIZE)"
        typ, data = client.uid("fetch", uid_clean, fetch_spec)
        if typ != "OK" or not data:
            # Fallback: map UID to sequence number and FETCH by sequence.
            typ, search_data = client.search(None, "UID", uid_clean)
            if typ != "OK" or not search_data or not search_data[0]:
                raise APIError(404, "MAIL_NOT_FOUND", "Message not found.")
            seq_ids = _split_id_list(search_data[0])
            if not seq_ids:
                raise APIError(404, "MAIL_NOT_FOUND", "Message not found.")
            typ, data = client.fetch(seq_ids[0], fetch_spec)
            if typ != "OK" or not data:
                raise APIError(404, "MAIL_NOT_FOUND", "Message not found.")

        raw_message: bytes | None = None
        meta_bytes: bytes | None = None
        for part in data:
            if not isinstance(part, tuple):
                continue
            meta, payload = part
            if isinstance(meta, (bytes, bytearray)):
                meta_bytes = bytes(meta)
            if isinstance(payload, (bytes, bytearray)):
                raw_message = bytes(payload)
                break
        if raw_message is None:
            raise APIError(404, "MAIL_NOT_FOUND", "Message not found.")

        msg = email.message_from_bytes(raw_message)
        subject = _decode_mime_words(str(msg.get("Subject") or ""))
        from_raw = _decode_mime_words(str(msg.get("From") or ""))
        date_iso = _parse_email_date(str(msg.get("Date") or ""))

        to_list = [{"name": name or "", "email": addr or ""} for name, addr in getaddresses([str(msg.get("To") or "")])]
        cc_list = [{"name": name or "", "email": addr or ""} for name, addr in getaddresses([str(msg.get("Cc") or "")])]

        uid_meta, seen, size = _parse_flags_and_meta(meta_bytes or b"")
        text_body, html_body = _extract_best_body(msg)
        return {
            "uid": uid_meta or uid_clean,
            "mailbox": mailbox,
            "subject": subject,
            "from": {"name": parseaddr(from_raw)[0] or "", "email": parseaddr(from_raw)[1] or ""},
            "to": [entry for entry in to_list if entry["email"]],
            "cc": [entry for entry in cc_list if entry["email"]],
            "date": date_iso,
            "seen": bool(seen),
            "size": size,
            "body_text": text_body,
            "body_html": html_body,
        }
    finally:
        try:
            client.logout()
        except Exception:
            pass


def send_message(
    account: MailAccount,
    *,
    to: list[str],
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    subject: str,
    body_text: str,
) -> None:
    to_clean = [addr.strip() for addr in (to or []) if str(addr or "").strip()]
    cc_clean = [addr.strip() for addr in (cc or []) if str(addr or "").strip()]
    bcc_clean = [addr.strip() for addr in (bcc or []) if str(addr or "").strip()]
    if not to_clean:
        raise APIError(400, "INVALID_PARAMETER", "At least one 'to' recipient is required.")

    from_addr = (account.email_address or "").strip()
    if not from_addr or "@" not in from_addr:
        raise APIError(400, "INVALID_ACCOUNT", "Account email address is invalid.")

    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_clean)
    if cc_clean:
        msg["Cc"] = ", ".join(cc_clean)
    msg["Subject"] = (subject or "").strip()
    msg.set_content(body_text or "")

    client = connect_smtp(account)
    try:
        client.send_message(msg, from_addr=from_addr, to_addrs=to_clean + cc_clean + bcc_clean)
    except (smtplib.SMTPException, OSError, TimeoutError) as error:
        raise APIError(502, "MAIL_SEND_FAILED", "Sending email failed.", {"reason": str(error)}) from error
    finally:
        try:
            client.quit()
        except Exception:
            pass
