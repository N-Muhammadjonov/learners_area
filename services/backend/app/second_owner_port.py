"""Revocable, link-only access for a learner who can inspect management data."""
from __future__ import annotations

import hashlib
import json
import re
import secrets
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from . import main as core
from .rate_limit import async_counter, client_key, too_many
from .security import SESSION_COOKIE, issue_token, write_cookie
from .step26_owner_handover import audit

router = APIRouter()
INVITE_TTL_SECONDS = 20 * 60
SESSION_TTL_SECONDS = 24 * 60 * 60
TOKEN_PATTERN = re.compile(r'[A-Za-z0-9_-]{43}')
SEGMENT = r'[^/]+'
ATTEMPT_WRITES = {
    'POST': re.compile('|'.join((
        r'/api/auth/(?:logout|second-owner/redeem)',
        r'/api/(?:locale|theme)',
        # Standard Speaking uploads authorize the purpose and owned attempt in their handlers.
        r'/api/uploads(?:/intent|/finalize)?',
        r'/api/(?:listening|reading|speaking)/attempts',
        rf'/api/(?:listening|reading|speaking)/attempts/{SEGMENT}/submit',
        rf'/api/listening/full/{SEGMENT}/(?:start|study|practice|activity|progress)',
        r'/api/reading/(?:academic|general/progress)',
        r'/api/retention/attempts',
        rf'/api/retention/attempts/{SEGMENT}/(?:finish-reading|submit)',
        rf'/api/reading/articles/{SEGMENT}/complete',
        rf'/api/grammar/topics/{SEGMENT}/submit',
        rf'/api/grammar/exercises/{SEGMENT}/(?:practice|produce)',
        rf'/api/speaking/attempts/{SEGMENT}/transcript',
        r'/api/writing/(?:exam|submissions|typing|grade|activation/check)',
        rf'/api/writing/grade/{SEGMENT}',
        rf'/api/writing/(?:exam/{SEGMENT}/finalize|submissions/{SEGMENT}/submit)',
        r'/api/writing/typing/(?:prepare|start|pause|resume|finish)',
        rf'/api/mocks/{SEGMENT}/attempts',
        rf'/api/mocks/attempts/{SEGMENT}/listening/playback',
        rf'/api/mocks/attempts/{SEGMENT}/sections/(?:listening|reading|writing|speaking)/submit',
        rf'/api/mocks/attempts/{SEGMENT}/speaking/(?:responses|upload-intent|upload-finalize)',
    ))),
    'PUT': re.compile('|'.join((
        rf'/api/listening/(?:attempts/{SEGMENT}/draft|full/{SEGMENT}/authored-state)',
        rf'/api/writing/exam/{SEGMENT}/draft',
        rf'/api/mocks/attempts/{SEGMENT}/sections/(?:listening|reading|writing|speaking)/draft',
        rf'/api/mocks/attempts/{SEGMENT}/speaking/uploads/{SEGMENT}',
    ))),
    'PATCH': re.compile(
        rf'/api/(?:reading/attempts|speaking/attempts|writing/submissions)/{SEGMENT}'
        rf'|/api/retention/attempts/{SEGMENT}/draft'
    ),
}

# These projections deliberately exclude credentials, contact details and private payloads.
# The SQL sources and expressions are fixed server literals.
INSPECTION_VIEWS: dict[str, tuple[str, str, str]] = {
    'people': ('users', 'name', "role::text || ' · ' || account_status::text"),
    'courses': ('courses', 'title', "''::text"),
    'groups': ('academy_groups', 'name', 'status'),
    'materials': ('speaking_materials', 'title', 'primary_type::text'),
    'assignments': ('assignments', 'title', 'status::text'),
    'classes': ('live_classes', 'title', 'status::text'),
    'listening': ('listening_tests', 'title', 'difficulty_level'),
    'reading': ('reading_passages', 'title', 'difficulty_level'),
    'writing': ('writing_prompts', 'left(prompt, 240)', 'task_type::text'),
    'speaking': ('speaking_prompts', 'left(prompt_text, 240)', 'part::text'),
    'grammar': ('grammar_topics', 'title', 'skill_area::text'),
    'video': ('video_lessons', 'title', 'provider'),
    'mocks': ('mock_tests', 'title', 'skill'),
}


