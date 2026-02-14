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
