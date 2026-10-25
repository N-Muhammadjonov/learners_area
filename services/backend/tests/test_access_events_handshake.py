"""Drive the SSE iterator, including the authorization gap around LISTEN."""
import asyncio
import time
from starlette.requests import Request
from app import main as core
from app import step17_access_events_port as endpoint


def test_stream_ready_and_targeted_hint_do_not_requery_identity(monkeypatch):
    async def scenario():
        queue=asyncio.Queue();calls=[];unsubscribed=[]
        authority={'user':{'id':'11111111-1111-4111-8111-111111111111','account_status':'active'},'authVersion':3,'expiresAt':time.time()+500}
        async def current(req):calls.append('identity');return authority
        class Bus:
            async def subscribe(self,user,dsn,version):calls.append(('listen',user,version));return queue
            async def ready(self,dsn):return True
            async def unsubscribe(self,user,events):unsubscribed.append((user,events))
        monkeypatch.setenv('AUTH_EVENTS_DATABASE_URL','postgresql://fixture')
        monkeypatch.setattr(endpoint,'bus',Bus());monkeypatch.setattr(endpoint.core,'current_authority',current)
        monkeypatch.setattr(endpoint.core,'forget_authority',lambda req:calls.append('forget'))
        req=Request({'type':'http','method':'GET','path':'/api/auth/changes','headers':[]})
        response=await endpoint.changes(req);stream=response.body_iterator
        assert await anext(stream)==b'retry: 5000\n\n'
        assert await anext(stream)==b'event: ready\ndata: {}\n\n'
        assert calls==['identity',('listen',str(authority['user']['id']),3),'forget','identity']
        queue.put_nowait(True)
        assert await anext(stream)==b'event: access-changed\ndata: {}\n\n'
        assert calls.count('identity')==2
        await stream.aclose();assert len(unsubscribed)==1
    asyncio.run(scenario())


def test_revocation_between_login_snapshot_and_listen_cannot_emit_ready(monkeypatch):
    async def scenario():
        checks=iter([{'user':{'id':'11111111-1111-4111-8111-111111111111','account_status':'active'},'authVersion':3,'expiresAt':time.time()+500},None]);closed=[]
        async def current(req):return next(checks)
        class Bus:
            async def subscribe(self,*args):return asyncio.Queue()
            async def ready(self,dsn):return True
            async def unsubscribe(self,*args):closed.append(True)
        monkeypatch.setenv('AUTH_EVENTS_DATABASE_URL','postgresql://fixture')
        monkeypatch.setattr(endpoint,'bus',Bus());monkeypatch.setattr(endpoint.core,'current_authority',current);monkeypatch.setattr(endpoint.core,'forget_authority',lambda req:None)
        response=await endpoint.changes(Request({'type':'http','method':'GET','path':'/api/auth/changes','headers':[]}))
        chunks=[chunk async for chunk in response.body_iterator]
        assert chunks==[b'retry: 5000\n\n',b'event: session-revoked\ndata: {}\n\n']
        assert closed==[True]
    asyncio.run(scenario())
