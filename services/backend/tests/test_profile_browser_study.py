"""Self-only profile projection, exact date/band values and verified contact privacy."""
import asyncio
from datetime import datetime,timezone
from app import main as core
from app.browser_reads import read_view


def test_profile_projection_uses_authorised_user_and_hides_unverified_phone(monkeypatch):
    calls=[]
    class Conn:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def fetchrow(self,sql,*args):
            calls.append((sql,args))
            if 'onboarding_profiles' in sql:return {'current_level':'B2','current_band':6.5,'target_band':8,'exam_date':datetime(2027,3,4,tzinfo=timezone.utc),'daily_study_minutes':90,'strongest_skill':'listening','weakest_skill':'writing'}
            assert 't.telegram_user_id' in sql
            return {'telegram_id':'123','username':'student','phone_number':'+998secret','phone_verified_at':None}
    class Pool:
        def acquire(self):return Conn()
    async def pool():return Pool()
    monkeypatch.setattr(core,'pool',pool)
    result=asyncio.run(read_view(None,{'id':'authorised-id'},'/app/profile','user=another-id',None))['profile']
    assert all(args==('authorised-id',) for _,args in calls)
    assert result['study']['examDate']=='2027-03-04' and result['study']['currentBand']==6.5
    assert result['telegram']=={'linked':True,'username':'student','phone':None}
