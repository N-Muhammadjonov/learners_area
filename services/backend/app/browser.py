"""Browser-facing presentation reads. Identity always comes from live session authority.

This boundary accepts named views, never SQL, role claims or caller-supplied owners.
All presentation reads use the authenticated native browser boundary.
"""
from __future__ import annotations

import os
from urllib.parse import urlsplit
from fastapi import APIRouter, Request, HTTPException
from . import main as core
from .auth_google_start_port import google_config

router = APIRouter()
STAFF = frozenset(('teacher', 'admin', 'owner'))


def diagnostics_enabled():
    return os.getenv('APP_ENV') != 'production' and os.getenv('PERFORMANCE_DIAGNOSTICS') == 'true'


def public_config():
    policy = core.auth_policy()
    username = os.getenv('TELEGRAM_BOT_USERNAME', '').strip().lstrip('@')
    import re
    telegram = bool(os.getenv('TELEGRAM_BOT_TOKEN', '').strip() and re.fullmatch(r'[A-Za-z0-9_]{5,32}', username))
    return {'version': 1, 'public': {'diagnostics': diagnostics_enabled(), 'auth': {
        'passwordEnabled': policy['passwordEnabled'], 'telegramOnly': policy['telegramOnly'],
        'telegramIntentEnabled': telegram, 'telegramConfigured': telegram,
        'googleConfigured': bool(policy['googleEnabled'] and google_config()),
        'botUsername': username if telegram else None, 'diagnostics': diagnostics_enabled(),
    }}}


@router.get('/api/frontend/public')
async def public(req: Request):
    return core.j(public_config(), headers=core.PRIVATE)


async def authority(req: Request, *, active=True, roles=None):
    current = await core.current_authority(req)
    if not current:
        raise HTTPException(401, 'unauthenticated')
    user = current['user']
    if active and user['account_status'] != 'active':
        raise HTTPException(403, 'account_not_active')
    if roles is not None and user['role'] not in roles:
        raise HTTPException(403, 'forbidden')
    return current


@router.get('/api/frontend/session')
async def session(req: Request):
    current = await authority(req, active=False)
    user = current['user']
    db = await core.pool()
    async with db.acquire() as con:
        has_photo = False
        if await con.fetchval("SELECT to_regclass('public.user_profile_photos')"):
            has_photo = bool(await con.fetchval('SELECT 1 FROM user_profile_photos WHERE user_id=$1', user['id']))
    return core.j({'version': 1, 'session': {
        'user': {'id': str(user['id']), 'name': user['name'], 'email': user['email'],
                 'role': user['role'], 'accountStatus': user['account_status'],
                 'locale': user['locale'], 'onboarded': bool(user['onboarding_completed_at']),
                 'photoPresent': has_photo, 'statusReason': user['status_reason']},
        'expiresAt': current['expiresAt'], 'accessEventsEnabled': bool(os.getenv('AUTH_EVENTS_DATABASE_URL','').strip() or os.getenv('DATABASE_URL','').strip()),
        'diagnostics': diagnostics_enabled(),
    }}, headers=core.PRIVATE)


def view_route(value):
    if not isinstance(value, str) or len(value) > 4096 or not value.startswith('/') or value.startswith('//'):
        raise HTTPException(400, 'invalid_route')
    if any(ord(c) < 32 for c in value) or '\\' in value:
        raise HTTPException(400, 'invalid_route')
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or parsed.fragment or '%' in parsed.path:
        raise HTTPException(400, 'invalid_route')
    if any(part in ('.', '..') for part in parsed.path.split('/')):
        raise HTTPException(400, 'invalid_route')
    return parsed


@router.get('/api/frontend/view')
async def view(req: Request):
    route = req.query_params.get('route', '')
    parsed = view_route(route)
    current = await authority(req, active=parsed.path != '/pending')
    from .browser_reads import read_view
    data = await read_view(req, current['user'], parsed.path, parsed.query, req.query_params.get('region'))
    body = {'version': 1, 'route': route, 'data': core.row_to_dict({'value': data})['value']}
    if req.query_params.get('region') is not None:
        body['region'] = req.query_params['region']
    return core.j(body, headers=core.PRIVATE)


@router.get('/api/frontend/staff/{kind}')
async def staff_view(req: Request, kind: str):
    current = await authority(req, roles=STAFF)
    from .browser_staff import read_staff
    data = await read_staff(req, current['user'], kind)
    return core.j({'version': 1, 'kind': kind, 'data': core.row_to_dict({'value': data})['value']}, headers=core.PRIVATE)
