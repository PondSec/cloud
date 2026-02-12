from __future__ import annotations

import os
from getpass import getpass

from app import create_app
from app.bootstrap import bootstrap_defaults
from app.extensions import db
from app.models import AppSettings, Role, User


def main() -> None:
    app = create_app()

    with app.app_context():
        db.create_all()
        bootstrap_defaults(commit=True)

        username = os.getenv("ADMIN_USERNAME", "admin")
        password = os.getenv("ADMIN_PASSWORD")
        if not password:
            password = getpass("Admin password: ")

        settings = AppSettings.singleton()
        admin_role = Role.query.filter_by(name="admin").one_or_none()
        if admin_role is None:
            raise RuntimeError("Admin role missing. Run migrations and bootstrap first.")

        user = User.query.filter_by(username=username).one_or_none()
        created = False
        if user is None:
            user = User(
                username=username,
                bytes_limit=settings.default_quota,
                bytes_used=0,
                is_active=True,
            )
            created = True

        user.set_password(password)
        if admin_role not in user.roles:
            user.roles.append(admin_role)

        db.session.add(user)
        db.session.commit()

        print(f"{'Created' if created else 'Updated'} admin user: {username}")


if __name__ == "__main__":
    main()
