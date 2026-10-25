"""Private server-rendering adapter. Browser API actions live in the domain routers.

The token is shared only by the frontend server and this service. The query
transport cannot mutate data: PostgreSQL itself enforces a read-only transaction.
Lifecycle writes triggered while rendering are explicit, owner-scoped operations.
"""
from __future__ import annotations

import hmac
import json
import os
import re
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Request
from . import main as core
from .security import normalize_origin

router = APIRouter()


def trusted_frontend(headers) -> bool:
    expected = os.environ.get('BACKEND_SERVICE_TOKEN', '')
    actual = headers.get('x-backend-service-token', '')
    return len(expected) >= 32 and hmac.compare_digest(expected.encode(), actual.encode())


class FrontendOriginMiddleware:
    """Only the authenticated frontend relay may supply the public origin."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http':
            from starlette.datastructures import Headers
            headers = Headers(scope=scope)
            if trusted_frontend(headers):
                proto = headers.get('x-forwarded-proto', '')
                host = headers.get('x-forwarded-host', '')
                origin = normalize_origin(f'{proto}://{host}')
                if origin:
                    scope = dict(scope)
                    scope['scheme'] = proto
                    scope['headers'] = [(k, v) for k, v in scope['headers'] if k != b'host'] + [(b'host', host.encode('ascii'))]
        await self.app(scope, receive, send)


def denied():
    return core.j({'error': 'not_found'}, 404, core.PRIVATE)


@router.get('/_frontend/session')
async def session(req: Request):
    if not trusted_frontend(req.headers):
        return denied()
    user = await core.current_user(req)
    if not user:
        return core.j({'user': None, 'hasPhoto': False}, headers=core.PRIVATE)
    has_photo = False
    db = await core.pool()
    async with db.acquire() as con:
        if await con.fetchval("SELECT to_regclass('public.user_profile_photos')"):
            has_photo = bool(await con.fetchval('SELECT 1 FROM user_profile_photos WHERE user_id=$1', user['id']))
    return core.j({'user': {
        'id': str(user['id']), 'name': user['name'], 'email': user['email'], 'role': user['role'],
        'accountStatus': user['account_status'], 'locale': user['locale'],
        'onboarded': bool(user['onboarding_completed_at']), 'statusReason': user['status_reason'],
    }, 'hasPhoto': has_photo}, headers=core.PRIVATE)


def pg_text(value, typename: str):
    if value is None:
        return None
    if typename in ('json', 'jsonb'):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    if isinstance(value, (list, tuple)):
        def item(v):
            if v is None:
                return 'NULL'
            if isinstance(v, (list, tuple)):
                return '{' + ','.join(item(x) for x in v) + '}'
            text = pg_text(v, '')
            return '"' + text.replace('\\', '\\\\').replace('"', '\\"') + '"'
        return '{' + ','.join(item(x) for x in value) + '}'
    if isinstance(value, bool):
        return 't' if value else 'f'
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, bytes):
        return '\\x' + value.hex()
    if isinstance(value, (str, int, float, Decimal, UUID)):
        return str(value)
    raise TypeError('Unsupported PostgreSQL value')


def input_value(value, typename: str):
    if value is None:
        return None
    if typename in ('timestamp', 'timestamptz') and isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.replace(tzinfo=None) if typename == 'timestamp' else parsed
    if typename == 'date' and isinstance(value, str):
        return date.fromisoformat(value[:10])
    if typename in ('int2', 'int4', 'int8') and isinstance(value, str):
        return int(value)
    if typename in ('float4', 'float8') and isinstance(value, str):
        return float(value)
    if typename == 'numeric' and isinstance(value, str):
        return Decimal(value)
    if typename.endswith('[]') or typename.startswith('_'):
        element = typename[:-2] if typename.endswith('[]') else typename[1:]
        if isinstance(value, str):
            value = parse_pg_array(value)
        def convert(v):
            return [convert(item) for item in v] if isinstance(v, list) else input_value(v, element)
        return [convert(v) for v in value]
    return value


def parse_pg_array(text):
    """Decode Drizzle's quoted PostgreSQL array parameters, including NULL."""
    position = 0
    def array():
        nonlocal position
        if position >= len(text) or text[position] != '{':
            raise ValueError('Invalid PostgreSQL array')
        position += 1
        values = []
        while position < len(text) and text[position] != '}':
            if text[position] == '{':
                value = array()
            else:
                quoted = text[position] == '"'
                if quoted:position += 1
                chars = []
                while position < len(text):
                    ch = text[position]
                    if ch == '\\':
                        position += 1
                        if position >= len(text):raise ValueError('Invalid PostgreSQL array')
                        chars.append(text[position]);position += 1
                    elif quoted and ch == '"':
                        position += 1
                        break
                    elif not quoted and ch in ',}':break
                    else:chars.append(ch);position += 1
                value = ''.join(chars)
                if not quoted and value == 'NULL':value = None
            values.append(value)
            if position < len(text) and text[position] == ',':position += 1
            elif position < len(text) and text[position] != '}':raise ValueError('Invalid PostgreSQL array')
        if position >= len(text):raise ValueError('Invalid PostgreSQL array')
        position += 1
        return values
    result = array()
    if position != len(text):raise ValueError('Invalid PostgreSQL array')
    return result


