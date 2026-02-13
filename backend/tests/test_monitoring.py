from __future__ import annotations

from pathlib import Path

from app.extensions import db
from app.models import AuditLog, Role, SystemMetricSnapshot, User, utc_now
from app.monitoring.snapshots import run_snapshot_cycle


def _token(client, username: str, password: str) -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response.get_json()["access_token"]


def _create_admin(app) -> User:
    with app.app_context():
        admin_role = Role.query.filter_by(name="admin").one()
        admin = User(username="monitor-admin", bytes_limit=10 * 1024 * 1024, bytes_used=0, is_active=True)
        admin.set_password("monitorpass123")
        admin.roles.append(admin_role)
        db.session.add(admin)
        db.session.commit()
        return admin


def test_monitoring_endpoints_are_auth_protected(client, app):
    _create_admin(app)

    no_token = client.get("/api/monitoring/overview")
    assert no_token.status_code == 401

    user_token = _token(client, "alice", "alicepass")
    user_headers = {"Authorization": f"Bearer {user_token}"}
    forbidden = client.get("/api/monitoring/overview", headers=user_headers)
    assert forbidden.status_code == 403

    admin_token = _token(client, "monitor-admin", "monitorpass123")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    allowed = client.get("/api/monitoring/overview", headers=admin_headers)
    assert allowed.status_code == 200


def test_audit_log_insertion_and_filtering(client, app):
    _create_admin(app)
    admin_token = _token(client, "monitor-admin", "monitorpass123")
    headers = {"Authorization": f"Bearer {admin_token}"}

    failed = client.post("/auth/login", json={"username": "alice", "password": "wrong-password"})
    assert failed.status_code == 401

    logs = client.get(
        "/api/audit/logs?action=auth.login_failed&success=false&page=1&page_size=10",
        headers=headers,
    )
    assert logs.status_code == 200
    payload = logs.get_json()
    assert payload["pagination"]["total"] >= 1
    assert any(item["action"] == "auth.login_failed" for item in payload["items"])

    actions = client.get("/api/audit/actions", headers=headers)
    assert actions.status_code == 200
    assert "auth.login_failed" in actions.get_json()["items"]

    with app.app_context():
        assert AuditLog.query.filter_by(action="auth.login_failed").count() >= 1


def test_snapshot_job_writes_to_db(app):
    with app.app_context():
        assert SystemMetricSnapshot.query.count() == 0
        run_snapshot_cycle(Path(app.config["STORAGE_ROOT"]), retention_days=7)
        assert SystemMetricSnapshot.query.count() == 1


def test_overview_uses_latest_snapshot_when_live_metrics_are_missing(client, app, monkeypatch):
    _create_admin(app)

    with app.app_context():
        snapshot = SystemMetricSnapshot(
            ts=utc_now(),
            cpu_percent=21.5,
            memory_percent=43.2,
            disk_percent=62.4,
            net_bytes_sent=1234,
            net_bytes_recv=5678,
        )
        db.session.add(snapshot)
        db.session.commit()

    def degraded_host_metrics(_storage_root):
        return {
            "available": False,
            "reason": "mocked",
            "cpu_percent": None,
            "memory_percent": None,
            "disk_percent": None,
            "disk_used_bytes": None,
            "disk_total_bytes": None,
            "disk_read_bytes": None,
            "disk_write_bytes": None,
            "disk_free_bytes": None,
            "net_bytes_sent": None,
            "net_bytes_recv": None,
            "memory_used_bytes": None,
            "memory_total_bytes": None,
            "load_average": {"one": None, "five": None, "fifteen": None},
            "per_interface": [],
            "captured_at": utc_now().isoformat(),
        }

    monkeypatch.setattr("app.monitoring.routes.collect_host_metrics", degraded_host_metrics)

    token = _token(client, "monitor-admin", "monitorpass123")
    response = client.get("/api/monitoring/overview?nocache=1", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["kpis"]["cpu_percent"] == 21.5
    assert payload["kpis"]["memory_percent"] == 43.2
    assert payload["kpis"]["disk_percent"] == 62.4
    assert payload["kpis"]["network_total_bytes"]["sent"] == 1234
    assert payload["kpis"]["network_total_bytes"]["recv"] == 5678


def test_options_preflight_does_not_require_jwt(client):
    headers = {
        "Origin": "http://127.0.0.1:5173",
        "Access-Control-Request-Method": "GET",
    }

    monitoring_preflight = client.options("/api/monitoring/overview", headers=headers)
    assert monitoring_preflight.status_code in {200, 204}

    audit_preflight = client.options("/api/audit/logs", headers=headers)
    assert audit_preflight.status_code in {200, 204}
