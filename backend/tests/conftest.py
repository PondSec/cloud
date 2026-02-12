from __future__ import annotations

from pathlib import Path

import pytest

from app import create_app
from app.bootstrap import bootstrap_defaults
from app.extensions import db
from app.models import Role, User


@pytest.fixture
def app(tmp_path: Path):
    db_path = tmp_path / "test.db"
    storage_path = tmp_path / "storage"

    app = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path}",
            "STORAGE_ROOT": str(storage_path),
            "JWT_SECRET_KEY": "test-secret-key-at-least-32-bytes-long",
            "ALLOW_REGISTRATION": False,
            "DEFAULT_QUOTA_BYTES": 10 * 1024 * 1024,
            "MAX_UPLOAD_SIZE_BYTES": 5 * 1024 * 1024,
            "FRONTEND_ORIGIN": "http://localhost:5173",
        }
    )

    with app.app_context():
        db.create_all()
        bootstrap_defaults(commit=True)

        user_role = Role.query.filter_by(name="user").one()

        user = User(username="alice", bytes_limit=10 * 1024 * 1024, bytes_used=0, is_active=True)
        user.set_password("alicepass")
        user.roles.append(user_role)

        db.session.add(user)
        db.session.commit()

    yield app

    with app.app_context():
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()
