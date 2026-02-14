from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from flask import current_app


try:
    from cryptography.fernet import Fernet, InvalidToken  # type: ignore[import-not-found]

    _HAS_CRYPTO = True
except ImportError:  # pragma: no cover
    Fernet = None  # type: ignore[assignment]
    InvalidToken = Exception  # type: ignore[assignment]
    _HAS_CRYPTO = False


def _derive_fernet_key(secret: str) -> bytes:
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


@lru_cache(maxsize=1)
def _fernet() -> "Fernet | None":
    if not _HAS_CRYPTO:
        return None
    raw_secret = str(current_app.config.get("MAIL_CREDENTIALS_KEY") or current_app.config.get("JWT_SECRET_KEY") or "").strip()
    if not raw_secret:
        raw_secret = "dev-mail-secret-change-me-at-least-32-bytes"
    return Fernet(_derive_fernet_key(raw_secret))  # type: ignore[misc]


def encrypt_secret(value: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        return ""
    fernet = _fernet()
    if fernet is None:
        # Fallback keeps the app functional even if cryptography is missing.
        return f"plain:{cleaned}"
    return f"enc:{fernet.encrypt(cleaned.encode('utf-8')).decode('utf-8')}"


def decrypt_secret(token: str) -> str:
    cleaned = (token or "").strip()
    if not cleaned:
        return ""
    if cleaned.startswith("plain:"):
        return cleaned.removeprefix("plain:").strip()
    fernet = _fernet()
    if cleaned.startswith("enc:"):
        if fernet is None:
            raise ValueError("Encrypted credentials require the 'cryptography' package.")
        token_value = cleaned.removeprefix("enc:").strip()
        if not token_value:
            return ""
        try:
            return fernet.decrypt(token_value.encode("utf-8")).decode("utf-8")
        except InvalidToken as error:
            raise ValueError("Credential decryption failed. The encryption key may have changed.") from error

    if fernet is None:
        return cleaned
    # Backward compatibility: plaintext values from earlier versions.
    try:
        return fernet.decrypt(cleaned.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return cleaned
