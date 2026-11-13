import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from app.riwi_capabilities import RiwiActor
from app.riwi_tools_domain import explain_objective_question

UID = '11111111-1111-4111-8111-111111111111'
AID = '22222222-2222-4222-8222-222222222222'
QID = '33333333-3333-4333-8333-333333333333'


def connection(owner=UID, status='submitted'):
    async def row(sql, *args):
        if 'content_snapshot' in sql:
            return {'content_snapshot': {'questions': [{'id': QID, 'type': 'mcq', 'correctAnswer': 'HIDDEN_KEY', 'explanation': 'HIDDEN_EXPLANATION'}]}}
        return {'user_id': owner, 'status': status, 'content_version_id': AID, 'learner_answer': 'my draft', 'is_correct': False}
    return SimpleNamespace(fetchrow=AsyncMock(side_effect=row), execute=AsyncMock())


@pytest.mark.asyncio
@pytest.mark.parametrize('module', ['reading', 'listening'])
async def test_only_method_is_returned_even_after_submission(module):
    result = await explain_objective_question(connection(), RiwiActor(UID, 'student'), {'module': module, 'attemptId': AID, 'questionId': QID})
    encoded = json.dumps(result)
    assert 'HIDDEN_' not in encoded
    assert result['teachingOnly'] and result['officialAnswer'] == ''


@pytest.mark.asyncio
async def test_procedural_mode_keeps_attempt_ownership_and_submission_guards():
    payload = {'attemptId': AID, 'questionId': QID}
    with pytest.raises(PermissionError, match='forbidden'):
        await explain_objective_question(connection(owner=AID), RiwiActor(UID, 'student'), payload)
    with pytest.raises(PermissionError, match='attempt_not_submitted'):
        await explain_objective_question(connection(status='in_progress'), RiwiActor(UID, 'student'), payload)
    with pytest.raises(PermissionError, match='forbidden'):
        await explain_objective_question(connection(), RiwiActor(UID, 'admin'), payload)
