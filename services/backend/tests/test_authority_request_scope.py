"""Identity is fresh per HTTP request and deduplicated within a request."""
import asyncio
import uuid
from starlette.requests import Request
from app import main as core


def test_authority_has_one_query_per_request_even_for_parallel_and_nested_handlers(monkeypatch):
    async def scenario():
        calls=[];identifier=uuid.UUID('11111111-1111-4111-8111-111111111111')
        class Conn:
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def fetchrow(self,sql,*params):
                calls.append(params);await asyncio.sleep(0)
                return {'id':identifier,'role':'student','account_status':'active','auth_version':0}
        class Pool:
            def acquire(self):return Conn()
        async def pool():return Pool()
        monkeypatch.setattr(core,'pool',pool)
        monkeypatch.setattr(core,'verify_token',lambda value:{'sub':str(identifier),'authVersion':0,'sessionKey':'token','expiresAt':9999999999})
        req=Request({'type':'http','method':'GET','path':'/api/test','headers':[]})
        values=await asyncio.gather(core.current_user(req,active=True),core.current_authority(req),core.current_user(req))
        assert len(calls)==1
        assert values[0]['id']==identifier
        nested=Request({**req.scope,'path':'/api/other'})
        await core.current_authority(nested)
        assert len(calls)==1
        another=Request({'type':'http','method':'GET','path':'/api/test','headers':[]})
        await core.current_authority(another)
        assert len(calls)==2,'a later HTTP request must see changed authority'
        core.forget_authority(req);await core.current_authority(req)
        assert len(calls)==3
    asyncio.run(scenario())
