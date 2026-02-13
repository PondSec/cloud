from __future__ import annotations

from app.extensions import db
from app.models import AppSettings, Role, User


def _token(client, username: str, password: str) -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response.get_json()["access_token"]


def _enable_inventory_integration(app, *, secret: str = "inventory-pro-shared-secret"):
    with app.app_context():
        settings = AppSettings.singleton()
        settings.inventory_pro_enabled = True
        settings.inventory_pro_sync_enabled = True
        settings.inventory_pro_sso_enabled = True
        settings.inventory_pro_dock_enabled = True
        settings.inventory_pro_base_url = "https://inv.example.com"
        settings.inventory_pro_auto_provision_users = True
        settings.inventory_pro_default_role_name = "user"
        settings.set_inventory_pro_shared_secret(secret)
        db.session.commit()


def test_admin_can_save_inventorypro_settings(client, app):
    with app.app_context():
        admin_role = Role.query.filter_by(name="admin").one()
        admin = User(username="root", bytes_limit=10 * 1024 * 1024, bytes_used=0, is_active=True)
        admin.set_password("rootpass123")
        admin.roles.append(admin_role)
        db.session.add(admin)
        db.session.commit()

    token = _token(client, "root", "rootpass123")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.put(
        "/admin/settings",
        headers=headers,
        json={
            "inventory_pro": {
                "enabled": True,
                "base_url": "https://inv.example.com/",
                "sync_enabled": True,
                "sso_enabled": True,
                "dock_enabled": True,
                "auto_provision_users": True,
                "enforce_sso": False,
                "default_role_name": "user",
                "shared_secret": "inventory-pro-shared-secret",
            }
        },
    )
    assert response.status_code == 200
    data = response.get_json()["settings"]
    assert data["inventory_pro"]["enabled"] is True
    assert data["inventory_pro"]["base_url"] == "https://inv.example.com"
    assert data["inventory_pro"]["has_shared_secret"] is True

    with app.app_context():
        settings = AppSettings.singleton()
        assert settings.has_inventory_pro_secret is True
        assert settings.verify_inventory_pro_shared_secret("inventory-pro-shared-secret") is True


def test_inventorypro_sync_creates_user(client, app):
    _enable_inventory_integration(app)

    response = client.post(
        "/integration/inventorypro/users/sync",
        headers={"X-InventoryPro-Secret": "inventory-pro-shared-secret"},
        json={
            "subject": "inv-u-1001",
            "username": "inventory-agent",
            "role_names": ["user"],
            "is_active": True,
            "bytes_limit": 1024 * 1024,
        },
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["count"] == 1
    assert payload["items"][0]["status"] == "created"

    with app.app_context():
        user = User.query.filter_by(username="inventory-agent").one()
        assert user.inventory_pro_user_id == "inv-u-1001"
        assert any(role.name == "user" for role in user.roles)


def test_inventorypro_sso_ticket_exchange_returns_jwt(client, app):
    _enable_inventory_integration(app)

    ticket_response = client.post(
        "/integration/inventorypro/sso/ticket",
        headers={"X-InventoryPro-Secret": "inventory-pro-shared-secret"},
        json={
            "subject": "inv-u-42",
            "username": "inv-sso-user",
            "role_names": ["user"],
            "is_active": True,
        },
    )
    assert ticket_response.status_code == 200
    ticket = ticket_response.get_json()["ticket"]
    assert ticket

    exchange = client.post("/auth/inventorypro/exchange", json={"ticket": ticket})
    assert exchange.status_code == 200
    exchange_payload = exchange.get_json()
    assert exchange_payload["user"]["username"] == "inv-sso-user"
    assert exchange_payload["access_token"]
    assert exchange_payload["refresh_token"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {exchange_payload['access_token']}"})
    assert me.status_code == 200
    assert me.get_json()["user"]["username"] == "inv-sso-user"


def test_local_login_is_blocked_when_sso_is_enforced(client, app):
    with app.app_context():
        settings = AppSettings.singleton()
        settings.inventory_pro_enabled = True
        settings.inventory_pro_enforce_sso = True
        db.session.commit()

    login = client.post("/auth/login", json={"username": "alice", "password": "alicepass"})
    assert login.status_code == 403
    assert login.get_json()["error"]["code"] == "SSO_ENFORCED"
