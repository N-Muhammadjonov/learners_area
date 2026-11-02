from fastapi.testclient import TestClient
from app import main as core
from app.exam_lifecycle_port import count_essay_words
from test_migration_phase2 import FakePool
from uuid import UUID

C=TestClient(core.app)
UID=UUID('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
P='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
class Conn:
 def __init__(self):self.calls=[];self.row=None;self.updated=None;self.closed=None
 async def __aenter__(self):return self
 async def __aexit__(self,*ex):return False
 def transaction(self):return self
 async def fetchrow(self,q,*args):
  self.calls.append(('fetchrow',q,args))
  if 'FROM writing_exam_paper_entries' in q:return self.row
  if 'UPDATE writing_exam_paper_entries' in q:return self.updated
  if 'UPDATE writing_exam_papers' in q:return self.closed
  if 'SELECT id,mode FROM writing_exam_papers' in q:return None
  if 'FROM writing_exam_papers' in q:return None
  raise AssertionError(q)
 async def execute(self,q,*args):self.calls.append(('execute',q,args))
 async def fetchval(self,q,*args):
  self.calls.append(('fetchval',q,args))
  if 'SELECT content FROM writing_submissions' in q:return 'Hi there'
  if 'FROM writing_prompts' in q:return None
  return None

def setup(monkeypatch,conn,user=True):
 async def current(req,active=False):return {'id':UID,'role':'student','account_status':'active'} if user else None
 async def db():return FakePool(conn)
 monkeypatch.setattr(core,'current_user',current)
 monkeypatch.setattr(core,'pool',db)

def test_exam_start_auth_validation_no_prompts(monkeypatch):
 co=Conn();setup(monkeypatch,co,False)
 assert C.post('/api/writing/exam',json={'mode':'full'}).status_code==401
 setup(monkeypatch,co)
 assert C.post('/api/writing/exam',json={'mode':'oops'}).status_code==400
 r=C.post('/api/writing/exam',json={'mode':'task1'})
 assert r.status_code==404 and r.json()=={'error':{'code':'no_prompts','message':'No published questions for this task.','retryable':False}}
 assert 'random()' in str(co.calls[-1])

def test_exam_draft_auth_validation_stale_and_write(monkeypatch):
 co=Conn();setup(monkeypatch,co)
 assert C.put('/api/writing/exam/bad/draft',json={}).status_code==404
 assert C.put('/api/writing/exam/'+P+'/draft',json={'position':1,'content':'Hi','revision':True}).status_code==400
 co.row={'submissionId':P,'current':5,'finalizedAt':None,'open':True}
 r=C.put('/api/writing/exam/'+P+'/draft',json={'position':1,'content':'Hi there','revision':6})
 assert r.status_code==200 and r.json()['stale'] is True
 co.updated={'saved_at':__import__('datetime').datetime(2026,10,22,tzinfo=__import__('datetime').timezone.utc)}
 r=C.put('/api/writing/exam/'+P+'/draft',json={'position':1,'content':'Hi there','revision':6})
 assert r.status_code==200 and r.json()['stale'] is False
 assert any('word_count' in q and args[-1]==2 for op,q,args in co.calls if op=='execute')

def test_exam_finalize_validation_and_unauth(monkeypatch):
 co=Conn();setup(monkeypatch,co,False)
 assert C.post('/api/writing/exam/'+P+'/finalize',json={'reason':'submitted'}).status_code==401
 setup(monkeypatch,co)
 assert C.post('/api/writing/exam/'+P+'/finalize',json={'reason':'timeout'}).status_code==400
 assert count_essay_words('  word one\n two  ')==3