def observer_write_allowed(method: str, path: str) -> bool:
    pattern = ATTEMPT_WRITES.get(method)
    return pattern is not None and pattern.fullmatch(path) is not None


def grant_status(row: asyncpg.Record | None) -> dict[str, str | None]:
    now = datetime.now(UTC)

    def live_until(column: str) -> str | None:
        until = row[column] if row is not None else None
        return until.isoformat() if until is not None and until > now else None

    return {
        'inviteExpiresAt': live_until('invite_expires_at'),
        'sessionExpiresAt': live_until('session_expires_at') if row and row['learner_id'] else None,
    }


async def require_primary_owner(req: Request) -> dict[str, Any]:
    authority = await core.current_authority(req)
    if not authority:
        raise HTTPException(401, 'unauthenticated')
    actor = authority['user']
    if actor['role'] != 'owner' or actor['account_status'] != 'active':
        raise HTTPException(403, 'forbidden')
    return actor


async def lock_owner(conn: asyncpg.Connection, owner_id: UUID, auth_version: int) -> bool:
    return bool(await conn.fetchval("""
        SELECT 1 FROM users
        WHERE id = $1 AND role = 'owner' AND account_status = 'active'
          AND auth_version = $2
        FOR UPDATE
    """, owner_id, auth_version))


async def notify_access_changed(conn: asyncpg.Connection, learner_id: UUID) -> None:
    await conn.fetchval("SELECT pg_notify('la_access_changed', $1)", json.dumps({'userId': str(learner_id)}))


@router.get('/api/owner/second-owner')
async def status(req: Request) -> JSONResponse:
    actor = await require_primary_owner(req)
    db = await core.pool()
    async with db.acquire() as conn:
        row = await conn.fetchrow('''
            SELECT * FROM second_owner_access WHERE owner_id = $1 AND owner_auth_version = $2
        ''', actor['id'], actor['auth_version'])
    return core.j(grant_status(row), headers=core.PRIVATE)


@router.post('/api/owner/second-owner')
async def create_invite(req: Request) -> JSONResponse:
    actor = await require_primary_owner(req)
    token = secrets.token_urlsafe(32)
    invite_hash = hashlib.sha256(token.encode('ascii')).hexdigest()
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        if not await lock_owner(conn, actor['id'], actor['auth_version']):
            raise HTTPException(403, 'forbidden')
        row = await conn.fetchrow("""
            INSERT INTO second_owner_access (owner_id, owner_auth_version, invite_hash, invite_expires_at)
            VALUES ($1, $2, $3, now() + $4::integer * interval '1 second')
            ON CONFLICT (owner_id) DO UPDATE
            SET owner_auth_version = EXCLUDED.owner_auth_version,
                invite_hash = EXCLUDED.invite_hash, invite_expires_at = EXCLUDED.invite_expires_at,
                session_expires_at = CASE WHEN second_owner_access.owner_auth_version = EXCLUDED.owner_auth_version
                                          THEN second_owner_access.session_expires_at END
            RETURNING *
        """, actor['id'], actor['auth_version'], invite_hash, INVITE_TTL_SECONDS)
        await audit(conn, actor['id'], 'second_owner.invited', actor['id'], {})
    return core.j({**grant_status(row), 'invitePath': f'/login#second-owner={token}'}, 201, core.PRIVATE)


@router.delete('/api/owner/second-owner')
async def revoke(req: Request) -> JSONResponse:
    actor = await require_primary_owner(req)
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        if not await lock_owner(conn, actor['id'], actor['auth_version']):
            raise HTTPException(403, 'forbidden')
        learner_id = await conn.fetchval("""
            UPDATE second_owner_access SET invite_hash = NULL, invite_expires_at = NULL, session_expires_at = NULL
            WHERE owner_id = $1 RETURNING learner_id
        """, actor['id'])
        if learner_id is not None:
            await conn.execute('UPDATE users SET auth_version = auth_version + 1 WHERE id = $1', learner_id)
            await notify_access_changed(conn, learner_id)
        await audit(conn, actor['id'], 'second_owner.revoked', learner_id or actor['id'], {})
    return core.j(grant_status(None), headers=core.PRIVATE)


