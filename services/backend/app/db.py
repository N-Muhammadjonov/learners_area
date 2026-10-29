"""PostgreSQL access. Reads existing Learners Area tables; no schema mutation on startup."""
import os
import logging
import asyncio
import json
import math
from uuid import UUID
from contextlib import asynccontextmanager
from fastapi import Request
from fastapi.responses import JSONResponse

LOG = logging.getLogger(__name__)
try:
    import asyncpg
except ImportError:
    asyncpg = None

_pool = None
_pool_lock = None


class BoundedPool:
    """Keep every existing acquire call bounded, including context-manager use."""
    def __init__(self, raw, acquire_timeout):
        self._raw = raw
        self.acquire_timeout = acquire_timeout

    def acquire(self, *, timeout=None):
        wait = self.acquire_timeout if timeout is None else min(timeout, self.acquire_timeout)
        return self._raw.acquire(timeout=wait)

    def __getattr__(self, name):
        return getattr(self._raw, name)


class PooledReads:
    """Borrow only while a metadata query runs, not while its caller awaits R2."""
    def __init__(self, pool):
        self.pool = pool

    async def fetch(self, query, *args):
        async with self.pool.acquire() as con:
            return await con.fetch(query, *args)

    async def fetchrow(self, query, *args):
        async with self.pool.acquire() as con:
            return await con.fetchrow(query, *args)

    async def fetchval(self, query, *args):
        async with self.pool.acquire() as con:
            return await con.fetchval(query, *args)


def pool_settings():
    try:
        size = max(1, min(int(os.environ.get('DATABASE_POOL_MAX', '5')), 20))
        wait = float(os.environ.get('DATABASE_POOL_ACQUIRE_TIMEOUT', '5'))
    except ValueError:
        raise OSError('Invalid database pool setting') from None
    if not math.isfinite(wait) or not 0.05 <= wait <= 20:
        raise OSError('Invalid database pool acquire timeout')
    return size, wait


def connection_mode(dsn):
    from urllib.parse import urlsplit
    parts=urlsplit(dsn);host=(parts.hostname or '').lower()
    if host.endswith('.pooler.supabase.com'):
        return 'supabase_transaction_pooler' if parts.port==6543 else 'supabase_session_pooler' if parts.port in (None,5432) else 'custom_pooler'
    return 'supabase_direct' if host.endswith('.supabase.co') else 'custom'


def encode_json(value):
    # Existing ports already serialize documents; newer selectors may pass objects.
    # Preserve serialized documents instead of encoding them a second time.
    if isinstance(value, str):
        json.loads(value)
        return value
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


async def initialize_connection(con):
    await con.set_type_codec('uuid', schema='pg_catalog', encoder=str, decoder=UUID, format='text')
    for kind in ('json', 'jsonb'):
        await con.set_type_codec(kind, schema='pg_catalog', encoder=encode_json, decoder=json.loads, format='text')


async def pool():
    global _pool, _pool_lock
    if _pool is not None:
        return _pool
    if _pool_lock is None:
        _pool_lock = asyncio.Lock()
    async with _pool_lock:
        if _pool is None:
            _pool = await _create_pool()
    return _pool


async def _create_pool():
    if asyncpg is None:
        raise RuntimeError('asyncpg must be installed')
    dsn = os.environ.get('DATABASE_URL')
    if not dsn:
        raise OSError('DATABASE_URL is required')
    dsn,tls=connection_settings(dsn)
    size,wait=pool_settings()
    raw = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=size,
                                      timeout=8, command_timeout=20, ssl=tls, init=initialize_connection,
                                      statement_cache_size=0)
    logging.getLogger('uvicorn.error').info('Database pool ready: max=%s acquire_timeout=%ss transport=%s verified_tls=%s',
                                          size,wait,connection_mode(dsn),bool(tls and tls.check_hostname))
    return BoundedPool(raw,wait)


def connection_settings(dsn):
    # Existing server uses a private CA for Supabase. asyncpg respects TLS verify-full
    # only with an explicitly provided trust chain. Never silently disable TLS.
    import ssl
    from pathlib import Path
    from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
    host = (urlsplit(dsn).hostname or '').lower()
    tls = None
    if host.endswith('.pooler.supabase.com') or host.endswith('.supabase.co'):
        ca_file = os.environ.get('SUPABASE_CA_FILE') or str(Path(__file__).with_name('supabase_root_ca.pem'))
        tls = ssl.create_default_context(cafile=ca_file)
        parts = urlsplit(dsn)
        query = urlencode([(k, v) for k, v in parse_qsl(parts.query) if not k.lower().startswith('ssl')])
        dsn = urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))
    return dsn,tls


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def db_failure(exc: Exception) -> JSONResponse:
    code = getattr(exc, 'sqlstate', None) or getattr(exc, 'code', None)
    reasons = {'42P01': 'schema_missing', '42703': 'column_missing', '3D000': 'database_missing',
               '28P01': 'auth_failed', '28000': 'auth_failed', '53300': 'capacity', '57P03': 'capacity'}
    for conn in ('08000', '08001', '08003', '08004', '08006'):
        reasons[conn] = 'unreachable'
    reason = reasons.get(code, 'unreachable')
    hint = ('The database has not received this deployment\'s migrations.' if reason in ('schema_missing', 'column_missing')
            else 'The database is not reachable with the configured credentials.')
    LOG.warning('Database unavailable: %s', reason)
    return JSONResponse({'error': 'service_unavailable', 'reason': reason, 'hint': hint}, status_code=503)


def row_to_dict(row):
    from datetime import date, datetime
    from uuid import UUID
    from decimal import Decimal
    def transform(value):
        if isinstance(value, datetime):
            # JS Date.toJSON emits ISO 8601 with milliseconds and Z in UTC.
            v = value.astimezone(__import__('datetime').timezone.utc)
            return v.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        if isinstance(value, date): return value.isoformat()
        if isinstance(value, UUID): return str(value)
        if isinstance(value, Decimal): return float(value)
        if isinstance(value, (list, tuple)): return [transform(v) for v in value]
        if isinstance(value, dict): return {k: transform(v) for k, v in value.items()}
        return value
    return {k: transform(v) for k, v in dict(row).items()}


def is_database_unavailable(exc):
    return getattr(exc, 'sqlstate', None) in {
        '42P01','42703','3D000','28P01','28000','53300','57P03',
        '08000','08001','08003','08004','08006'}
