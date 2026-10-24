"""Shared LISTEN capacity and user isolation, with actual async bus lifecycles."""
import asyncio
from app import main
from app.access_events import AccessChangeBus
from app import access_events


def test_many_subscribers_share_one_listen_connection_and_close_after_the_last(monkeypatch):
    async def scenario():
        connections=[]
        class Client:
            async def add_listener(self,channel,callback):self.callback=callback;assert channel=='la_access_changed'
            def add_termination_listener(self,callback):self.terminated=callback
            async def close(self):self.closed=True
        async def connect(*args,**kwargs):
            await asyncio.sleep(0)
            client=Client();client.closed=False;connections.append(client);return client
        monkeypatch.setattr(access_events.asyncpg,'connect',connect)
        bus=AccessChangeBus();a='11111111-1111-4111-8111-111111111111';b='22222222-2222-4222-8222-222222222222'
        first=await bus.subscribe(a,'postgresql://fake');second=await bus.subscribe(a,'postgresql://fake');other=await bus.subscribe(b,'postgresql://fake')
        assert all(await asyncio.gather(*(bus.ready('postgresql://fake') for _ in range(20))))
        assert len(connections)==1
        bus.notification(connections[0],1,'la_access_changed','{"userId":"'+a+'"}')
        assert first.qsize()==second.qsize()==1 and other.empty()
        for _ in range(100):bus.notification(connections[0],1,'la_access_changed','{"userId":"'+a+'"}')
        assert first.qsize()==16, 'slow browser queues stay bounded'
        await bus.unsubscribe(a,first);await bus.unsubscribe(a,second)
        assert not connections[0].closed
        await bus.unsubscribe(b,other)
        assert connections[0].closed and not bus.listeners
    asyncio.run(scenario())


def test_failed_connection_is_shared_and_does_not_leak_subscription_state(monkeypatch):
    async def scenario():
        calls=[]
        async def connect(*args,**kwargs):calls.append(1);await asyncio.sleep(0);raise OSError('offline')
        monkeypatch.setattr(access_events.asyncpg,'connect',connect)
        bus=AccessChangeBus();queue=await bus.subscribe('learner','postgresql://fake')
        result=await asyncio.gather(*(bus.ready('postgresql://fake') for _ in range(8)))
        assert result==[False]*8 and len(calls)==1
        await bus.unsubscribe('learner',queue)
        assert not bus.listeners and bus.connecting is None
    asyncio.run(scenario())
