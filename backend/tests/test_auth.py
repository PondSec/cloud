from __future__ import annotations

from app.extensions import db
from app.models import Role, User


def test_login_and_me(client):
    login = client.post("/auth/login", json={"username": "alice", "password": "alicepass"})
    assert login.status_code == 200

    payload = login.get_json()
    access_token = payload["access_token"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {access_token}"})
    assert me.status_code == 200
    me_payload = me.get_json()
    assert me_payload["user"]["username"] == "alice"


def test_ui_preferences_can_be_saved_and_loaded(client):
    login = client.post("/auth/login", json={"username": "alice", "password": "alicepass"})
    assert login.status_code == 200
    token = login.get_json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    initial = client.get("/auth/ui-preferences", headers=headers)
    assert initial.status_code == 200
    initial_payload = initial.get_json()
    assert initial_payload["preferences"]["effectsQuality"] == "medium"
    assert initial_payload["preferences"]["dockEdgeOffset"] == 0

    update = client.put(
        "/auth/ui-preferences",
        headers=headers,
        json={
            "effectsQuality": "high",
            "animationsEnabled": False,
            "cornerRadius": 33,
            "panelOpacity": 0.18,
            "uiScale": 1.12,
            "accentHue": 25,
            "accentSaturation": 90,
            "accentLightness": 62,
            "dockPosition": "left",
            "dockEdgeOffset": 14,
            "dockBaseItemSize": 58,
            "dockMagnification": 84,
            "dockPanelHeight": 70,
            "dockOrder": ["/app/settings", "/app/home"],
        },
    )
    assert update.status_code == 200
    updated = update.get_json()["preferences"]
    assert updated["effectsQuality"] == "high"
    assert updated["animationsEnabled"] is False
    assert updated["cornerRadius"] == 33
    assert updated["dockPosition"] == "left"
    assert updated["dockEdgeOffset"] == 14
    assert updated["dockOrder"][0] == "/app/settings"
    assert "/app/files" in updated["dockOrder"]

    loaded = client.get("/auth/ui-preferences", headers=headers)
    assert loaded.status_code == 200
    loaded_payload = loaded.get_json()["preferences"]
    assert loaded_payload["effectsQuality"] == "high"
    assert loaded_payload["dockPosition"] == "left"
    assert loaded_payload["dockEdgeOffset"] == 14


def test_ui_preferences_are_user_specific(client, app):
    with app.app_context():
        role = Role.query.filter_by(name="user").one()
        bob = User(username="bob", bytes_limit=10 * 1024 * 1024, bytes_used=0, is_active=True)
        bob.set_password("bobpass123")
        bob.roles.append(role)
        db.session.add(bob)
        db.session.commit()

    alice_login = client.post("/auth/login", json={"username": "alice", "password": "alicepass"})
    bob_login = client.post("/auth/login", json={"username": "bob", "password": "bobpass123"})
    assert alice_login.status_code == 200
    assert bob_login.status_code == 200

    alice_headers = {"Authorization": f"Bearer {alice_login.get_json()['access_token']}"}
    bob_headers = {"Authorization": f"Bearer {bob_login.get_json()['access_token']}"}

    alice_update = client.put(
        "/auth/ui-preferences",
        headers=alice_headers,
        json={"accentHue": 10, "dockPosition": "right", "dockEdgeOffset": 22},
    )
    assert alice_update.status_code == 200

    bob_prefs = client.get("/auth/ui-preferences", headers=bob_headers)
    assert bob_prefs.status_code == 200
    payload = bob_prefs.get_json()["preferences"]
    assert payload["accentHue"] == 188
    assert payload["dockPosition"] == "bottom"
    assert payload["dockEdgeOffset"] == 0


def test_refresh_token_rotation_and_reuse_blocked(client):
    login = client.post('/auth/login', json={'username': 'alice', 'password': 'alicepass'})
    assert login.status_code == 200
    refresh_token = login.get_json()['refresh_token']

    first = client.post('/auth/refresh', headers={'Authorization': f'Bearer {refresh_token}'})
    assert first.status_code == 200
    first_payload = first.get_json()
    assert 'access_token' in first_payload
    assert 'refresh_token' in first_payload

    second = client.post('/auth/refresh', headers={'Authorization': f'Bearer {refresh_token}'})
    assert second.status_code == 401
    assert second.get_json()['error']['code'] == 'TOKEN_REUSED'


def test_wrong_audience_token_rejected(client, app):
    import jwt as pyjwt
    from datetime import datetime, timedelta, timezone

    with app.app_context():
        bad_token = pyjwt.encode(
            {
                'sub': '1',
                'type': 'access',
                'fresh': False,
                'iat': datetime.now(timezone.utc),
                'nbf': datetime.now(timezone.utc),
                'exp': datetime.now(timezone.utc) + timedelta(minutes=5),
                'jti': 'bad-aud-jti',
                'csrf': 'csrf',
                'iss': app.config['JWT_ENCODE_ISSUER'],
                'aud': 'invalid-audience',
            },
            app.config['JWT_SECRET_KEY'],
            algorithm='HS256',
        )

    me = client.get('/auth/me', headers={'Authorization': f'Bearer {bad_token}'})
    assert me.status_code == 401
