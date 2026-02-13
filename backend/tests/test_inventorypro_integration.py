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
        assert settings.inventory_pro_shared_secret_plain == "inventory-pro-shared-secret"


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

def test_cloud_can_fetch_inventorypro_summary_and_launch_url(client, app, monkeypatch):
    _enable_inventory_integration(app)
    token = _token(client, "alice", "alicepass")
    headers = {"Authorization": f"Bearer {token}"}

    class _FakeResponse:
        def __init__(self, payload: bytes):
            self.status = 200
            self._payload = payload

        def read(self):
            return self._payload

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def _fake_urlopen(req, timeout=0):  # type: ignore[no-untyped-def]
        assert timeout == 20
        headers_lower = {key.lower(): value for key, value in (req.headers or {}).items()}
        assert headers_lower.get("x-inventorypro-secret") == "inventory-pro-shared-secret"
        if req.full_url.startswith("https://inv.example.com/api/integration/cloud/summary"):
            return _FakeResponse(b'{"counts":{"assets":1,"categories":2,"users":3,"tickets_total":4,"tickets_open":2}}')
        if req.full_url.startswith("https://inv.example.com/api/integration/cloud/recents"):
            return _FakeResponse(b'{"items":[{"type":"asset","id":1,"title":"A","subtitle":"C","timestamp":"x","url":"/"}],"count":1}')
        if req.full_url.startswith("https://inv.example.com/api/integration/cloud/search"):
            return _FakeResponse(b'{"items":[{"type":"ticket","id":9,"title":"T","subtitle":"open","url":"/tickets"}],"count":1}')
        if req.full_url.startswith("https://inv.example.com/api/integration/cloud/sso/ticket"):
            return _FakeResponse(b'{"ticket":"t123","expires_in":120,"user":{"id":1,"username":"alice","cloud_user_id":"1"}}')
        raise AssertionError(f"unexpected url: {req.full_url}")

    monkeypatch.setattr("app.integration.inventorypro_remote.urllib.request.urlopen", _fake_urlopen)

    summary = client.get("/auth/inventorypro/summary", headers=headers)
    assert summary.status_code == 200
    assert summary.get_json()["counts"]["assets"] == 1

    recents = client.get("/auth/inventorypro/recents?limit=5", headers=headers)
    assert recents.status_code == 200
    assert recents.get_json()["count"] == 1

    search = client.get("/auth/inventorypro/search?q=foo&limit=7", headers=headers)
    assert search.status_code == 200
    assert search.get_json()["count"] == 1

    launch = client.get("/auth/inventorypro/launch?next=/tickets", headers=headers)
    assert launch.status_code == 200
    data = launch.get_json()
    assert data["url"].startswith("https://inv.example.com/integration/cloud/sso/login?")
    assert "ticket=t123" in data["url"]
