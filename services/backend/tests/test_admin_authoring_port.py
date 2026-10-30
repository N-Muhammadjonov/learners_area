"""HTTP/SQL contract tests for the next translated admin-authoring routes.
All connections are in-memory doubles; never connect to the source PostgreSQL.
"""
import uuid
from fastapi.testclient import TestClient
from app import main as core
from app.admin_authoring_port import _valid_url
from test_migration_phase2 import Conn, FakePool

client=TestClient(core.app)
UID=uuid.UUID('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
PASS=uuid.UUID('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')


def auth(monkeypatch,conn,role='admin'):
    async def user(req,active=False): return {'id':UID,'role':role,'account_status':'active'}
    async def pool():return FakePool(conn)
    monkeypatch.setattr(core,'current_user',user)
    monkeypatch.setattr(core,'pool',pool)


class AuthoringConn(Conn):
    def __init__(self):
        super().__init__()
        self.values={}
        self.rows={}
    async def fetchval(self,sql,*args):
        self.calls.append(('fetchval',sql,args))
        if 'FROM grammar_topics ' in sql:return self.values.get('topic',PASS)
        if 'FROM writing_submissions' in sql:return self.values.get('submission',PASS)
        if 'FROM grammar_exercises' in sql:return self.values.get('exercises',2)
        if 'FROM reading_passages' in sql:return self.values.get('editable',True)
        if 'FROM reading_questions' in sql:return self.values.get('reading_count',2)
        if 'FROM listening_tests ' in sql:return self.values.get('publication','draft')
        if 'FROM listening_questions' in sql:return self.values.get('listening_count',4)
        return None
    async def fetchrow(self,sql,*args):
        self.calls.append(('fetchrow',sql,args))
        if 'FROM upload_intents' in sql:return self.rows.get('upload')
        return {'id':PASS}


def test_validation_and_staff_permissions(monkeypatch):
    conn=AuthoringConn()
    auth(monkeypatch,conn,role='student')
    for path in ('/api/admin/grammar/topics/'+str(PASS)+'/exercises',
                 '/api/admin/reading/passages/'+str(PASS)+'/questions',
                 '/api/admin/listening/tests/'+str(PASS)+'/questions',
                 '/api/admin/listening/tests'):
        assert client.post(path,json={}).status_code==403,path
    auth(monkeypatch,conn,role='teacher')
    assert client.post('/api/admin/grammar/topics/'+str(PASS)+'/exercises',json={}).status_code==403
    assert client.post('/api/admin/reading/passages/'+str(PASS)+'/questions',json={}).status_code==403
    assert client.post('/api/admin/listening/tests/'+str(PASS)+'/questions',json={}).status_code==400
    assert client.post('/api/admin/listening/tests',json={}).status_code==400
    for path in ('/api/admin/grammar/topics/not-uuid/exercises',
                 '/api/admin/reading/passages/not-uuid/questions',
                 '/api/admin/listening/tests/not-uuid/questions'):
        assert client.post(path,json={}).status_code==404


def test_grammar_options_and_database_order(monkeypatch):
    conn=AuthoringConn();auth(monkeypatch,conn)
    path='/api/admin/grammar/topics/'+str(PASS)+'/exercises'
    body={'promptText':'Select a word','options':['a','b'], 'correctOption':'z', 'explanation':'Because it is'}
    assert client.post(path,json=body).json()=={'error':'correct_option_must_be_one_of_options'}
    body['correctOption']='a'
    r=client.post(path,json=body)
    assert r.status_code==200 and r.json()=={'ok':True,'id':str(PASS)}
    insert=[c for c in conn.calls if c[0]=='fetchrow' and 'INSERT INTO grammar_exercises' in c[1]][0]
    assert insert[2][1]==3 and insert[2][3]=='["a", "b"]'
    conn.values['topic']=None
    assert client.post(path,json=body).status_code==404
    conn.values['topic']=PASS
    body['sourceSubmissionId']=str(PASS)
    conn.values['submission']=None
    assert client.post(path,json=body).json()=={'error':'source_not_found'}


def test_reading_draft_guard_and_question_parity(monkeypatch):
    conn=AuthoringConn();auth(monkeypatch,conn)
    path='/api/admin/reading/passages/'+str(PASS)+'/questions'
    body={'type':'multiple_choice','questionText':'What is the right answer?',
          'correctAnswer':'A','explanation':'It is A','options':['A','B']}
    conn.values['editable']=False
    assert client.post(path,json=body).json()=={'error':'revision_managed'}
    conn.values['editable']=True
    r=client.post(path,json=body)
    assert r.status_code==200 and r.json()['id']==str(PASS)
    insert=[c for c in conn.calls if c[0]=='fetchrow' and 'INSERT INTO reading_questions' in c[1]][0]
    assert insert[2][1]==3
    assert client.post(path,json={**body,'options':['only one']}).json()['error']=='multiple_choice needs at least 2 options'


def test_listening_question_and_published_guard(monkeypatch):
    conn=AuthoringConn();auth(monkeypatch,conn,role='teacher')
    path='/api/admin/listening/tests/'+str(PASS)+'/questions'
    body={'type':'short_answer','questionText':'What is the best answer?',
          'correctAnswer':'answer','explanation':'Reason'}
    conn.values['publication']='published'
    assert client.post(path,json=body).json()=={'error':'revision_managed'}
    conn.values['publication']=None
    assert client.post(path,json=body).status_code==404
    conn.values['publication']='draft'
    r=client.post(path,json=body)
    assert r.status_code==200 and r.json()=={'ok':True,'id':str(PASS)}
    insert=[c for c in conn.calls if c[0]=='fetchrow' and 'INSERT INTO listening_questions' in c[1]][0]
    assert insert[2][1]==5


def test_listening_test_creation_validation_and_draft(monkeypatch):
    conn=AuthoringConn();auth(monkeypatch,conn,role='teacher')
    path='/api/admin/listening/tests'
    body={'title':'Practice test','audioType':'audio',
          'difficultyLevel':'B2','audioUrl':'https://example.com/lesson.mp3'}
    assert client.post(path,json={**body,'audioUploadId':str(PASS)}).status_code==400
    assert client.post(path,json={**body,'audioUrl':'broken'}).status_code==400
    assert _valid_url('https://example.com/lesson.mp3') is True
    assert _valid_url('not-a-url') is False
    r=client.post(path,json=body)
    assert r.status_code==201 and r.json()=={'ok':True,'id':str(PASS)}
    insert=[c for c in conn.calls if c[0]=='fetchrow' and 'INSERT INTO listening_tests' in c[1]][0]
    assert 'draft' in insert[1] and insert[2][3]=='https://example.com/lesson.mp3'


def test_listening_upload_must_belong_and_attach(monkeypatch):
    conn=AuthoringConn();auth(monkeypatch,conn,role='teacher')
    path='/api/admin/listening/tests'
    body={'title':'Practice test','audioType':'file','difficultyLevel':'B2','audioUploadId':str(PASS)}
    assert client.post(path,json=body).json()=={'error':'upload_not_owned_or_finalized'}
    conn.rows['upload']={'id':PASS,'user_id':UID,'status':'finalized','used_at':None,
                         'purpose':'material_primary','mime_type':'audio/mpeg',
                         'object_key':'audio/test.mp3','original_name':'test.mp3','size':1234}
    r=client.post(path,json=body)
    assert r.status_code==201 and r.json()['ok'] is True
    sql=[call[1] for call in conn.calls]
    assert any('INSERT INTO resource_blocks' in s for s in sql)
    assert any("status='attached'" in s for s in sql)
