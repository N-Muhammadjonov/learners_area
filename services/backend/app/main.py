"""Learners Area FastAPI backend with complete HTTP route inventory."""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
import asyncio
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from .db import db_failure, pool, row_to_dict, close_pool
from .auth_validation import validate as validate_auth
from .request_lifecycle import control, run_blocking, WorkBusy, unavailable
from .rate_limit import client_key, async_counter as counter, too_many, async_reset as reset, reserve, release
from .security import (SESSION_COOKIE, SESSION_TTL, add_security_headers,
                       check_origin, clear_session_cookie, issue_token, normalize_origin,
                       verify_token, write_cookie)

LOG = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app):
    worker_state = control.start()
    try:
        yield
    finally:
        from .access_events import bus
        try:
            await control.drain(state=worker_state)
        finally:
            try:
                await asyncio.wait_for(bus.close(), timeout=5)
            except (TimeoutError, OSError):
                LOG.warning('Access-event shutdown grace expired')
            finally:
                await close_pool()

app = FastAPI(title='Learners Area FastAPI', docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

PRIVATE = {'Cache-Control': 'private, no-store'}
SESSION_COLS = '''id,name,email,role,account_status,locale,onboarding_completed_at,status_reason,auth_version'''


def j(data: dict, status: int = 200, headers: dict | None = None) -> JSONResponse:
    return JSONResponse(data, status_code=status, headers=headers)


def uuid_value(value: str):
    try: return uuid.UUID(str(value))
    except (ValueError, TypeError): return None


async def payload(req: Request):
    try: return await req.json()
    except (ValueError, UnicodeDecodeError): return None


def is_email(value):
    return isinstance(value, str) and len(value) <= 320 and re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', value)


def auth_policy() -> dict:
    verified = False
    base = os.environ.get('PUBLIC_BASE_URL', '')
    normalized = normalize_origin(base)
    if normalized and normalized.startswith('https://') and normalized == os.environ.get('TELEGRAM_AUTH_E2E_VERIFIED_ORIGIN'):
        verified = True
    telegram_only = bool(os.environ.get('PUBLIC_AUTH_MODE') == 'telegram-only' and verified and
                         os.environ.get('TELEGRAM_BOT_TOKEN', '').strip() and os.environ.get('TELEGRAM_BOT_USERNAME', '').strip())
    return {'telegramOnly': telegram_only, 'passwordEnabled': not telegram_only, 'googleEnabled': not telegram_only}


def auth_disabled():
    return j({'error': 'authentication_method_disabled'}, 403, {'Cache-Control': 'no-store'})


async def _load_authority(req: Request):
    token = verify_token(req.cookies.get(SESSION_COOKIE))
    if not token: return None
    identifier = uuid_value(token['sub'])
    if identifier is None: return None
    conn_pool = await pool()
    async with conn_pool.acquire() as conn:
        row = await conn.fetchrow('''
          SELECT id, name, email, role, account_status, locale,
                 onboarding_completed_at, status_reason, auth_version
          FROM users
          WHERE id = $1 AND auth_version = $2
            AND NOT EXISTS (SELECT 1 FROM auth_session_revocations r
              WHERE r.token_hash = $3 AND r.user_id = $1 AND r.expires_at > NOW())
          LIMIT 1''', identifier, token['authVersion'], token['sessionKey'])
    if not row: return None
    user = dict(row)
    return {'user': user, 'expiresAt': token['expiresAt'], 'sessionKey': token['sessionKey'], 'authVersion': token['authVersion']}


def forget_authority(req: Request):
    """Long-lived event handshakes can explicitly request a fresh snapshot."""
    state = req.scope.setdefault('state', {})
    state.pop('_la_authority', None)


async def current_authority(req: Request):
    """Deduplicate identity reads inside ONE HTTP request; never across requests."""
    scope = getattr(req, 'scope', None)
    if not isinstance(scope, dict):
        return await _load_authority(req)
    state = scope.setdefault('state', {})
    cookie = req.cookies.get(SESSION_COOKIE)
    cached = state.get('_la_authority')
    if cached is None or cached[0] != cookie:
        cached = (cookie, asyncio.create_task(_load_authority(req)))
        state['_la_authority'] = cached
    return await cached[1]


async def current_user(req: Request, active=False):
    authority = await current_authority(req)
    if not authority: return None
    user = authority['user']
    if active and user['account_status'] != 'active': return None
    return user


def auth_error():
    return j({'error': 'unauthenticated'}, 401)


@app.middleware('http')
async def secure_transport(request: Request, call_next):
    if request.url.path.startswith('/api/'):
        allowed, reason = check_origin(request)
        if not allowed:
            response = j({'error': 'invalid_origin', 'reason': reason}, 403)
            add_security_headers(response, request)
            return response
    try:
        response = await call_next(request)
    except Exception as exc:
        # The original has narrow database outage classification. Avoid leaking
        # credentials / connection strings from any pooled asyncpg exception.
        code = getattr(exc, 'sqlstate', None)
        from .db import is_database_unavailable
        if isinstance(exc, WorkBusy):
            response = unavailable()
        elif isinstance(exc, (OSError, ConnectionError, TimeoutError)) or is_database_unavailable(exc):
            response = db_failure(exc)
        else:
            LOG.exception('Unhandled API exception')
            response = j({'error': 'internal_server_error'}, 500)
    add_security_headers(response, request)
    return response


@app.get('/api/version')
async def version():
    commit = next((v.strip() for name in ('APP_COMMIT_SHA', 'VERCEL_GIT_COMMIT_SHA', 'RAILWAY_GIT_COMMIT_SHA')
                   if (v := os.getenv(name, '').strip())), None)
    region = next((v.strip() for name in ('APP_REGION', 'VERCEL_REGION') if (v := os.getenv(name, '').strip())), None)
    environment = os.getenv('APP_ENV') or os.getenv('VERCEL_ENV')
    if environment not in ('production', 'preview', 'development'):
        environment = 'production' if os.getenv('APP_ENV') == 'production' else 'development'
    return j({'commit': commit, 'shortCommit': commit[:7] if commit else None,
              'region': region, 'environment': environment}, headers={'Cache-Control': 'no-store'})


@app.post('/api/locale')
async def locale(req: Request):
    body = await payload(req)
    value = body.get('locale') if isinstance(body, dict) else None
    if value not in ('en', 'uz'):
        return j({'error': 'invalid_locale'}, 400)
    response = j({'ok': True})
    write_cookie(response, req, 'la_locale', value, 365 * 86400)
    return response


@app.post('/api/theme')
async def theme(req: Request):
    body = await payload(req)
    value = body.get('theme') if isinstance(body, dict) else None
    if value not in ('day', 'night'):
        return j({'error': 'invalid_theme'}, 400)
    response = j({'ok': True, 'theme': value})
    write_cookie(response, req, 'la_theme', value, 365 * 86400)
    return response


async def _authenticate(req: Request, recovery_only: bool = False):
    if not recovery_only and not auth_policy()['passwordEnabled']:
        return auth_disabled()
    body, error = validate_auth(await payload(req), 'login')
    if error: return j({'error': error}, 400)
    email = body['email']
    password = body['password']
    k = email
    ip = client_key(req)
    # Reserve before password hashing so concurrent replicas cannot all pass a
    # read-only pre-check. Successful logins release their own IP reservation.
    ip_slot = await reserve('login_ip', ip)
    if ip_slot.retry_after:return too_many(ip_slot.retry_after)
    try:
        account_slot = await reserve('login_account', k)
    except Exception:
        await asyncio.gather(release(ip_slot), return_exceptions=True)
        raise
    if account_slot.retry_after:
        await release(ip_slot)
        return too_many(account_slot.retry_after)
    try:
        conn_pool = await pool()
        async with conn_pool.acquire() as conn:
            user = await conn.fetchrow('''
              SELECT id, email, password_hash, role, name, locale,
                     onboarding_completed_at, account_status, auth_version
              FROM users WHERE email=$1 LIMIT 1''', email)
        # Same bcrypt decoy hash as the source: nonexistent email performs bcrypt.
        import bcrypt
        decoy = '$2a$12$NpanVw6DUsaA2WX2Obipc.94Av8DHYf.iT6gFPkLre9PfSqKIuYLe'
        stored = user['password_hash'] if user else None
        try:
            valid = await run_blocking(bcrypt.checkpw, password.encode('utf-8'), (stored or decoy).encode()) if len(password) <= 10000 else False
        except ValueError:
            valid = False
    except Exception:
        # A server/storage failure must not use up the learner's failed-login
        # allowance. Release only our slots and retain the original error.
        await asyncio.gather(release(ip_slot), release(account_slot), return_exceptions=True)
        raise
    valid = bool(valid and stored)
    if not valid or not user or (recovery_only and not (user['account_status'] == 'active' and user['role'] in ('admin', 'owner'))):
        return j({'error': 'invalid_credentials'}, 401)
    await reset('login_account', k, window=account_slot.window)
    await release(ip_slot)
    token = issue_token(dict(user))
    response = j({'ok': True, 'onboarded': bool(user['onboarding_completed_at']),
                  'accountStatus': user['account_status']}, headers={'Cache-Control': 'no-store'})
    clear_session_cookie(response, req)
    write_cookie(response, req, SESSION_COOKIE, token, SESSION_TTL, http_only=True)
    return response


@app.post('/api/auth/login')
async def login(req: Request):
    return await _authenticate(req)


@app.post('/api/auth/recovery/login')
async def recovery_login(req: Request):
    return await _authenticate(req, recovery_only=True)


async def create_access_request(user_id, message=None):
    """The access-request side effects: audit + owner/admin notification."""
    conn_pool = await pool()
    async with conn_pool.acquire() as conn:
        row = await conn.fetchrow("""INSERT INTO access_requests(user_id,message,status)
                                      VALUES($1,$2,'pending') RETURNING id""", user_id, message)
        await conn.execute("""UPDATE users SET account_status='pending',status_updated_at=NOW(),status_reason=NULL
                              WHERE id=$1""", user_id)
        await conn.execute("""INSERT INTO audit_log(actor_user_id,action,target_type,target_id)
                              VALUES($1,'access.requested','access_request',$2)""", user_id, str(row['id']))
        await conn.execute("""INSERT INTO notifications(user_id,type,title,body,href,payload)
            SELECT id,'ACCESS_REQUESTED','New access request',
                   'An applicant is waiting for approval.','/app/admin/admissions',
                   jsonb_build_object('requestId',$1::text)
            FROM users WHERE role IN ('admin','owner') AND account_status='active'""", str(row['id']))
        return row['id']


@app.post('/api/auth/register')
async def register(req: Request):
    if not auth_policy()['passwordEnabled']:
        return auth_disabled()
    delay = await counter('register', client_key(req), consume=True)
    if delay: return too_many(delay)
    body, error = validate_auth(await payload(req), 'register')
    if error: return j({'error': error}, 400)
    name, email, password, gender = (body[key] for key in ('name', 'email', 'password', 'gender'))
    conn_pool = await pool()
    async with conn_pool.acquire() as conn:
        existing = await conn.fetchval('SELECT 1 FROM users WHERE email=$1', email)
        if existing: return j({'error': 'email_taken'}, 409)
    import bcrypt
    pw_hash = (await run_blocking(bcrypt.hashpw, password.encode(), bcrypt.gensalt(rounds=12))).decode()
    async with conn_pool.acquire() as conn:
        locale = req.cookies.get('la_locale')
        locale = locale if locale in ('uz', 'en') else 'uz'
        try:
            user = await conn.fetchrow('''INSERT INTO users(name,gender,email,password_hash,role,locale)
                                          VALUES($1,$2,$3,$4,'student',$5)
                                          RETURNING id,role,name,locale,account_status,auth_version,onboarding_completed_at''',
                                       name, gender, email, pw_hash, locale)
        except Exception as exc:
            if getattr(exc, 'sqlstate', '') == '23505': return j({'error': 'email_taken'}, 409)
            raise
    if not user: return j({'error': 'Could not create account'}, 500)
    # Registration remains valid even if queue insertion cannot complete.
    try:
        await create_access_request(user['id'])
    except Exception:
        LOG.exception('Could not enqueue access request')
    token = issue_token(dict(user))
    response = j({'ok': True, 'onboarded': False, 'accountStatus': user['account_status']})
    clear_session_cookie(response, req)
    write_cookie(response, req, SESSION_COOKIE, token, SESSION_TTL, http_only=True)
    return response


@app.post('/api/auth/logout')
async def logout(req: Request):
    session = verify_token(req.cookies.get(SESSION_COOKIE))
    if session:
        try:
            conn_pool = await pool()
            async with conn_pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute('''INSERT INTO auth_session_revocations(token_hash,user_id,expires_at)
                      VALUES($1,$2,to_timestamp($3)) ON CONFLICT DO NOTHING''',
                                       session['sessionKey'], uuid.UUID(session['sub']), session['expiresAt'])
                    await conn.execute('''DELETE FROM auth_session_revocations WHERE token_hash IN
                      (SELECT token_hash FROM auth_session_revocations WHERE expires_at <= NOW()
                       ORDER BY expires_at LIMIT 100)''')
                    await conn.fetchval("SELECT pg_notify('la_access_changed',$1)", json.dumps({'userId': session['sub']}))
        except Exception:
            return j({'error': 'logout_unavailable'}, 503, PRIVATE)
    response = j({'ok': True}, headers=PRIVATE)
    clear_session_cookie(response, req)
    return response


@app.get('/api/auth/state')
async def auth_state(req: Request):
    authority = await current_authority(req)
    if not authority: return j({'error': 'unauthenticated'}, 401, PRIVATE)
    user = authority['user']
    return j({'ok': True, 'role': user['role'], 'accountStatus': user['account_status'],
              'expiresAt': authority['expiresAt']}, headers=PRIVATE)


@app.patch('/api/profile')
async def profile_patch(req: Request):
    user = await current_user(req, active=True)
    if not user: return auth_error()
    body = await payload(req)
    if (not isinstance(body, dict) or set(body) != {'name'} or not isinstance(body.get('name'), str)
        or not (2 <= len(body['name'].strip()) <= 200)):
        return j({'error': 'invalid_input'}, 400)
    name = body['name'].strip()
    conn_pool = await pool()
    async with conn_pool.acquire() as conn:
        updated = await conn.fetchval('UPDATE users SET name=$1 WHERE id=$2 RETURNING name', name, user['id'])
    if updated is None: return j({'error': 'not_found'}, 404)
    return j({'ok': True, 'name': updated})


@app.post('/api/admission/request')
async def admission_request(req: Request):
    delay = await counter('admission_request', client_key(req), consume=True)
    if delay: return too_many(delay)
    user = await current_user(req)
    if not user: return auth_error()
    if user['account_status'] not in ('pending', 'rejected'):
        return j({'error': 'not_eligible', 'status': user['account_status']}, 409)
    conn_pool = await pool()
    async with conn_pool.acquire() as conn:
        existing = await conn.fetchval('''SELECT id FROM access_requests WHERE user_id=$1 AND status='pending'
                                          ORDER BY created_at DESC LIMIT 1''', user['id'])
    if existing: return j({'ok': True, 'requestId': str(existing), 'alreadyOpen': True})
    body = await payload(req)
    message = body.get('message') if isinstance(body, dict) else None
    message = message.strip() if isinstance(message, str) and len(message.strip()) <= 1000 else None
    created = await create_access_request(user['id'], message)
    return j({'ok': True, 'requestId': str(created) if created else None})


@app.get('/api/notifications')
async def get_notifications(req: Request):
    user = await current_user(req)
    if not user: return auth_error()
    conn_pool = await pool()
    async with conn_pool.acquire() as conn:
        if user.get('role')=='student' and user.get('account_status')=='active':
            from .notification_events import notify_assignment_deadlines
            await notify_assignment_deadlines(conn,student_id=user['id'])
        unread = await conn.fetchval('SELECT COUNT(*)::int FROM notifications WHERE user_id=$1 AND read_at IS NULL', user['id'])
        if req.query_params.get('count') == '1':
            rows = []
        else:
            rows = await conn.fetch('''SELECT id,user_id,type,title,body,href,payload,read_at,created_at
                                       FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30''', user['id'])
    notifications = []
    for row in rows:
        d = row_to_dict(row)
        notifications.append({'id': d['id'], 'userId': d['user_id'], 'type': d['type'],
            'title': d['title'], 'body': d['body'], 'href': d['href'], 'payload': d['payload'],
            'readAt': d['read_at'], 'createdAt': d['created_at']})
    return j({'ok': True, 'notifications': notifications, 'unread': unread or 0}, headers=PRIVATE)


@app.post('/api/notifications')
async def post_notifications(req: Request):
    user = await current_user(req)
    if not user: return auth_error()
    body = await payload(req)
    if not isinstance(body, dict): return j({'error': 'invalid_input'}, 400)
    ids = None
    if set(body) == {'all'} and body['all'] is True:
        pass
    elif set(body) == {'ids'} and isinstance(body['ids'], list) and len(body['ids']) <= 100 and all(uuid_value(x) for x in body['ids']):
        ids = [uuid.UUID(x) for x in body['ids']]
    else:
        return j({'error': 'invalid_input'}, 400)
    conn_pool = await pool()
    async with conn_pool.acquire() as conn:
        if ids is None:
            await conn.execute('''UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL''', user['id'])
        elif ids:
            await conn.execute('''UPDATE notifications SET read_at=NOW()
                                  WHERE user_id=$1 AND read_at IS NULL AND id=ANY($2::uuid[])''', user['id'], ids)
        unread = await conn.fetchval('SELECT COUNT(*)::int FROM notifications WHERE user_id=$1 AND read_at IS NULL', user['id'])
    return j({'ok': True, 'unread': unread}, headers=PRIVATE)


@app.post('/api/presence')
async def presence(req: Request):
    user = await current_user(req, active=True)
    if not user: return auth_error()
    conn_pool = await pool()
    async with conn_pool.acquire() as conn:
        delay = await counter('presence', 'presence:' + str(user['id']), consume=True, connection=conn)
        if delay: return too_many(delay)
        await conn.execute('''
          INSERT INTO activity_events(id,user_id,type,payload,created_at)
          SELECT md5('site-presence:'||$1::text)::uuid,$1::uuid,'SITE_PRESENCE',
            jsonb_build_object('since',NOW(),'visitStartedAt',NOW(),'visitSeconds',0,'totalSeconds',0),NOW()
          WHERE NOT EXISTS(SELECT 1 FROM activity_events fresh
            WHERE fresh.id=md5('site-presence:'||$1::text)::uuid AND fresh.created_at>NOW()-interval '15 seconds')
          ON CONFLICT(id) DO UPDATE SET created_at=NOW(),payload=jsonb_build_object(
            'since',activity_events.payload->>'since',
            'visitStartedAt',CASE WHEN NOW()-activity_events.created_at>interval '90 seconds' THEN NOW()::text
                ELSE activity_events.payload->>'visitStartedAt' END,
            'visitSeconds',CASE WHEN NOW()-activity_events.created_at>interval '90 seconds' THEN 0
                ELSE COALESCE((activity_events.payload->>'visitSeconds')::int,0)+
                   LEAST(45,GREATEST(0,FLOOR(EXTRACT(epoch FROM NOW()-activity_events.created_at))::int)) END,
            'totalSeconds',COALESCE((activity_events.payload->>'totalSeconds')::bigint,0)+
                CASE WHEN NOW()-activity_events.created_at>interval '90 seconds' THEN 0
                  ELSE LEAST(45,GREATEST(0,FLOOR(EXTRACT(epoch FROM NOW()-activity_events.created_at))::int)) END)
          WHERE activity_events.user_id=$1::uuid AND activity_events.type='SITE_PRESENCE'
            AND activity_events.created_at<=NOW()-interval '15 seconds' ''', str(user['id']))
    return Response(status_code=204, headers=PRIVATE)

@app.get('/api/profile/photo/{id}')
async def get_profile_photo(req: Request, id: str):
    import base64
    user = await current_user(req, active=True)
    if not user: return Response(status_code=401)
    if not re.fullmatch(r'[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}', id):
        return Response(status_code=404)
    try:
        conn_pool = await pool()
        async with conn_pool.acquire() as conn:
            ready = await conn.fetchval("SELECT to_regclass('public.user_profile_photos')")
            if not ready: return Response(status_code=404)
            photo = await conn.fetchrow('''SELECT p.image_base64, p.content_type
                FROM user_profile_photos p INNER JOIN users u ON u.id=p.user_id
                WHERE u.id=$1 AND u.account_status='active' LIMIT 1''', uuid.UUID(id))
        if not photo: return Response(status_code=404)
        return Response(content=base64.b64decode(photo['image_base64']), media_type=photo['content_type'],
                        headers=PRIVATE)
    except Exception:
        return Response(status_code=503)


@app.post('/api/profile/photo')
async def post_profile_photo(req: Request):
    import base64
    user = await current_user(req, active=True)
    if not user: return auth_error()
    from .rate_limit import RULES
    RULES.setdefault('profile_photo', (12, 60))
    delay = await counter('profile_photo', str(user['id']), consume=True)
    if delay: return too_many(delay)
    content_length = req.headers.get('content-length', '')
    if content_length and content_length.isdigit() and int(content_length) > 320000:
        return j({'error': 'file_too_large'}, 413)
    try:
        form = await req.form()
        upload = form.get('photo')
        if not upload or not getattr(upload, 'filename', None): return j({'error': 'invalid_image'}, 400)
        media_type = getattr(upload, 'content_type', None)
        data = await upload.read(307201)
        if (media_type not in ('image/png', 'image/jpeg') or not data or len(data) > 307200 or
            not (data.startswith(b'\x89PNG') if media_type == 'image/png' else data.startswith(b'\xff\xd8'))):
            return j({'error': 'invalid_image'}, 400)
    except Exception:
        return j({'error': 'invalid_image'}, 400)
    try:
        conn_pool = await pool()
        async with conn_pool.acquire() as conn:
            if not await conn.fetchval("SELECT to_regclass('public.user_profile_photos')"):
                return j({'error': 'schema_unavailable'}, 503)
            await conn.execute('''INSERT INTO user_profile_photos(user_id,image_base64,content_type,updated_at)
                VALUES($1,$2,$3,NOW()) ON CONFLICT(user_id)
                DO UPDATE SET image_base64=excluded.image_base64,content_type=excluded.content_type,
                    updated_at=excluded.updated_at''', user['id'], base64.b64encode(data).decode('ascii'), media_type)
        return j({'ok': True})
    except Exception:
        return j({'error': 'save_failed'}, 503)


@app.delete('/api/profile/photo')
async def delete_profile_photo(req: Request):
    user = await current_user(req, active=True)
    if not user: return auth_error()
    try:
        conn_pool = await pool()
        async with conn_pool.acquire() as conn:
            await conn.execute('DELETE FROM user_profile_photos WHERE user_id=$1', user['id'])
        return j({'ok': True})
    except Exception:
        return j({'error': 'save_failed'}, 503)

# Explicitly translated routes (not a blanket proxy / fallback).
from .migration_phase2 import install as _install_phase2
_install_phase2()

from .admin_authoring_port import install as _install_admin_authoring_port
_install_admin_authoring_port()

from .learner_admin_port import install as _install_learner_admin_port
_install_learner_admin_port()

from .support_reports_port import install as _install_support_reports_port
_install_support_reports_port()

from .lesson_writing_port import install as _install_lesson_writing_port
_install_lesson_writing_port()

from .writing_exam_read_port import install as _install_writing_exam_read_port
_install_writing_exam_read_port()

from .speaking_catalog_port import install as _install_speaking_catalog_port
_install_speaking_catalog_port()

from .vocabulary_packs_port import install as _install_vocabulary_packs_port
_install_vocabulary_packs_port()

from .exam_lifecycle_port import install as _install_exam_lifecycle
_install_exam_lifecycle()

from .writing_submissions_port import install as _install_writing_submissions
_install_writing_submissions()

from .owner_ai_control_port import install as _install_owner_ai_control
_install_owner_ai_control()

from .auth_google_start_port import install as _install_google_start
_install_google_start()
from .internal_bot_ready_port import install as _install_internal_bot_ready
_install_internal_bot_ready()

from .content_capabilities_port import install as _install_content_capabilities
_install_content_capabilities()

from .bot_operations_port import install as _install_bot_operations
_install_bot_operations()

from .telegram_preferences_port import install as _install_telegram_preferences
_install_telegram_preferences()

from .telegram_settings_port import install as _install_telegram_settings
_install_telegram_settings()

from .telegram_notification_queue_port import install as _install_telegram_queue
_install_telegram_queue()
from .telegram_ops_port import install as _install_telegram_ops
_install_telegram_ops()

from .telegram_admins_port import install as _install_telegram_admins
_install_telegram_admins()

from .telegram_broadcast_port import install as _install_telegram_broadcast
_install_telegram_broadcast()

from .telegram_directory_port import install as _install_telegram_directory
_install_telegram_directory()

from .telegram_support_drafts_port import install as _install_telegram_support
_install_telegram_support()
from .center_admin_port import install as _install_center_admin
_install_center_admin()
from .telegram_extra_port import install as _install_telegram_extra
_install_telegram_extra()
from .accounts_extra_port import install as _install_accounts_extra
_install_accounts_extra()
from .video_progress_port import install as _install_video_progress
_install_video_progress()
from .content_import_catalog_port import install as _install_content_import_catalog
_install_content_import_catalog()
from .retention_admin_port import install as _install_retention_admin
_install_retention_admin()
from .grammar_bundle_import_port import install as _install_grammar_bundle_import
_install_grammar_bundle_import()
from .assignable_content_port import install as _install_assignable
_install_assignable()
from .admission_decision_port import install as _install_admission_decision
_install_admission_decision()

from .video_answers_join_port import install as _install_video_answers_join
_install_video_answers_join()

from .speaking_workflow_port import install as _install_speaking_workflow
_install_speaking_workflow()
from .reading_feedback_port import install as _install_reading_feedback
_install_reading_feedback()
from .writing_admin_content_port import install as _install_writing_admin_content
_install_writing_admin_content()

from .step15_basic_port import install as _install_step15_basic
_install_step15_basic()

from .retention_authoring_port import install as _install_retention_authoring
_install_retention_authoring()

from .writing_translation_port import install as _install_writing_translation
_install_writing_translation()


from .step16_lessons_port import install as _install_step16_lessons
_install_step16_lessons()

from .step16_bank_port import install as _install_step16_bank
_install_step16_bank()

from .step16_telegram_user_port import install as _install_step16_telegram_user
_install_step16_telegram_user()

from .step16_stealing_port import install as _install_step16_stealing
_install_step16_stealing()

from .step16_units_prompts_port import install as _install_units_prompts
_install_units_prompts()

from .step16_leaderboard_port import install as _install_step16_leaderboard
_install_step16_leaderboard()

from .step16_vocab_library_port import install as _install_step16_vocab_library
_install_step16_vocab_library()

from .step17_admin_safe_port import install as _install_step17_admin_safe
_install_step17_admin_safe()
from .step17_access_events_port import install as _install_step17_access
_install_step17_access()
from .step17_dictionary_read_port import install as _install_step17_dictionary_read
_install_step17_dictionary_read()
from .step17_stealing_workflow_port import install as _install_step17_stealing_workflow
_install_step17_stealing_workflow()
from .step17_mcq_port import install as _install_step17_mcq
_install_step17_mcq()
from .step17_speaking_write_port import install as _install_step17_speaking_write
_install_step17_speaking_write()
from .step17_listening_start_port import install as _install_step17_listening_start
_install_step17_listening_start()
from .step17_listening_course_port import install as _install_step17_listening_course
_install_step17_listening_course()
from .step17_listening_work_port import install as _install_step17_listening_work
_install_step17_listening_work()

from .step18_telegram_auth_port import install as _install_step18_telegram_auth
_install_step18_telegram_auth()
from .step18_telegram_admission_port import install as _install_step18_telegram_admission
_install_step18_telegram_admission()
from .step19_bot_delete_port import install as _install_step19_bot_delete
_install_step19_bot_delete()
from .step19_vocab_srs_port import install as _install_step19_vocab_srs
_install_step19_vocab_srs()
from .step19_telegram_exchange_port import install as _install_step19_exchange
_install_step19_exchange()
from .step19_uploads_speaking_port import install as _install_step19_uploads
_install_step19_uploads()
from .step19_vocab_games_port import install as _install_step19_vocab_games
_install_step19_vocab_games()

from .step20_lesson_editor_port import install as _install_step20_lesson_editor
_install_step20_lesson_editor()
from .step20_media_port import install as _install_step20_media
_install_step20_media()
from .step20_upload_finalize_port import install as _install_step20_upload_finalize
_install_step20_upload_finalize()
from .step20_retention_transitions_port import install as _install_step20_retention_transitions
_install_step20_retention_transitions()

from .step21_lesson_reads_port import install as _install_step21_lesson_reads
_install_step21_lesson_reads()

from .step21_packs_port import install as _install_step21_packs
_install_step21_packs()

from .step21_reading_port import install as _install_step21_reading
_install_step21_reading()

from .step21_sourced_vocab import install as _install_step21_sourced_vocab
_install_step21_sourced_vocab()

from .step21_retention_reads import install as _install_step21_retention_reads
_install_step21_retention_reads()

from .step21_safe_reads_port import install as _install_step21_safe_reads
_install_step21_safe_reads()

from .step21_academic_start_port import install as _install_step21_academic_start
_install_step21_academic_start()

from .step21_meaning_access import install as _install_step21_meaning
_install_step21_meaning()

from .step21_dictionary_entry_save import install as _install_step21_dictionary
_install_step21_dictionary()

from .step21_history_port import install as _install_step21_history
_install_step21_history()

from .step21_assignments_create import install as _install_step21_assignments_create
_install_step21_assignments_create()

from .step21_vocabulary_create import install as _install_step21_vocabulary_create
_install_step21_vocabulary_create()
from .step21_listening_authored_reads import install as _install_step21_listening_authored_reads
_install_step21_listening_authored_reads()

from .step22_study_writes import install as _install_step22_study
_install_step22_study()
from .step22_resources_port import install as _install_step22_resources
_install_step22_resources()
from .step22_listening_submit import install as _install_step22_listening_submit
_install_step22_listening_submit()

from .step22_upload_port import install as _install_step22_upload
_install_step22_upload()
from .step22_speaking_deletion import install as _install_step22_speaking_deletion
_install_step22_speaking_deletion()
from .step22_speaking_patch import install as _install_step22_speaking_patch
_install_step22_speaking_patch()

from .step23_vocab_lookup import install as _install_step23_vocab_lookup
_install_step23_vocab_lookup()
from .step23_version_preview import install as _install_step23_version_preview
_install_step23_version_preview()
from .step23_typing import install as _install_step23_typing
_install_step23_typing()
from .step23_typing_legacy import install as _install_step23_typing_legacy
_install_step23_typing_legacy()
from .step23_grade import install as _install_step23_grade
_install_step23_grade()
from .step23_translation_answer import install as _install_step23_translation_answer
_install_step23_translation_answer()
from .step23_stealing_practice import install as _install_step23_stealing_practice
_install_step23_stealing_practice()
from .step23_activation_check import install as _install_step23_activation_check
_install_step23_activation_check()

from .step24_live_partner import install as _install_step24_live_partner
_install_step24_live_partner()

from .step25_google_callback import install as _install_step25_google_callback
_install_step25_google_callback()
from .step25_speaking_material_create import install as _install_step25_speaking_material_create
_install_step25_speaking_material_create()

from .step26_owner_handover import install as _install_owner_handover
_install_owner_handover()
from .step26_owner_transfer import install as _install_owner_transfer
_install_owner_transfer()
from .step26_listening_convert import install as _install_listening_convert
_install_listening_convert()
from .step26_dictionary_owner_read import install as _install_dictionary_owner_read
_install_dictionary_owner_read()

from .step26_dictionary_discard import install as _install_dictionary_discard
_install_dictionary_discard()

from .step27_dictionary_edit import install as _install_step27_dictionary_edit
_install_step27_dictionary_edit()
from .step27_listening_authored_write import install as _install_step27_listening_authored_write
_install_step27_listening_authored_write()
from .step31_version_publication import install as _install_step31_version_publication
_install_step31_version_publication()
from .step27_publication import install as _install_step27_publication
_install_step27_publication()
from .step27_retention_policy import install as _install_step27_retention_policy
_install_step27_retention_policy()
from .step28_search import install as _install_step28_search
_install_step28_search()
from .step29_lesson_revision import install as _install_step29_lesson_revision
_install_step29_lesson_revision()
from .step30_admin_video_lessons import install as _install_step30_admin_video_lessons
_install_step30_admin_video_lessons()

from .step31_learning_production import install as _install_step31_learning_production
_install_step31_learning_production()

from .step32_grammar_practice import install as _install_step32_grammar_practice
_install_step32_grammar_practice()
from .step32_writing_submit import install as _install_step32_writing_submit
_install_step32_writing_submit()
from .step32_speaking_submit import install as _install_step32_speaking_submit
_install_step32_speaking_submit()
from .step33_assignment import install as _install_step33_assignment
_install_step33_assignment()
from .step34_reading_import import install as _install_step34_reading_import
_install_step34_reading_import()
from .step35_retention_attempts import install as _install_step35_retention_attempts
_install_step35_retention_attempts()
from .step36_student_export import install as _install_step36_student_export
_install_step36_student_export()
from .step37_reports import install as _install_step37_reports
_install_step37_reports()
from .step38_content_validate import install as _install_step38_content_validate
_install_step38_content_validate()

from .step39_listening_conversion import install as _install_step39_listening_conversion
_install_step39_listening_conversion()
from .step39_content_import import install as _install_step39_content_import
_install_step39_content_import()
from .step39_dictionary_publish import install as _install_step39_dictionary_publish
_install_step39_dictionary_publish()
from .step40_content_drafts import install as _install_step40_content_drafts
_install_step40_content_drafts()

from .writing_study_port import install as _install_writing_study
_install_writing_study()

from .riwi_port import install as _install_riwi_port
_install_riwi_port()
