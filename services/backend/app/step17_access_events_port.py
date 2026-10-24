"""GET /api/auth/changes -- Postgres LISTEN-backed invalidation SSE.

One subscription per browser stream; the listener does not confer authorization.
"""
import asyncio
import json
import os
import re
import time
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from . import main as core
router=APIRouter()
UUID=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',re.I)


def access_event_user_id(payload):
    if not payload or len(payload)>256:return None
    try:
        value=json.loads(payload)
        uid=value.get('userId') if isinstance(value,dict) else None
        return uid if isinstance(uid,str) and UUID.fullmatch(uid) else None
    except (ValueError,TypeError):return None

@router.get('/api/auth/changes')
async def changes(req:Request):
    dsn=os.environ.get('AUTH_EVENTS_DATABASE_URL','').strip() or os.environ.get('DATABASE_URL','').strip()
    if not dsn:return core.j({'error':'access_events_disabled'},503)
    authority=await core.current_authority(req)
    if not authority or authority['user']['account_status']!='active':return core.j({'error':'unauthenticated'},401)
    async def stream():
        import asyncpg
        loop=asyncio.get_running_loop()
        events=asyncio.Queue(maxsize=16)
        client=None
        def on_notification(_conn,pid,channel,payload):
            if channel=='la_access_changed' and access_event_user_id(payload)==str(authority['user']['id']):
                try:events.put_nowait(True)
                except asyncio.QueueFull:pass
        try:
            client=await asyncpg.connect(dsn,timeout=5)
            await client.add_listener('la_access_changed',on_notification)
            yield b'retry: 5000\n\n'
            yield b'event: access-changed\ndata: {}\n\n'
            while True:
                expiry=authority['expiresAt']-time.time()
                if expiry<=0:
                    yield b'event: access-changed\ndata: {}\n\n'
                    break
                try:
                    await asyncio.wait_for(events.get(),timeout=min(25,expiry))
                    yield b'event: access-changed\ndata: {}\n\n'
                except asyncio.TimeoutError:
                    if authority['expiresAt']<=time.time():
                        yield b'event: access-changed\ndata: {}\n\n'
                        break
                    yield b': keep-alive\n\n'
        except asyncio.CancelledError:
            raise
        except Exception:
            yield b'event: unavailable\ndata: {}\n\n'
        finally:
            if client:
                try:await client.close()
                except Exception:pass
    return StreamingResponse(stream(),media_type='text/event-stream',headers={
        'Cache-Control':'private, no-store, no-transform','X-Accel-Buffering':'no',
        'Content-Type':'text/event-stream; charset=utf-8'})

def install():core.app.include_router(router)
