from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import main as core, study_plan_port
from app.asgi import application


@pytest.mark.parametrize('role,status', [
    ('owner', 200), ('student', 200), ('teacher', 403), ('admin', 403), (None, 401),
])
def test_rewards_and_redeem_use_learner_role_and_own_account(monkeypatch, role, status):
    uid = uuid4()

    class Connection:
        @asynccontextmanager
        async def acquire(self):
            assert status == 200
            yield self

        transaction = acquire

        async def fetchval(self, query, account_id):
            assert 'FROM study_plan_preferences' in query
            assert account_id == uid
            return uid

    connection = Connection()

    async def user(req, active=False):
        assert active
        return {'id': uid, 'role': role} if role else None

    async def pool():
        return connection

    async def refresh_plan(con, account, now, *, mode):
        assert con is connection and account['id'] == uid and mode == 'today'

    async def wallet(con, account_id):
        assert con is connection and account_id == uid
        return {'balance': 10, 'purchases': []}

    monkeypatch.setattr(core, 'current_user', user)
    monkeypatch.setattr(core, 'pool', pool)
    monkeypatch.setattr(study_plan_port, 'current_plan', refresh_plan)
    monkeypatch.setattr(study_plan_port, 'reward_state', wallet)
    with TestClient(application, base_url='http://localhost:4173') as client:
        response = client.get('/api/study-plan/rewards')
        assert response.status_code == status
        redeem = client.put('/api/study-plan/rewards/blue-frame',
                            headers={'Origin': 'http://localhost:4173'})
        if status == 200:
            assert response.json()['balance'] == 10
            assert redeem.status_code == 409
            assert redeem.json()['error'] == 'insufficient_points'
        else:
            assert redeem.status_code == status
