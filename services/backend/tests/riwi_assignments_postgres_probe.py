"""Actual assignment HTTP/SQL checks on an isolated, fully migrated database.

Run through scripts/verify-fastapi-postgres.mjs; no shared database or provider.
"""
import asyncio
from datetime import datetime, timezone
import json
import os
from uuid import uuid4
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from riwi_postgres_probe import Connection
from app import main as core
from app import step31_coach as coach
from app.security import SESSION_COOKIE, issue_token
from app.step27_retention_policy import work_filter

con = Connection()
async def pool(): return con
core.pool = pool
os.environ.update(AUTH_SECRET='isolated-assignment-probe-signing-secret',
                  RATE_LIMIT_BACKEND='postgres', RIWI_ENABLED='true',
                  RIWI_EVALUATION_MODE='independent-v1')
ids = {name: str(uuid4()) for name in ('a', 'b', 'stranger', 'teacher', 'other_teacher', 'admin', 'owner', 'assignment', 'retry_assignment')}
checks = 0
def check(condition):
    global checks
    assert condition
    checks += 1
def query(sql, *values): return asyncio.run(con.fetch(sql, *values))
def value(sql, *values): return asyncio.run(con.fetchval(sql, *values))
def execute(sql, *values): return asyncio.run(con.execute(sql, *values))

for name in ('a', 'b', 'stranger', 'teacher', 'other_teacher', 'admin', 'owner'):
    role = 'student' if name in ('a', 'b', 'stranger') else 'teacher' if name == 'other_teacher' else name
    execute("INSERT INTO users(id,name,email,password_hash,role,account_status) VALUES($1,$2,$3,'fixture',$4,'active')",
            ids[name], name, name+'@assignment-probe.invalid', role)
for name in ('assignment', 'retry_assignment'):
    execute("INSERT INTO assignments(id,title,description,created_by_user_id,target_user_id) VALUES($1,'Authored task','Explain your choice.',$2,$3)",
            ids[name], ids['teacher'], ids['a'])
    for target in ('a', 'b'):
        execute('INSERT INTO assignment_targets(assignment_id,student_user_id) VALUES($1,$2)', ids[name], ids[target])

client = TestClient(core.app)
def headers(name):
    role = 'student' if name in ('a', 'b', 'stranger') else 'teacher' if name == 'other_teacher' else name
    token = issue_token({'id': ids[name], 'name': name, 'role': role, 'locale': 'en'})
    return {'Cookie': f'{SESSION_COOKIE}={token}'}
def submit(name, text, assignment='assignment'):
    return client.post('/api/assignments/'+ids[assignment]+'/evaluate', headers=headers(name), json={'response': text})

text = 'I prefer walking to the library because the route is quiet and it gives me time to think. '
forbidden = AsyncMock(side_effect=AssertionError('provider lookup or network attempted'))
with patch.object(coach, 'status', forbidden), patch.object(coach, 'vendor', forbidden):
    first = submit('a', text)
    check(first.status_code == 200)
    first_id = first.json()['evaluationId']
    check(value('SELECT status FROM assignments WHERE id=$1', ids['assignment']) == 'not_started')
    check(value('SELECT status FROM assignment_targets WHERE assignment_id=$1 AND student_user_id=$2', ids['assignment'], ids['a']) == 'completed')
    check(value('SELECT status FROM assignment_targets WHERE assignment_id=$1 AND student_user_id=$2', ids['assignment'], ids['b']) == 'not_started')
    retry = submit('a', text)
    check(retry.status_code == 200 and retry.json()['evaluationId'] == first_id)
    check(value('SELECT count(*) FROM assignment_responses') == 1)
    check(value('SELECT count(*) FROM evaluations') == 1)

    second = submit('b', text)
    check(second.status_code == 200 and second.json()['evaluationId'] != first_id)
    check(value('SELECT status FROM assignments WHERE id=$1', ids['assignment']) == 'completed')
    check(value("SELECT count(*) FROM evaluations e JOIN assignment_responses r ON e.source_id=r.id WHERE e.source_type='assignment_response' AND e.user_id=r.user_id") == 2)

    revision = submit('a', text+'However, I use the bus when the weather is wet.')
    check(revision.status_code == 200 and revision.json()['evaluationId'] not in (first_id, second.json()['evaluationId']))
    check(value('SELECT count(*) FROM assignment_responses') == 3)
    check(value('SELECT content FROM assignment_responses WHERE id=(SELECT source_id FROM evaluations WHERE id=$1)', first_id) == text)

    for name, status in (('stranger', 403), ('admin', 403), ('other_teacher', 403), ('owner', 400)):
        check(submit(name, text).status_code == status)
    check(value('SELECT count(*) FROM assignment_responses') == 3)

    # A failed evaluator leaves the original response retryable, without a
    # second response row or a cached success from another assignment.
    with patch.object(coach, 'resolve', AsyncMock(return_value=(None, 'evaluation_unavailable'))):
        failed = submit('a', text, 'retry_assignment')
    check(failed.status_code == 502)
    check(value('SELECT count(*) FROM assignment_responses') == 4)
    recovered = submit('a', text, 'retry_assignment')
    check(recovered.status_code == 200)
    check(value('SELECT count(*) FROM assignment_responses') == 4)
forbidden.assert_not_awaited()

# Retention must preserve both the new per-response source and old parent-ID
# evaluations. This only selects candidate rows; no retention deletion runs.
execute("UPDATE assignment_responses SET created_at='2020-01-01Z',updated_at='2020-01-01Z'")
condition = work_filter('assignment_responses', 'greatest(t.created_at,t.updated_at)', ['assignment', 'assignment_response'])
cutoff = datetime(2025, 1, 1, tzinfo=timezone.utc)
check(not query('SELECT t.id FROM assignment_responses t WHERE '+condition, cutoff))
legacy = str(uuid4())
execute("INSERT INTO assignment_responses(id,assignment_id,user_id,content,created_at,updated_at) VALUES($1,$2,$3,'Legacy preserved response.','2020-01-01Z','2020-01-01Z')", legacy, ids['assignment'], ids['a'])
execute("""INSERT INTO evaluations(user_id,evaluation_type,source_type,source_id,provider_id,provider_display_name,provider_type,
    provider_version,prompt_version,rubric_version,checked_by_name)
    VALUES($1,'assignment','assignment',$2,'riwi','RIWI','internal','1','1','1','RIWI')""", ids['a'], ids['assignment'])
check(not query('SELECT t.id FROM assignment_responses t WHERE '+condition, cutoff))
check(value('SELECT count(*) FROM evaluations WHERE source_type=$1 AND source_id=$2', 'assignment', ids['assignment']) == 1)

# The repaired current schema serves all four Owner reads locally. Live Safari
# remains a separate acceptance check and is never inferred from this probe.
for path in ('diagnostics', 'assessment-policies', 'knowledge', 'security-signals'):
    response = client.get('/api/riwi/owner/'+path, headers=headers('owner'))
    check(response.status_code == 200)
    check(client.get('/api/riwi/owner/'+path, headers=headers('admin')).status_code == 403)

print(json.dumps({'event': 'done', 'probeKind': 'riwi_assignments', 'checks': checks,
                  'measurements': {'sharedDatabaseTouched': False, 'providerNetworkCalls': 0,
                                   'liveSafariAcceptance': 'pending'}}), flush=True)
