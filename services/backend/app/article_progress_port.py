"""Private, account-scoped completion markers for reading articles."""
from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

if TYPE_CHECKING:
    from .frontend_static import StaticFrontend

router = APIRouter()
frontend: StaticFrontend | None = None
EVENT_TYPE = 'READING_ARTICLE_COMPLETIONS'
PRIVATE = {'Cache-Control': 'private, no-store'}
ARTICLE_PATH = re.compile(r'^modules/reading/article-assets/([a-z0-9-]+)\.html$')


def article_ids() -> set[str] | None:
    global frontend
    if frontend is None:
        from .frontend_static import StaticFrontend
        frontend = StaticFrontend()
    build = frontend.build()
    if not build:
        return None
    return {match.group(1) for path in build[1]['files'] if (match := ARTICLE_PATH.fullmatch(path))}


def progress_id(user_id: UUID | str) -> UUID:
    return uuid5(NAMESPACE_URL, f'learners-area:reading-article-completions:{user_id}')


@router.get('/api/reading/articles/progress')
async def get_progress(req: Request) -> JSONResponse:
    from . import main as core
    user = await core.current_user(req, active=True)
    if not user:
        return core.j({'error': 'unauthenticated'}, 401, PRIVATE)
    allowed = article_ids()
    if allowed is None:
        return core.j({'error': 'frontend_build_missing'}, 503, PRIVATE)
    db = await core.pool()
    async with db.acquire() as con:
        payload = await con.fetchval('SELECT payload FROM activity_events WHERE id=$1 AND user_id=$2 AND type=$3', progress_id(user['id']), user['id'], EVENT_TYPE)
    if isinstance(payload, str):
        payload = json.loads(payload)
    payload = payload if isinstance(payload, dict) else {}
    return core.j({'completed': sorted(key for key, value in payload.items() if key in allowed and value is True)}, headers=PRIVATE)


@router.post('/api/reading/articles/{article_id}/complete')
async def complete_article(req: Request, article_id: str) -> JSONResponse:
    from . import main as core
    user = await core.current_user(req, active=True)
    if not user:
        return core.j({'error': 'unauthenticated'}, 401, PRIVATE)
    allowed = article_ids()
    if allowed is None:
        return core.j({'error': 'frontend_build_missing'}, 503, PRIVATE)
    if article_id not in allowed:
        return core.j({'error': 'not_found'}, 404, PRIVATE)
    db = await core.pool()
    async with db.acquire() as con:
        await con.execute('''INSERT INTO activity_events(id,user_id,type,payload) VALUES($1,$2,$3,jsonb_build_object($4::text,true))
          ON CONFLICT(id) DO UPDATE SET payload=coalesce(activity_events.payload,'{}'::jsonb) || excluded.payload
          WHERE activity_events.user_id=excluded.user_id AND activity_events.type=excluded.type''', progress_id(user['id']), user['id'], EVENT_TYPE, article_id)
    return core.j({'ok': True}, headers=PRIVATE)


def install() -> None:
    from . import main as core
    core.app.include_router(router)
