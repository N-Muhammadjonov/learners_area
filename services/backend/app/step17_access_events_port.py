"""GET /api/auth/changes -- Postgres LISTEN-backed invalidation SSE.

One subscription per browser stream; the listener does not confer authorization.
"""
import asyncio
import os
import time
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from . import main as core
router=APIRouter()
from .access_events import bus, access_event_user_id

@router.get('/api/auth/changes')
async def changes(req:Request):
    dsn=os.environ.get('AUTH_EVENTS_DATABASE_URL','').strip() or os.environ.get('DATABASE_URL','').strip()
    if not dsn:return core.j({'error':'access_events_disabled'},503)
    authority=await core.current_authority(req)
    if not authority or authority['user']['account_status']!='active':return core.j({'error':'unauthenticated'},401)
    async def stream():
        user_id=str(authority['user']['id'])
        events=await bus.subscribe(user_id,dsn)
        try:
            yield b'retry: 5000\n\n'
            if not await bus.ready(dsn):
                yield b'event: unavailable\ndata: {}\n\n'
                return
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
        finally:
            await bus.unsubscribe(user_id,events)
    return StreamingResponse(stream(),media_type='text/event-stream',headers={
        'Cache-Control':'private, no-store, no-transform','X-Accel-Buffering':'no',
        'Content-Type':'text/event-stream; charset=utf-8'})

def install():core.app.include_router(router)
