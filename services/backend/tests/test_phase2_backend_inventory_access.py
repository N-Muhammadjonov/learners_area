"""Access guards for routes omitted from the previous API inventory."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main as core


UID = '11111111-1111-4111-8111-111111111111'
OMITTED = [
    ('GET', '/api/internal/telegram/directory/{userId}/results'),
    ('POST', '/api/internal/telegram/contacts/{telegramUserId}/remove'),
    ('GET', '/api/riwi/materials'),
    ('POST', '/api/riwi/conversations/{conversation_id}/archive'),
    ('POST', '/api/riwi/documents/export'),
]


@pytest.mark.parametrize('method,template', OMITTED)
@pytest.mark.parametrize('invalid_credentials', [False, True])
def test_omitted_routes_deny_anonymous_before_database(
        monkeypatch, method, template, invalid_credentials):
    monkeypatch.setenv('AUTH_SECRET', 'phase2-isolated-session-secret-1234567890')
    monkeypatch.setenv('BOT_SERVICE_SECRET', 'phase2-isolated-bot-secret-1234567890')

    async def forbidden_pool():
        pytest.fail('Unauthenticated request reached the database')

    monkeypatch.setattr(core, 'pool', forbidden_pool)
    url = template.replace('{userId}', UID).replace('{conversation_id}', UID)
    url = url.replace('{telegramUserId}', '123456789')
    headers = {}
    if invalid_credentials:
        headers = {'authorization': 'Bearer invalid-bot-token',
                   'cookie': 'la_session=invalid-session-token'}
    with TestClient(core.app) as client:
        response = client.request(method, url, headers=headers, json={})
    assert response.status_code == 401, (method, template, response.text)
    expected_error = 'unauthorized' if '/internal/telegram/' in template else 'unauthenticated'
    assert response.json() == {'error': expected_error}
    assert response.headers['x-content-type-options'] == 'nosniff'


def test_inventory_reconciliation_preserves_history_and_classifies_added_routes():
    state = json.loads((Path(__file__).resolve().parents[1] / 'PORT_STATUS.json').read_text())
    additions = state['post_snapshot_additive_endpoints']
    assert {(row['method'], row['path']) for row in additions} == set(OMITTED)
    assert all(row['status'] == 'ported_code_no_db_integration_test' for row in additions)
    assert state['prior_phase2_inventory_summary']['total_methods'] == 340
    assert state['prior_checkpoint5_inventory']['total_methods'] == 304
    assert len(state['historical_endpoints']) == 272
    assert len(state['post_port_additive_endpoints']) == 32
    assert state['canonical_pre_riwi_methods'] + state['riwi_methods'] == state['total_methods'] == 345