@router.post('/_frontend/query')
async def read_query(req: Request):
    if not trusted_frontend(req.headers):
        return denied()
    user = await core.current_user(req)
    if not user:
        return core.auth_error()
    body = await core.payload(req)
    if (not isinstance(body, dict) or not isinstance(body.get('sql'), str) or
        len(body['sql']) > 200_000 or not isinstance(body.get('params'), list) or len(body['params']) > 10_000):
        return core.j({'error': 'invalid_input'}, 400, core.PRIVATE)
    # The trusted renderer supplies prepared selectors. This check is additional
    # to the database read-only transaction, not a SQL-parser security boundary.
    if not re.match(r'^\s*(select|with|show)\b', body['sql'], re.I):
        return core.j({'error': 'frontend_query_is_read_only', 'code': '25006'}, 403, core.PRIVATE)
    db = await core.pool()
    try:
        async with db.acquire() as con:
            async with con.transaction(readonly=True):
                await con.execute("SET LOCAL statement_timeout = '15s'")
                statement = await con.prepare(body['sql'], name='')
                parameters = statement.get_parameters()
                if len(parameters) != len(body['params']):
                    return core.j({'error': 'invalid_input'}, 400, core.PRIVATE)
                values = [input_value(v, t.name) for v, t in zip(body['params'], parameters)]
                attributes = statement.get_attributes()
                rows = await statement.fetch(*values)
                return core.j({
                    'fields': [{'name': a.name, 'dataTypeID': a.type.oid} for a in attributes],
                    'rows': [[pg_text(v, a.type.name) for v, a in zip(row, attributes)] for row in rows],
                }, headers=core.PRIVATE)
    except Exception as exc:
        code = getattr(exc, 'sqlstate', '')
        if re.fullmatch(r'[A-Z0-9]{5}', code or ''):
            return core.j({'error': 'frontend_query_failed', 'code': code}, 503, core.PRIVATE)
        raise


async def activate_reading_schedules(con):
    from .step31_version_publication import publish
    while True:
        async with con.transaction():
            candidates = await con.fetch("""SELECT v.id,v.source_ref,v.content_type,v.version_no
                FROM content_versions v WHERE v.module='reading' AND v.publication_state='scheduled' AND (
                EXISTS(SELECT 1 FROM general_reading_sets s WHERE s.id=v.target_id AND s.publish_at<=NOW()) OR
                EXISTS(SELECT 1 FROM reading_passages p WHERE p.id=v.target_id AND p.publish_at<=NOW()))
                ORDER BY v.source_ref,v.content_type,v.version_no DESC,v.id LIMIT 100""")
            for candidate in candidates:
                await con.execute('SELECT pg_advisory_xact_lock(hashtext($1))', 'reading-version:' + candidate['source_ref'])
                row = await con.fetchrow('SELECT * FROM content_versions WHERE id=$1', candidate['id'])
                if not row or row['publication_state'] != 'scheduled':
                    continue
                newer = await con.fetchval("""SELECT id FROM content_versions WHERE module='reading'
                    AND content_type=$1 AND source_ref=$2 AND status='published' AND version_no>$3 LIMIT 1""",
                    row['content_type'], row['source_ref'], row['version_no'])
                await publish(con, dict(row), 'archived' if newer else 'published', None,
                              {'role': 'system'}, system_schedule=True)
        if len(candidates) < 100:
            return


