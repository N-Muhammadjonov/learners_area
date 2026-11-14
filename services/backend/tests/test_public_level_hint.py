from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock
from uuid import UUID
import asyncio
import json

from starlette.requests import Request
from app.study_plan_level import read_bank, score_public_hint
from app import main as core
from app import study_plan_level_port as port

NOW = datetime(2026, 11, 14, tzinfo=timezone.utc)


def payload():
    bank = read_bank()
    groups = [('A1', ['grammar', 'vocabulary']), ('A2', ['reading', 'listening', 'use']),
              ('B1', ['grammar', 'vocabulary', 'reading']), ('B2', ['listening', 'use', 'grammar']),
              ('C1', ['vocabulary', 'reading', 'listening']), ('C2', ['use', 'grammar', 'vocabulary'])]
    ids = [f'{level}-{skill}-1' for level, skills in groups for skill in skills]
    return {'version': 1, 'source': 'public-level-check', 'created_at': NOW.isoformat(),
            'raw_answers': [{'id': key, 'answer': bank[key]['answer']} for key in ids]}


def test_reported_level_and_scores_are_untrusted():
    data = payload()
    data.update(level='A1', correct_answers=0)
    assert score_public_hint(data, now=NOW) == {'level': 'C2', 'correct': 17}
    for row in data['raw_answers']:
        row['answer'] = -1
    data.update(level='C2', correct_answers=17)
    assert score_public_hint(data, now=NOW) == {'level': 'A1', 'correct': 0}


def test_invalid_versions_answers_duplicates_and_expiry():
    assert score_public_hint([], now=NOW) is None
    for update in [{'version': True}, {'version': 2}, {'created_at': 'broken'},
                   {'created_at': (NOW-timedelta(days=1)).isoformat()},
                   {'created_at': (NOW+timedelta(minutes=2)).isoformat()},
                   {'created_at': NOW.replace(tzinfo=None).isoformat()}, {'raw_answers': [{}]*17}]:
        assert score_public_hint({**payload(), **update}, now=NOW) is None
    data = payload()
    data['raw_answers'][0]['answer'] = True
    assert score_public_hint(data, now=NOW) is None
    data = payload()
    data['raw_answers'][0] = data['raw_answers'][1]
    assert score_public_hint(data, now=NOW) is None


def test_import_is_once_and_cannot_overwrite_existing_level(monkeypatch):
    class Connection:
        claimed = False
        writes = []
        async def __aenter__(self): return self
        async def __aexit__(self, *_): return False
        def transaction(self): return self
        async def fetchval(self, query, *args):
            self.writes.append(query)
            if 'activity_events' in query:
                if self.claimed: return None
                self.claimed = True
                return args[0]
            assert "coalesce(onboarding_profiles.current_level,'')=''" in query
            assert 'submitted_at IS NOT NULL' in query
            return None  # Existing in-app/manual level wins.
    con = Connection()
    class Pool:
        def acquire(self): return con
    monkeypatch.setattr(port.core, 'pool', AsyncMock(return_value=Pool()))
    monkeypatch.setattr(port, 'plan_participant', AsyncMock(return_value=({'id': UUID(int=1)}, None)))
    data = payload()
    data['created_at'] = datetime.now(timezone.utc).isoformat()
    def request(raw):
        async def receive(): return {'type': 'http.request', 'body': raw, 'more_body': False}
        return Request({'type': 'http', 'method': 'POST', 'path': '/',
                        'headers': [(b'content-type', b'application/json')]}, receive)
    for _ in range(2):
        result = asyncio.run(port.import_public_level(request(json.dumps(data).encode())))
        assert json.loads(result.body) == {'state': 'ignored'}
    assert sum('onboarding_profiles' in query for query in con.writes) == 1
    for raw in [b'{', b'x'*4097]:
        assert asyncio.run(port.import_public_level(request(raw))).status_code == 400
