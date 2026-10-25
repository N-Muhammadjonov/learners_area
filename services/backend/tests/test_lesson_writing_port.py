"""HTTP contract checks for the newly translated lesson and writing APIs."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient
from app import main as core
from app.lesson_writing_port import lesson_live, js_length
from test_migration_phase2 import FakePool

client = TestClient(core.app)
UID = UUID('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
LESSON = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'


class FakeQueries:
    async def __aenter__(self): return self
    async def __aexit__(self, *exc): return False
    def __init__(self):
        self.calls = []
        self.lesson = {'publication_state': 'published', 'publish_at': None}
        self.note = None
        self.writing_live = LESSON
        self.typing_rows = []
        self.typing_summary = {'count': 0, 'bestWpm': None, 'bestAccuracy': None}
    async def fetchrow(self, query, *args):
        self.calls.append(('fetchrow', query, args))
        if 'FROM lessons' in query: return self.lesson
        if 'FROM lesson_notes' in query: return self.note
        if 'max(wpm)' in query: return self.typing_summary
        if 'INSERT INTO lesson_notes' in query:
            self.note = {'body': args[2], 'updatedAt': datetime(2026, 10, 22, tzinfo=timezone.utc)}
            return self.note
        raise AssertionError(f'Unexpected fetchrow: {query}')
    async def fetchval(self, query, *args):
        self.calls.append(('fetchval', query, args))
        assert 'deleted-content:' in query and 'w.id::text' in query
        return self.writing_live
    async def fetch(self, query, *args):
        self.calls.append(('fetch', query, args))
        assert 'FROM typing_runs' in query
        return self.typing_rows
    async def execute(self, query, *args):
        self.calls.append(('execute', query, args))


def auth(monkeypatch, db, signed_in=True):
    async def user(req, active=False):
        return {'id': UID, 'account_status': 'active', 'role': 'student'} if signed_in else None
    async def pool(): return FakePool(db)
    monkeypatch.setattr(core, 'current_user', user)
    monkeypatch.setattr(core, 'pool', pool)


def test_note_get_own_only_and_null_fields(monkeypatch):
    db = FakeQueries(); auth(monkeypatch, db)
    result = client.get(f'/api/lessons/{LESSON}/notes')
    assert result.status_code == 200 and result.json() == {'notes': None, 'updatedAt': None}
    db.note = {'body': 'My private note', 'updatedAt': datetime(2026, 10, 22, tzinfo=timezone.utc)}
    result = client.get(f'/api/lessons/{LESSON}/notes')
    assert result.json() == {'notes': 'My private note', 'updatedAt': '2026-10-22T00:00:00.000Z'}
    assert [a for op, q, a in db.calls if op == 'fetchrow' and 'FROM lesson_notes' in q] == [(UID, LESSON), (UID, LESSON)]


def test_note_get_draft_scheduled_and_missing(monkeypatch):
    db = FakeQueries(); auth(monkeypatch, db)
    db.lesson = None
    assert client.get(f'/api/lessons/{LESSON}/notes').status_code == 404
    db.lesson = {'publication_state': 'draft', 'publish_at': None}
    assert client.get(f'/api/lessons/{LESSON}/notes').status_code == 404
    db.lesson = {'publication_state': 'scheduled', 'publish_at': datetime.now(timezone.utc) + timedelta(minutes=10)}
    assert client.get(f'/api/lessons/{LESSON}/notes').status_code == 404
    db.lesson['publish_at'] = datetime.now(timezone.utc) - timedelta(minutes=10)
    assert client.get(f'/api/lessons/{LESSON}/notes').status_code == 200
    assert client.get('/api/lessons/not-a-uuid/notes').status_code == 404


def test_note_post_upsert_and_whitespace_delete(monkeypatch):
    db = FakeQueries(); auth(monkeypatch, db)
    endpoint = f'/api/lessons/{LESSON}/notes'
    r = client.post(endpoint, json={'body': 'Source text', 'extra': 'accepted by Zod default'})
    assert r.status_code == 200 and r.json()['notes'] == 'Source text'
    insert = [v for v in db.calls if v[0] == 'fetchrow' and 'INSERT INTO lesson_notes' in v[1]][0]
    assert insert[2] == (UID, LESSON, 'Source text')
    assert 'ON CONFLICT(user_id,lesson_id)' in insert[1]
    r = client.post(endpoint, json={'notes': '   ', 'body': 'ignored'})
    assert r.status_code == 200 and r.json()['notes'] is None
    delete = [v for v in db.calls if v[0] == 'execute' and 'DELETE FROM lesson_notes' in v[1]][0]
    assert delete[2] == (UID, LESSON)


def test_note_validation_and_not_found_distinction(monkeypatch):
    db = FakeQueries(); auth(monkeypatch, db)
    endpoint = f'/api/lessons/{LESSON}/notes'
    for body in ({}, {'notes': None}, {'body': 2}, {'notes': 'x'*4001}, {'body':'🙌'*2001}):
        assert client.post(endpoint, json=body).json() == {'error': 'invalid_input'}
    assert js_length('🙌'*2001) == 4002
    db.lesson = {'publication_state': 'archived', 'publish_at': None}
    assert client.post(endpoint, json={'notes':'a'}).json() == {'error':'lesson_not_open'}
    assert client.post(endpoint, json={'notes':'a'}).status_code == 403
    db.lesson = None
    assert client.post(endpoint, json={'notes':'a'}).json() == {'error':'lesson_not_found'}
    assert client.post(endpoint, json={'notes':'a'}).status_code == 404


def test_note_anonymous(monkeypatch):
    db = FakeQueries(); auth(monkeypatch, db, signed_in=False)
    assert client.get(f'/api/lessons/{LESSON}/notes').status_code == 401
    assert client.post(f'/api/lessons/{LESSON}/notes', json={'notes':'x'}).status_code == 401
    assert not db.calls


def test_saved_pattern_add_remove_and_authorization(monkeypatch):
    db = FakeQueries(); auth(monkeypatch, db)
    endpoint = f'/api/writing/patterns/{LESSON}'
    for b in ({}, {'saved':1}, {'saved':'true'}, {'saved':True,'extra':5}):
        assert client.put(endpoint, json=b).status_code == 400
    assert client.put('/api/writing/patterns/invalid', json={'saved':True}).status_code == 400
    r = client.put(endpoint, json={'saved':True})
    assert r.json() == {'ok':True,'saved':True}
    assert any('INSERT INTO writing_pattern_bank' in sql and args==(UID,LESSON)
               for op,sql,args in db.calls if op=='execute')
    r = client.put(endpoint, json={'saved':False})
    assert r.json() == {'ok':True,'saved':False}
    assert any('DELETE FROM writing_pattern_bank' in sql and args==(UID,LESSON)
               for op,sql,args in db.calls if op=='execute')
    db.writing_live=None
    assert client.put(endpoint, json={'saved':True}).status_code==404


def test_writing_lessons_status_and_soft_deletion(monkeypatch):
    db = FakeQueries(); auth(monkeypatch, db)
    endpoint = f'/api/writing/lessons/{LESSON}'
    assert client.post('/api/writing/lessons/nope').status_code==404
    assert client.post(endpoint).json() == {'ok':True}
    find = [x for x in db.calls if x[0]=='fetchval'][-1]
    assert 'writing_lessons w' in find[1]
    assert 'deleted-content:' in find[1] and 'scheduled' in find[1]
    assert any('INSERT INTO writing_lesson_progress' in q and args == (UID, LESSON)
               for op,q,args in db.calls if op=='execute')
    db.writing_live=None
    assert client.post(endpoint).status_code==404


def test_writing_error_schemas_for_anonymous(monkeypatch):
    db = FakeQueries(); auth(monkeypatch, db, signed_in=False)
    for method,path in [('put',f'/api/writing/patterns/{LESSON}'),('post',f'/api/writing/lessons/{LESSON}')]:
        r = getattr(client,method)(path)
        assert r.status_code==401 and r.json()=={'error':{'code':'unauthenticated','message':'Sign in again.'}}
    assert client.post('/api/writing/lessons/notuuid').status_code==404
    assert not db.calls


def test_typing_summary_empty_and_all_user_scoped(monkeypatch):
    db = FakeQueries(); auth(monkeypatch, db)
    result = client.get('/api/writing/typing')
    assert result.status_code == 200
    assert result.json() == {'summary':{'count':0,'bestWpm':None,'bestAccuracy':None},'runs':[]}
    assert all(args == (UID,) for _,_,args in db.calls)


def test_typing_numeric_and_date_shape(monkeypatch):
    db = FakeQueries(); auth(monkeypatch, db)
    db.typing_summary={'count':2,'bestWpm':'61.2','bestAccuracy':'99.9'}
    db.typing_rows=[{'id':UUID(LESSON),'userId':UID,'targetChars':100,'typedChars':95,'durationMs':60000,
                    'wpm':'42.1','accuracy':'97.0','runTokenId':None,'rawWpm':'45.2','consistency':None,
                    'charsCorrect':91,'charsIncorrect':3,'charsExtra':0,'charsMissed':6,'startedAt':None,
                    'finishedAt':None,'createdAt':datetime(2026,10,22,tzinfo=timezone.utc)}]
    result=client.get('/api/writing/typing').json()
    assert result['summary']=={'count':2,'bestWpm':61.2,'bestAccuracy':99.9}
    assert result['runs'][0]['wpm']==42.1 and result['runs'][0]['accuracy']==97.0
    assert result['runs'][0]['rawWpm']=='45.2'
    assert result['runs'][0]['createdAt']=='2026-10-22T00:00:00.000Z'
    assert db.calls[1][2]==(UID,)
