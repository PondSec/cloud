from __future__ import annotations


def test_login_and_me(client):
    login = client.post("/auth/login", json={"username": "alice", "password": "alicepass"})
    assert login.status_code == 200

    payload = login.get_json()
    access_token = payload["access_token"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {access_token}"})
    assert me.status_code == 200
    me_payload = me.get_json()
    assert me_payload["user"]["username"] == "alice"
