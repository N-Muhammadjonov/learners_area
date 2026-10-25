"""Owner policy: read-only preview, lock contention, UTC month clamp, fixed safe tables."""
from datetime import datetime,timezone
from uuid import UUID
from fastapi.testclient import TestClient
import pytest
from app import main as core
from app.step27_retention_policy import months_ago,config,run_policy,OLD_WORK

UID='11111111-1111-4111-8111-111111111111'

def test_calendar_month_clamp_and_fixed_work_tables():
    assert months_ago(1,datetime(2024,3,31,8,0,tzinfo=timezone.utc)).isoformat()=='2024-02-29T08:00:00+00:00'
    assert months_ago(1,datetime(2025,3,31,8,0,tzinfo=timezone.utc)).day==28
    assert 'users' not in {t[0] for t in OLD_WORK}
    assert len(OLD_WORK)==9
    assert config()['batchSize']<=5000

class DummyCon:
    def __init__(self,got=True):self.got=got;self.writes=[];self.reads=[]
    async def fetchval(self,q,*a):
        self.reads.append(q)
        return self.got if 'pg_try_advisory' in q else 0
    async def fetch(self,q,*a):
        self.reads.append(q)
        return []
    async def execute(self,q,*a):
        self.writes.append(q)
        raise AssertionError('preview and contention do not write')

@pytest.mark.asyncio
async def test_preview_is_read_only_and_contract_is_exact():
    con=DummyCon()
    out=await run_policy(con,True,UID,datetime(2026,10,23,tzinfo=timezone.utc))
    assert con.writes==[]
    assert out['dryRun'] is True and out['locked'] is True
    assert [x['rule'] for x in out['results']]==[
     'learning_history','read_notifications','abandoned_uploads','structured_evaluations',
     'speaking_recordings','evaluated_work_past_window','audit_history','generated_exports',
     'applicant_free_text','inactive_student_accounts']
    assert all(x['applied'] is False for x in out['results'])

@pytest.mark.asyncio
async def test_lock_contention_does_not_delete():
    con=DummyCon(False)
    out=await run_policy(con,False,UID)
    assert not con.writes
    assert out['results']==[{'rule':'run','affected':0,'applied':False,'note':'another retention run holds the lock'}]

def test_non_owner_is_forbidden_before_database(monkeypatch):
    async def student(*a,**k):return {'id':UUID(UID),'role':'student'}
    async def pool():raise AssertionError('forbidden should precede database access')
    monkeypatch.setattr(core,'pool',pool)
    monkeypatch.setattr(core,'current_user',student)
    r=TestClient(core.app).post('/api/owner/retention',json={'dryRun':False})
    assert r.status_code==403 and r.json()=={'error':'forbidden'}
