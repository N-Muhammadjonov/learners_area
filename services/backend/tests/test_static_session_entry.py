"""A returning Safari user re-enters the application without a landing/login loop."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import main as core
from app.frontend_static import StaticFrontend, entry_destination


def test_session_entry_destinations():
    assert entry_destination(None) is None
    assert entry_destination({'account_status': 'active', 'role': 'student'}) == '/app'
    assert entry_destination({'account_status': 'active', 'role': 'owner'}) == '/app'
    assert entry_destination({'account_status': 'active', 'role': 'guardian'}) == '/app/progress'
    assert entry_destination({'account_status': 'pending', 'role': 'student'}) == '/pending'


def test_existing_cookie_skips_landing_and_login(monkeypatch, tmp_path):
    frontend = StaticFrontend()
    monkeypatch.setattr(frontend, 'build', lambda: (tmp_path, {
        'files': {}, 'routes': [], 'redirects': []
    }))
    application = FastAPI()
    application.mount('/', frontend)
    client = TestClient(application)

    async def signed_in(_request):
        return {'account_status': 'active', 'role': 'student'}

    monkeypatch.setattr(core, 'current_user', signed_in)
    for path in ('/', '/login'):
        response = client.get(path, cookies={'la_session': 'existing-token'}, follow_redirects=False)
        assert response.status_code == 303
        assert response.headers['location'] == '/app'
        assert response.headers['cache-control'] == 'private, no-store'

    async def guardian(_request):
        return {'account_status': 'active', 'role': 'guardian'}

    monkeypatch.setattr(core, 'current_user', guardian)
    response = client.get('/', cookies={'la_session': 'existing-token'}, follow_redirects=False)
    assert response.status_code == 303
    assert response.headers['location'] == '/app/progress'
