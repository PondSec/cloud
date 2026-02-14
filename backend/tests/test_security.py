from __future__ import annotations

import pytest

from app import create_app


def test_security_headers_present(client):
    response = client.get('/health')
    assert response.status_code == 200
    assert response.headers['X-Content-Type-Options'] == 'nosniff'
    assert response.headers['X-Frame-Options'] == 'DENY'
    assert 'frame-ancestors' in response.headers['Content-Security-Policy']


def test_production_requires_non_default_jwt_secret():
    with pytest.raises(RuntimeError):
        create_app({'ENV': 'production', 'JWT_SECRET_KEY': 'dev-jwt-secret-key-change-me-at-least-32-bytes'})


def _access_token(client) -> str:
    response = client.post('/auth/login', json={'username': 'alice', 'password': 'alicepass'})
    assert response.status_code == 200
    payload = response.get_json()
    assert isinstance(payload, dict)
    return payload['access_token']


def test_csrf_blocks_cross_origin_state_change_when_enabled(app, client):
    flags = dict(app.config.get('FEATURE_FLAGS') or {})
    flags['security.csrf'] = True
    app.config['FEATURE_FLAGS'] = flags

    token = _access_token(client)
    headers = {'Authorization': f'Bearer {token}', 'Origin': 'http://evil.example'}
    response = client.post('/files/folder', json={'name': 'blocked-folder', 'parent_id': None}, headers=headers)
    assert response.status_code == 403
    assert response.get_json()['error']['code'] == 'CSRF_BLOCKED'


def test_rate_limit_triggers_when_enabled(app, client):
    flags = dict(app.config.get('FEATURE_FLAGS') or {})
    flags['security.rate_limit'] = True
    app.config['FEATURE_FLAGS'] = flags
    app.config['RATE_LIMIT_DEFAULT'] = '2/min'

    assert client.get('/health').status_code == 200
    assert client.get('/health').status_code == 200
    blocked = client.get('/health')
    assert blocked.status_code == 429
    assert blocked.get_json()['error']['code'] == 'RATE_LIMITED'
