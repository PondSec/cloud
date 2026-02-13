from __future__ import annotations

from typing import Any

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import create_access_token, create_refresh_token, jwt_required, verify_jwt_in_request
from sqlalchemy import func

from ..common.audit import audit
from ..common.errors import APIError
from ..common.rate_limit import login_rate_limiter
from ..common.rbac import current_user
from ..extensions import db
from ..integration.service import consume_inventory_pro_sso_ticket, inventory_pro_public_context
from ..monitoring.quotas import get_or_create_quota
from ..models import AppSettings, Role, User, UserUiPreference


auth_bp = Blueprint("auth", __name__, url_prefix="/auth")
ALLOWED_DOCK_PATHS = [
    "/app/home",
    "/app/files",
    "/app/search",
    "/app/recents",
    "/app/shared",
    "/app/media",
    "/dev/workspaces",
    "/app/admin",
    "/app/monitoring",
    "/app/settings",
    "/app/inventorypro",
]

DEFAULT_UI_PREFERENCES: dict[str, Any] = {
    "effectsQuality": "medium",
    "animationsEnabled": True,
    "cornerRadius": 22,
    "panelOpacity": 0.1,
    "uiScale": 1.0,
    "accentHue": 188,
    "accentSaturation": 88,
    "accentLightness": 70,
    "dockPosition": "bottom",
    "dockEdgeOffset": 0,
    "dockBaseItemSize": 48,
    "dockMagnification": 68,
    "dockPanelHeight": 62,
    "dockOrder": ALLOWED_DOCK_PATHS,
}


def _clamp_float(value: Any, minimum: float, maximum: float, fallback: float) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, numeric))


def _clamp_int(value: Any, minimum: int, maximum: int, fallback: int) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, numeric))


def _normalize_dock_order(value: Any) -> list[str]:
    if not isinstance(value, list):
        return list(ALLOWED_DOCK_PATHS)

    seen: set[str] = set()
    normalized: list[str] = []
    for entry in value:
        if not isinstance(entry, str):
            continue
        path = entry.strip()
        if path not in ALLOWED_DOCK_PATHS or path in seen:
            continue
        seen.add(path)
        normalized.append(path)

    for path in ALLOWED_DOCK_PATHS:
        if path in seen:
            continue
        normalized.append(path)
    return normalized


def _sanitize_ui_preferences(raw: dict[str, Any] | None) -> dict[str, Any]:
    payload = raw or {}
    quality = payload.get("effectsQuality")
    if quality not in {"low", "medium", "high"}:
        quality = DEFAULT_UI_PREFERENCES["effectsQuality"]

    dock_position = payload.get("dockPosition")
    if dock_position not in {"bottom", "left", "right"}:
        dock_position = DEFAULT_UI_PREFERENCES["dockPosition"]

    return {
        "effectsQuality": quality,
        "animationsEnabled": bool(payload.get("animationsEnabled", DEFAULT_UI_PREFERENCES["animationsEnabled"])),
        "cornerRadius": _clamp_int(payload.get("cornerRadius"), 10, 40, int(DEFAULT_UI_PREFERENCES["cornerRadius"])),
        "panelOpacity": _clamp_float(payload.get("panelOpacity"), 0.05, 0.25, float(DEFAULT_UI_PREFERENCES["panelOpacity"])),
        "uiScale": _clamp_float(payload.get("uiScale"), 0.9, 1.15, float(DEFAULT_UI_PREFERENCES["uiScale"])),
        "accentHue": _clamp_int(payload.get("accentHue"), 0, 359, int(DEFAULT_UI_PREFERENCES["accentHue"])),
        "accentSaturation": _clamp_int(
            payload.get("accentSaturation"),
            35,
            100,
            int(DEFAULT_UI_PREFERENCES["accentSaturation"]),
        ),
        "accentLightness": _clamp_int(payload.get("accentLightness"), 35, 85, int(DEFAULT_UI_PREFERENCES["accentLightness"])),
        "dockPosition": dock_position,
        "dockEdgeOffset": _clamp_int(
            payload.get("dockEdgeOffset"),
            0,
            48,
            int(DEFAULT_UI_PREFERENCES["dockEdgeOffset"]),
        ),
        "dockBaseItemSize": _clamp_int(
            payload.get("dockBaseItemSize"),
            40,
            64,
            int(DEFAULT_UI_PREFERENCES["dockBaseItemSize"]),
        ),
        "dockMagnification": _clamp_int(
            payload.get("dockMagnification"),
            54,
            96,
            int(DEFAULT_UI_PREFERENCES["dockMagnification"]),
        ),
        "dockPanelHeight": _clamp_int(
            payload.get("dockPanelHeight"),
            52,
            84,
            int(DEFAULT_UI_PREFERENCES["dockPanelHeight"]),
        ),
        "dockOrder": _normalize_dock_order(payload.get("dockOrder")),
    }