def retention_record(row):
    keys = ['id', 'user_id', 'retention_text_id', 'retention_text_version_id', 'level', 'rotation_cycle', 'status',
            'read_started_at', 'read_ends_at', 'write_started_at', 'write_ends_at', 'recall_text',
            'submitted_at', 'completed_at', 'score', 'score_breakdown', 'evaluator_version']
    result = {}
    date_keys = []
    for key in keys:
        parts = key.split('_')
        target = parts[0] + ''.join(s.title() for s in parts[1:])
        value = row[key]
        if isinstance(value, datetime):
            date_keys.append(target)
        if key == 'score_breakdown' and isinstance(value, str):
            value = json.loads(value)
        result[target] = core.row_to_dict({'value': value})['value']
    return {'result': result, 'dateKeys': date_keys}


@router.post('/_frontend/action')
async def action(req: Request):
    if not trusted_frontend(req.headers):
        return denied()
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    body = await core.payload(req)
    if not isinstance(body, dict):
        return core.j({'error': 'invalid_input'}, 400, core.PRIVATE)
    operation = body.get('action')
    db = await core.pool()
    async with db.acquire() as con:
        if operation == 'reading.activate-schedules':
            await activate_reading_schedules(con)
        elif operation == 'writing.expire-paper':
            identifier = core.uuid_value(body.get('id'))
            if not identifier:
                return core.j({'error': 'invalid_input'}, 400, core.PRIVATE)
            owned = await con.fetchval('SELECT id FROM writing_exam_papers WHERE id=$1 AND user_id=$2', identifier, user['id'])
            if owned:
                from .exam_lifecycle_port import expire_due
                await expire_due(con, identifier)
        elif operation == 'listening.start':
            identifier = core.uuid_value(body.get('id'))
            if not identifier:
                return core.j({'error': 'invalid_input'}, 400, core.PRIVATE)
            from .step17_listening_start_port import begin, test_detail
            detail = await test_detail(con, user, str(identifier))
            if not detail or detail == 'sequence_locked':
                return core.j({'result': None}, headers=core.PRIVATE)
            return core.j({'result': await begin(con, user, str(identifier))}, headers=core.PRIVATE)
        elif operation in ('retention.read', 'retention.live'):
            identifier = core.uuid_value(body.get('id'))
            if operation == 'retention.read' and not identifier:
                return core.j({'error': 'retention_attempt_not_found'}, 404, core.PRIVATE)
            from .step20_retention_transitions_port import phase
            from .step35_retention_attempts import finalize
            async with con.transaction():
                row = await con.fetchrow('SELECT * FROM retention_attempts WHERE user_id=$1 AND id=$2 FOR UPDATE', user['id'], identifier) if identifier else await con.fetchrow("SELECT * FROM retention_attempts WHERE user_id=$1 AND status IN ('reading','recall') ORDER BY created_at DESC LIMIT 1 FOR UPDATE", user['id'])
                if not row:
                    return core.j({'result': None}, headers=core.PRIVATE)
                when = datetime.now(timezone.utc)
                if row['status'] not in ('completed', 'timed_out') and phase(row, when) == 'timed_out':
                    row = await finalize(con, row, when, 'timed_out')
                return core.j(retention_record(row), headers=core.PRIVATE)
        else:
            return core.j({'error': 'unknown_frontend_action'}, 400, core.PRIVATE)
    return core.j({'result': None}, headers=core.PRIVATE)
