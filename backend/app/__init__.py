from __future__ import annotations

from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_jwt_extended import JWTManager
from sqlalchemy.exc import OperationalError, ProgrammingError

from .admin import admin_bp
from .audit import audit_bp
from .auth import auth_bp
from .bootstrap import bootstrap_defaults
from .common.errors import error_payload, register_error_handlers
from .common.schema_compat import ensure_audit_schema_compat, ensure_inventorypro_schema_compat, ensure_mail_schema_compat
from .config import Config
from .extensions import cors, db, jwt, migrate
from .files import files_bp
from .integration import integration_bp
from .mail import mail_bp
from .monitoring import monitoring_bp
from .monitoring.snapshots import start_snapshot_scheduler
from .office import office_bp
from .shares import public_shares_bp, shares_bp


load_dotenv()


def _register_jwt_handlers(jwt_manager: JWTManager) -> None:
    @jwt_manager.unauthorized_loader
    def unauthorized(reason: str):  # type: ignore[no-untyped-def]
        return jsonify(error_payload("UNAUTHENTICATED", "Missing or invalid authentication token.", {"reason": reason})), 401

    @jwt_manager.invalid_token_loader
    def invalid_token(reason: str):  # type: ignore[no-untyped-def]
        return jsonify(error_payload("INVALID_TOKEN", "Invalid token.", {"reason": reason})), 401

    @jwt_manager.expired_token_loader
    def expired_token(jwt_header, jwt_payload):  # type: ignore[no-untyped-def]
        return jsonify(error_payload("TOKEN_EXPIRED", "Token has expired.")), 401


def create_app(config_override: dict[str, Any] | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)
    if config_override:
        app.config.update(config_override)

    Path(app.config["STORAGE_ROOT"]).mkdir(parents=True, exist_ok=True)

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    _register_jwt_handlers(jwt)
    cors.init_app(app, resources={r"/*": {"origins": app.config["FRONTEND_ORIGINS"]}})

    app.register_blueprint(auth_bp)
    app.register_blueprint(files_bp)
    app.register_blueprint(office_bp)
    # Register Office routes under /api as well. This makes OnlyOffice callbacks and downloads
    # work reliably behind reverse proxies that only forward /api/* to the backend.
    app.register_blueprint(office_bp, url_prefix="/api", name="api_office")
    app.register_blueprint(shares_bp)
    app.register_blueprint(public_shares_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(integration_bp)
    app.register_blueprint(mail_bp)
    app.register_blueprint(monitoring_bp)
    app.register_blueprint(audit_bp)

    @app.get("/health")
    def healthcheck():
        return {"status": "ok"}

    register_error_handlers(app)

    with app.app_context():
        try:
            ensure_inventorypro_schema_compat()
            ensure_audit_schema_compat()
            ensure_mail_schema_compat()
            bootstrap_defaults(commit=True)
        except (OperationalError, ProgrammingError):
            db.session.rollback()

    scheduler = start_snapshot_scheduler(app)
    app.extensions["metrics_snapshot_scheduler"] = scheduler

    return app