def _load_or_create_preferences(user: User) -> UserUiPreference:
    prefs = user.ui_preferences
    if prefs is None:
        prefs = UserUiPreference(user_id=user.id, payload_json=dict(DEFAULT_UI_PREFERENCES))
        db.session.add(prefs)
        db.session.flush()
    return prefs


def _token_response(user: User) -> dict[str, Any]:
    claims = {
        "roles": [role.name for role in user.roles],
        "permissions": sorted({permission.code for role in user.roles for permission in role.permissions}),
    }
    access_token = create_access_token(identity=str(user.id), additional_claims=claims)
    refresh_token = create_refresh_token(identity=str(user.id), additional_claims=claims)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": user.to_dict(),
    }


def _get_user_role() -> Role:
    role = Role.query.filter_by(name="user").one_or_none()
    if role is None:
        raise APIError(500, "RBAC_NOT_READY", "Roles are not initialized.")
    return role


@auth_bp.post("/register")
def register():
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""

    if len(username) < 3:
        raise APIError(400, "INVALID_USERNAME", "Username must be at least 3 characters.")
    if len(password) < 8:
        raise APIError(400, "INVALID_PASSWORD", "Password must be at least 8 characters.")

    settings = AppSettings.singleton()
    actor: User | None = None

    if not settings.allow_registration:
        verify_jwt_in_request()
        actor = current_user(required=True)
        if actor is None or not actor.is_admin:
            raise APIError(403, "REGISTRATION_DISABLED", "Registration is disabled.")
    else:
        verify_jwt_in_request(optional=True)
        actor = current_user(required=False)

    existing = User.query.filter(func.lower(User.username) == username.lower()).one_or_none()
    if existing is not None:
        raise APIError(409, "USER_EXISTS", "Username is already taken.")

    user = User(
        username=username,
        bytes_limit=settings.default_quota,
        bytes_used=0,
        is_active=True,
    )
    user.set_password(password)
    user.roles.append(_get_user_role())

    db.session.add(user)
    db.session.flush()
    get_or_create_quota(user)
    audit(
        action="auth.register",
        actor=actor if actor else user,
        target_type="user",
        target_id=str(user.id),
        details={"username": username},
    )
    db.session.commit()

    if actor is not None:
        return jsonify({"user": user.to_dict()}), 201

    return jsonify(_token_response(user)), 201


