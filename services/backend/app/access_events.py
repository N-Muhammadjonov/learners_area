"""One bounded PostgreSQL LISTEN connection per Python worker, shared by SSE clients."""
import asyncio
import json
import re
import uuid
import logging
import asyncpg
from .db import connection_settings,connection_mode
from urllib.parse import urlsplit,urlunsplit

UUID=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',re.I)


def listener_settings(dsn):
    # Supavisor transaction clients cannot retain LISTEN state. Its session
    # endpoint uses the same host/credentials on 5432; retain verified TLS.
    parts=urlsplit(dsn)
    if (parts.hostname or '').lower().endswith('.pooler.supabase.com') and parts.port==6543:
        dsn=urlunsplit(parts._replace(netloc=parts.netloc.rsplit(':',1)[0]+':5432'))
    return connection_settings(dsn)

def access_event_user_id(payload):
    if not payload or len(payload)>256:return None
    try:
        value=json.loads(payload);identifier=value.get('userId') if isinstance(value,dict) else None
        return identifier if isinstance(identifier,str) and UUID.fullmatch(identifier) else None
    except (ValueError,TypeError):return None


class AccessChangeBus:
    def __init__(self):
        self.listeners={};self.versions={};self.connection=None;self.connecting=None;self.reconnecting=None

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
                if await self.ready(self.dsn):
                    try:
                        await self.reconcile_versions()
                        return
                    except (OSError,asyncpg.PostgresError,asyncpg.InterfaceError):
                        connection=self.connection;self.connection=None
                        if connection:
                            try:await connection.close()
                            except (OSError,asyncpg.PostgresError,asyncpg.InterfaceError):pass
        finally:self.reconnecting=None

    async def connect(self,dsn):
        connection=None
        try:
            target,tls=listener_settings(dsn)
            connection=await asyncpg.connect(target,timeout=5,command_timeout=20,statement_cache_size=0,ssl=tls)
            await connection.add_listener('la_access_changed',self.notification)
            connection.add_termination_listener(self.lost)
            if not self.listeners:
                await connection.close();return False
            self.connection=connection
            logging.getLogger('uvicorn.error').info('Access-event listener ready: transport=%s verified_tls=%s',
                                                  connection_mode(target),bool(tls and tls.check_hostname))
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

    async def reconcile_versions(self):
        """A recovered LISTEN reads durable epochs and wakes only changed users."""
        connection=self.connection
        if connection is None:raise ConnectionError('LISTEN connection was lost during reconciliation')
        ids=list(self.listeners)
        for offset in range(0,len(ids),500):
            batch=ids[offset:offset+500]
            known=[user_id for user_id in batch if user_id in self.versions]
            current={}
            if known:
                rows=await connection.fetch('''SELECT u.id,u.auth_version,
                    EXISTS(SELECT 1 FROM auth_session_revocations r
                      WHERE r.user_id=u.id AND r.expires_at>NOW()) AS has_revocations
                    FROM users u WHERE u.id=ANY($1::uuid[])''',
                                                 [uuid.UUID(user_id) for user_id in known])
                current={str(row['id']):(row['auth_version'],row.get('has_revocations',False)) for row in rows}
            for user_id in batch:
                version,revoked=current.get(user_id,(None,False))
                if user_id not in self.versions or any(version!=seen for seen in self.versions[user_id].values()) or revoked:
                    self.notify(user_id)

    async def subscribe(self,user_id,dsn,version=None):
        queue=asyncio.Queue(maxsize=16)
        self.dsn=dsn
        self.listeners.setdefault(user_id,set()).add(queue)
        if isinstance(version,int):self.versions.setdefault(user_id,{})[queue]=version
        return queue

    async def unsubscribe(self,user_id,queue):
        bucket=self.listeners.get(user_id)
        if bucket:
            bucket.discard(queue)
            self.versions.get(user_id,{}).pop(queue,None)
            if not bucket:self.listeners.pop(user_id,None);self.versions.pop(user_id,None)
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