@router.post('/api/auth/second-owner/redeem')
async def redeem(req: Request) -> JSONResponse:
    body = await core.payload(req)
    token = body.get('token') if isinstance(body, dict) else None
    invalid = core.j({'error': 'invalid_second_owner_link'}, 400, core.PRIVATE)
    if not isinstance(token, str) or TOKEN_PATTERN.fullmatch(token) is None:
        return invalid
    delay = await async_counter('second_owner_redeem_ip', client_key(req))
    if delay:
        return too_many(delay)
    invite_hash = hashlib.sha256(token.encode('ascii')).hexdigest()
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        invite = await conn.fetchrow("""
            SELECT owner_id, owner_auth_version FROM second_owner_access
            WHERE invite_hash = $1 AND invite_expires_at > now()
        """, invite_hash)
        if invite is None:
            return invalid
        owner_id = invite['owner_id']
        if not await lock_owner(conn, owner_id, invite['owner_auth_version']):
            return invalid
        grant = await conn.fetchrow("""
            UPDATE second_owner_access SET invite_hash = NULL, invite_expires_at = NULL,
                session_expires_at = clock_timestamp() + $3::integer * interval '1 second'
            WHERE owner_id = $1 AND invite_hash = $2 AND invite_expires_at > clock_timestamp()
            RETURNING learner_id
        """, owner_id, invite_hash, SESSION_TTL_SECONDS)
        if grant is None:
            return invalid
        learner_id = grant['learner_id']
        if learner_id is None:
            learner = await conn.fetchrow("""
                INSERT INTO users (name, role, account_status, onboarding_completed_at, second_owner_only)
                VALUES ('Learner', 'student', 'active', now(), true) RETURNING *
            """)
            await conn.execute('UPDATE second_owner_access SET learner_id = $2 WHERE owner_id = $1',
                               owner_id, learner['id'])
        else:
            learner = await conn.fetchrow("""
                UPDATE users SET auth_version = auth_version + 1
                WHERE id = $1 AND second_owner_only AND role = 'student' AND account_status = 'active'
                RETURNING *
            """, learner_id)
            if learner is None:
                raise HTTPException(403, 'forbidden')
            await notify_access_changed(conn, learner_id)
        await audit(conn, owner_id, 'second_owner.redeemed', learner['id'], {})
        session_token = issue_token(dict(learner), ttl=SESSION_TTL_SECONDS, second_owner=True)
    response = core.j({'ok': True}, headers=core.PRIVATE)
    write_cookie(response, req, SESSION_COOKIE, session_token, SESSION_TTL_SECONDS, http_only=True)
    return response


@router.get('/api/second-owner/inspection')
async def inspect(req: Request, section: str = 'people', page: int = 1, q: str = '') -> JSONResponse:
    authority = await core.current_authority(req)
    if not authority:
        raise HTTPException(401, 'unauthenticated')
    if not authority.get('secondOwner') or authority['user']['account_status'] != 'active':
        raise HTTPException(403, 'forbidden')
    if section not in INSPECTION_VIEWS or not 1 <= page <= 1000 or len(q) > 120:
        raise HTTPException(400, 'invalid_input')
    source, title, detail = INSPECTION_VIEWS[section]
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction(readonly=True):
        rows = await conn.fetch(f"""
            SELECT {title} AS title, {detail} AS detail FROM {source}
            WHERE strpos(lower({title}), lower($1)) > 0 OR $1 = ''
            ORDER BY title, id OFFSET $2 LIMIT 51
        """, q.strip(), (page - 1) * 50)
    return core.j({'rows': [dict(row) for row in rows[:50]], 'hasMore': len(rows) > 50}, headers=core.PRIVATE)


def install(app: Any) -> None:
    app.include_router(router)
