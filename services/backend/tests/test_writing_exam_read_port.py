"""GET /api/writing/exam/{id}, matched to getExamPaper() semantics."""
from datetime import datetime, timezone
from uuid import UUID
from fastapi.testclient import TestClient
from app import main as core
from test_migration_phase2 import FakePool

client = TestClient(core.app)
UID=UUID('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
PAPER='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
NOW=datetime(2026,10,22,12,0,tzinfo=timezone.utc)

class ExamConn:
    def __init__(self):
        self.calls=[]
        self.expired=None
        self.paper={'id': UUID(PAPER),'mode':'full','durationSeconds':3600,
                    'startedAt':NOW,'expiresAt':NOW,'remaining':0,
                    'finalizedAt':None,'finalizeReason':None}
        self.entries=[{'position':1,'taskType':'task1','promptId':UUID(PAPER),
                       'prompt':'Describe a process','category':'process','targetWordCount':150,
                       'content':'Some draft', 'wordCount':2, 'revision':4, 'savedAt':NOW}]
    async def __aenter__(self):return self
    async def __aexit__(self,*exc):return False
    def transaction(self):return self
    async def fetchrow(self, query, *args):
        self.calls.append(('fetchrow',query,args))
        if 'UPDATE writing_exam_papers' in query: return self.expired
        if 'FROM writing_exam_papers' in query: return self.paper
        raise AssertionError(query)
    async def execute(self,query,*args):
        self.calls.append(('execute',query,args))
    async def fetch(self,query,*args):
        self.calls.append(('fetch',query,args))
        if 'UPDATE writing_submissions' in query:
            return [{'id':UUID(PAPER),'user_id':UID}]
        if 'FROM teacher_student_links' in query:
            return []
        return self.entries


def setup(monkeypatch,conn,user=True):
    async def current(req,active=False): return {'id':UID, 'role':'student','account_status':'active'} if user else None
    async def pool():return FakePool(conn)
    monkeypatch.setattr(core,'current_user',current)
    monkeypatch.setattr(core,'pool',pool)


def test_exam_auth_uuid_and_missing(monkeypatch):
    conn=ExamConn(); setup(monkeypatch,conn,user=False)
    r=client.get('/api/writing/exam/'+PAPER)
    assert r.status_code==401 and r.json()=={'error':{'code':'unauthenticated','message':'Sign in again.'}}
    setup(monkeypatch,conn,user=True)
    assert client.get('/api/writing/exam/nonsense').status_code==404
    assert not conn.calls
    conn.paper=None
    r=client.get('/api/writing/exam/'+PAPER)
    assert r.status_code==404
    assert conn.calls[-1][2]==(PAPER, UID)
    assert len(conn.calls)==2  # expiry check and user-owned select, no entries leaked


def test_exam_paper_dates_and_entries(monkeypatch):
    conn=ExamConn(); setup(monkeypatch,conn)
    r=client.get('/api/writing/exam/'+PAPER)
    assert r.status_code==200 and r.headers['cache-control']=='no-store'
    p=r.json()['paper']
    assert p['id']==PAPER and p['mode']=='full'
    assert p['startedAt']=='2026-10-22T12:00:00.000Z'
    assert p['entries'][0]['promptId']==PAPER and p['entries'][0]['savedAt']=='2026-10-22T12:00:00.000Z'
    assert p['entries'][0]['revision']==4
    assert conn.calls[-1][2]==(PAPER,)
    assert 'ORDER BY e.position ASC' in conn.calls[-1][1]


def test_exam_expiry_closes_draft_submissions_and_remaining_zero(monkeypatch):
    conn=ExamConn(); setup(monkeypatch,conn)
    conn.expired={'id':PAPER}
    conn.paper['finalizedAt']=NOW
    conn.paper['finalizeReason']='timeout'
    conn.paper['remaining']=400
    r=client.get('/api/writing/exam/'+PAPER)
    assert r.status_code==200 and r.json()['paper']['remainingSeconds']==0
    assert r.json()['paper']['finalizedAt']=='2026-10-22T12:00:00.000Z'
    queries=[q for op,q,args in conn.calls if op=='fetch' and 'UPDATE writing_submissions' in q]
    assert len(queries)==1 and "status='draft'" in queries[0] and 'RETURNING id,user_id' in queries[0]
    assert 'secs=>15' in conn.calls[0][1]