@auth_bp.post("/login")
def login():
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""

    if not username or not password:
        raise APIError(400, "INVALID_CREDENTIALS", "Username and password are required.")

    settings = AppSettings.singleton()
    if settings.inventory_pro_enabled and settings.inventory_pro_enforce_sso:
        raise APIError(
            403,
            "SSO_ENFORCED",
            "Local login is disabled. Sign in via InventoryPro SSO.",
            {"exchange_endpoint": "/auth/inventorypro/exchange"},
        )

    remote_ip = (request.headers.get("X-Forwarded-For") or request.remote_addr or "unknown").split(",")[0].strip()
    rate_limit_key = f"{remote_ip}:{username.lower()}"

    if login_rate_limiter.is_blocked(
        rate_limit_key,
        current_app.config["LOGIN_RATE_LIMIT_WINDOW_SECONDS"],
        current_app.config["LOGIN_RATE_LIMIT_MAX_ATTEMPTS"],
    ):
        audit(
            action="auth.login_rate_limited",
            actor=None,
            entity_type="auth",
            entity_id=username.lower(),
            metadata={"username": username, "ip": remote_ip},
            severity="warning",
            success=False,
        )
        db.session.commit()
        raise APIError(429, "RATE_LIMITED", "Too many login attempts. Please try again later.")

    user = User.query.filter(func.lower(User.username) == username.lower()).one_or_none()
    if user is None or not user.is_active or not user.verify_password(password):
        login_rate_limiter.add_failure(rate_limit_key)
        audit(
            action="auth.login_failed",
            actor=user,
            target_type="user",
            target_id=str(user.id) if user is not None else None,
            details={"username": username, "ip": remote_ip},
            severity="warning",
            success=False,
        )
        db.session.commit()
        raise APIError(401, "INVALID_CREDENTIALS", "Invalid username or password.")

    login_rate_limiter.clear(rate_limit_key)
    audit(
        action="auth.login",
        actor=user,
        target_type="user",
        target_id=str(user.id),
        details={"ip": remote_ip},
    )
    db.session.commit()

    return jsonify(_token_response(user))


@auth_bp.get("/me")
@jwt_required()
def me():
    user = current_user(required=True)
    assert user is not None
    return jsonify({"user": user.to_dict()})


@auth_bp.get("/inventorypro/context")
@jwt_required()
def inventory_pro_context():
    settings = AppSettings.singleton()
    return jsonify({"inventory_pro": inventory_pro_public_context(settings)})


@auth_bp.post("/inventorypro/exchange")
def inventory_pro_exchange():
    settings = AppSettings.singleton()
    if not settings.inventory_pro_enabled or not settings.inventory_pro_sso_enabled:
        raise APIError(403, "SSO_DISABLED", "InventoryPro SSO is disabled.")

    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        raise APIError(400, "INVALID_PAYLOAD", "JSON object expected.")

    ticket = str(payload.get("ticket") or "").strip()
    user = consume_inventory_pro_sso_ticket(ticket)

    audit(
        action="auth.login_inventorypro",
        actor=user,
        target_type="user",
        target_id=str(user.id),
        details={"provider": "inventorypro"},
    )
    db.session.commit()

    return jsonify(_token_response(user))


@auth_bp.get("/ui-preferences")
@jwt_required()
def get_ui_preferences():
    user = current_user(required=True)
    assert user is not None

    prefs = _load_or_create_preferences(user)
    normalized = _sanitize_ui_preferences((prefs.payload_json or {}) if isinstance(prefs.payload_json, dict) else {})
    if prefs.payload_json != normalized:
        prefs.payload_json = normalized
        db.session.add(prefs)
        db.session.commit()

    return jsonify(
        {
            "user_id": user.id,
            "preferences": normalized,
            "updated_at": prefs.updated_at.isoformat() if prefs.updated_at else None,
        }
    )


@auth_bp.put("/ui-preferences")
@jwt_required()
def update_ui_preferences():
    user = current_user(required=True)
    assert user is not None

    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        raise APIError(400, "INVALID_PARAMETER", "Preferences payload must be an object.")

    prefs = _load_or_create_preferences(user)
    existing = prefs.payload_json if isinstance(prefs.payload_json, dict) else {}
    merged = {**existing, **payload}
    normalized = _sanitize_ui_preferences(merged)

    prefs.payload_json = normalized
    db.session.add(prefs)
    db.session.commit()

    return jsonify(
        {
            "user_id": user.id,
            "preferences": normalized,
            "updated_at": prefs.updated_at.isoformat() if prefs.updated_at else None,
        }
    )


@auth_bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    user = current_user(required=True)
    assert user is not None

    access_token = create_access_token(
        identity=str(user.id),
        additional_claims={
            "roles": [role.name for role in user.roles],
            "permissions": sorted({permission.code for role in user.roles for permission in role.permissions}),
        },
    )
    return jsonify({"access_token": access_token})
