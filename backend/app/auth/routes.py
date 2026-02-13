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
from ..monitoring.quotas import get_or_create_quota
from ..models import AppSettings, Role, User


auth_bp = Blueprint("auth", __name__, url_prefix="/auth")


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
