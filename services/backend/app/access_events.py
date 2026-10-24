"""One bounded PostgreSQL LISTEN connection per Python worker, shared by SSE clients."""
import asyncio
import json
import re
import asyncpg
from .db import connection_settings

UUID=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',re.I)

def access_event_user_id(payload):
    if not payload or len(payload)>256:return None
    try:
        value=json.loads(payload);identifier=value.get('userId') if isinstance(value,dict) else None
        return identifier if isinstance(identifier,str) and UUID.fullmatch(identifier) else None
    except (ValueError,TypeError):return None


class AccessChangeBus:
    def __init__(self):
        self.listeners={};self.connection=None;self.connecting=None;self.reconnecting=None

    def notify(self,user_id=None):
        targets=self.listeners.values() if user_id is None else [self.listeners.get(user_id,set())]
        for queues in targets:
            for queue in queues:
                try:queue.put_nowait(True)
                except asyncio.QueueFull:pass

    def notification(self,connection,pid,channel,payload):
        identifier=access_event_user_id(payload)
        if channel=='la_access_changed' and identifier:self.notify(identifier)

    def lost(self,connection):
        if self.connection is not connection:return
        self.connection=None
        if self.listeners and (self.reconnecting is None or self.reconnecting.done()):
            self.reconnecting=asyncio.create_task(self.reconnect())

    async def reconnect(self):
        try:
            while self.listeners and not self.connection:
                await asyncio.sleep(5)
                if await self.ready(self.dsn):self.notify();return
        finally:self.reconnecting=None

    async def connect(self,dsn):
        connection=None
        try:
            target,tls=connection_settings(dsn)
            connection=await asyncpg.connect(target,timeout=5,ssl=tls)
            await connection.add_listener('la_access_changed',self.notification)
            connection.add_termination_listener(self.lost)
            if not self.listeners:
                await connection.close();return False
            self.connection=connection
            return True
        except asyncio.CancelledError:
            if connection:await connection.close()
            raise
        except Exception:
            if connection:
                try:await connection.close()
                except Exception:pass
            return False

    async def ready(self,dsn):
        if self.connection:return True
        if self.connecting is None:self.connecting=asyncio.create_task(self.connect(dsn))
        task=self.connecting
        try:return await asyncio.shield(task)
        finally:
            if task.done() and self.connecting is task:self.connecting=None

    async def subscribe(self,user_id,dsn):
        queue=asyncio.Queue(maxsize=16)
        self.dsn=dsn
        self.listeners.setdefault(user_id,set()).add(queue)
        return queue

    async def unsubscribe(self,user_id,queue):
        bucket=self.listeners.get(user_id)
        if bucket:
            bucket.discard(queue)
            if not bucket:self.listeners.pop(user_id,None)
        if not self.listeners:await self.close()

    async def close(self):
        for task in (self.reconnecting,self.connecting):
            if task and task is not asyncio.current_task():
                task.cancel()
                try:await task
                except (asyncio.CancelledError,Exception):pass
        self.reconnecting=None;self.connecting=None
        connection=self.connection;self.connection=None
        if connection:
            try:await connection.close()
            except Exception:pass


bus=AccessChangeBus()
