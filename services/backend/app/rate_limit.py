"""Shared atomic PostgreSQL abuse limits; memory counters support database-free development only."""
import ipaddress
import hashlib
import hmac
import os
import re
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from fastapi import Request
from fastapi.responses import JSONResponse

RULES = {
    'login_account': (8, 900), 'login_ip': (40, 900), 'register': (10, 3600),
    'admission_request': (10, 3600), 'presence': (8, 60),
    'upload_intent': (120, 900),
    'ai_evaluation': (60, 900), 'text_evaluation': (180, 60),
}
BUCKETS: dict[tuple[str, str], tuple[int, float]] = {}


def _as_ip(value):
    candidate = value.strip() if isinstance(value,str) else ''
    if len(candidate)>80:return None
    if candidate.startswith('['):
        match=re.fullmatch(r'\[([0-9a-fA-F:.]+)\](?::([0-9]{1,5}))?',candidate)
        if not match or match[2] and int(match[2])>65535:return None
        candidate=match[1]
    elif candidate.count(':')==1 and '.' in candidate:
        candidate,port=candidate.rsplit(':',1)
        if not port.isascii() or not port.isdecimal() or not 0<=int(port)<=65535:return None
    if '%' in candidate:return None
    try:
        address=ipaddress.ip_address(candidate)
        return str(address.ipv4_mapped or address) if isinstance(address,ipaddress.IPv6Address) else str(address)
    except ValueError:return None


def client_key(req: Request) -> str:
    # Only OriginBoundary can attest the Cloudflare header, after checking the
    # shared origin secret. Other forwarding headers never establish identity.
    if req.scope.get('state',{}).get('cloudflare_origin_verified') is True:
        values=req.headers.getlist('cf-connecting-ip')
        candidate=_as_ip(values[0]) if len(values)==1 else None
        if candidate:return candidate
    return _as_ip(req.client.host if req.client else None) or 'unknown'


def counter(name, key, consume=False):
    limit, window = RULES[name]
    try: limit = max(1, int(os.environ.get(f'RATE_LIMIT_{name.upper()}', limit)))
    except ValueError: pass
    now = time.monotonic()
    k = (name, key)
    # Node.js bucketsFor() prunes every expired key of the accessed action.
    for old_key, (_, expires_at) in list(BUCKETS.items()):
        if old_key[0] == name and expires_at <= now: BUCKETS.pop(old_key, None)
    count, expires = BUCKETS.get(k, (0, now + window))
    if expires <= now: count, expires = 0, now + window
    if consume:
        count += 1
        BUCKETS[k] = (count, expires)
    if count >= limit + (1 if consume else 0):
        return max(1, int(__import__('math').ceil(expires - now)))
    return None


def too_many(delay: int) -> JSONResponse:
    return JSONResponse({'error': 'rate_limited', 'retryAfterSeconds': delay}, 429, {'Retry-After': str(delay)})


def reset(name, key):
    BUCKETS.pop((name, key), None)


# Production callers use the async interface below. Keeping the pure memory
# helper makes database-free development possible; it is never a production fallback.
class RateLimitUnavailable(ConnectionError):
    pass


@dataclass(frozen=True)
class Reservation:
    retry_after: int | None
    bucket: object
    window: object
    backend: str
    consumed: bool = False


def backend():
    selected=os.environ.get('RATE_LIMIT_BACKEND') or ('postgres' if os.environ.get('DATABASE_URL') else 'memory')
    production=os.environ.get('APP_ENV')=='production' or os.environ.get('RAILWAY_ENVIRONMENT_NAME')=='production'
    if selected not in ('postgres','memory') or selected=='memory' and production:
        raise RateLimitUnavailable('shared_rate_store_required')
    return selected


def _limits(name):
    limit,window=RULES[name]
    try:limit=max(1,min(1000000,int(os.environ.get('RATE_LIMIT_'+name.upper(),limit))))
    except ValueError:pass
    if not 1<=window<=86400:raise RateLimitUnavailable('invalid_rate_window')
    return limit,window


def _bucket(name,key):
    secret=os.environ.get('AUTH_SECRET','')
    if len(secret)<16:raise RateLimitUnavailable('rate_signing_key_unavailable')
    return hmac.new(secret.encode(),('rate-v1:'+name+'\0'+str(key)).encode(),hashlib.sha256).hexdigest()


@asynccontextmanager
async def _connection(existing=None):
    if existing is not None:
        yield existing
    else:
        from . import main as core
        db=await core.pool()
        async with db.acquire() as con:yield con


TAKE_SQL="""WITH taken AS (
 INSERT INTO api_rate_buckets(bucket_key,used,reset_at)
 VALUES($1,1,statement_timestamp()+$3::int*interval '1 second')
 ON CONFLICT(bucket_key) DO UPDATE SET
 used=CASE WHEN api_rate_buckets.reset_at<=statement_timestamp() THEN 1 ELSE api_rate_buckets.used+1 END,
 reset_at=CASE WHEN api_rate_buckets.reset_at<=statement_timestamp() THEN EXCLUDED.reset_at ELSE api_rate_buckets.reset_at END
 WHERE api_rate_buckets.reset_at<=statement_timestamp() OR api_rate_buckets.used<$2::int
 RETURNING used,reset_at
),pruned AS (
 DELETE FROM api_rate_buckets WHERE bucket_key IN (
  SELECT bucket_key FROM api_rate_buckets WHERE reset_at<statement_timestamp()-interval '1 hour'
   AND bucket_key<>$1 AND EXISTS(SELECT 1 FROM taken WHERE used=1)
  ORDER BY reset_at LIMIT 8 FOR UPDATE SKIP LOCKED
 ) RETURNING 1
)
SELECT used,reset_at,(SELECT count(*) FROM pruned) AS pruned FROM taken"""
PEEK_SQL="""SELECT used,reset_at,
 GREATEST(1,ceil(extract(epoch FROM reset_at-statement_timestamp())))::int AS retry_after
 FROM api_rate_buckets WHERE bucket_key=$1 AND reset_at>statement_timestamp()"""


async def reserve(name,key,consume=True,*,connection=None):
    mode=backend()
    if mode=='memory':
        delay=counter(name,key,consume)
        window=BUCKETS.get((name,key),(0,None))[1]
        return Reservation(delay,(name,key),window,mode,consume and not delay)
    bucket=_bucket(name,key);limit,window=_limits(name)
    try:
        async with _connection(connection) as con:
            if consume:
                row=await con.fetchrow(TAKE_SQL,bucket,limit,window)
                if row:return Reservation(None,bucket,row['reset_at'],mode,True)
            row=await con.fetchrow(PEEK_SQL,bucket)
            delay=(int(row['retry_after']) if row and (consume or row['used']>=limit) else 1 if consume else None)
            return Reservation(delay,bucket,row['reset_at'] if row else None,mode)
    except RateLimitUnavailable:raise
    except Exception:raise RateLimitUnavailable('shared_rate_store_unavailable') from None


async def async_counter(name,key,consume=False,*,connection=None):
    return (await reserve(name,key,consume,connection=connection)).retry_after


async def release(reservation,*,connection=None):
    if not reservation.consumed:return
    if reservation.backend=='memory':
        current=BUCKETS.get(reservation.bucket)
        if current and current[1]==reservation.window:
            BUCKETS[reservation.bucket]=(max(0,current[0]-1),current[1])
        return
    try:
        async with _connection(connection) as con:
            await con.execute('UPDATE api_rate_buckets SET used=GREATEST(0,used-1) WHERE bucket_key=$1 AND reset_at=$2',reservation.bucket,reservation.window)
    except Exception:raise RateLimitUnavailable('shared_rate_store_unavailable') from None


async def async_reset(name,key,*,connection=None,window=None):
    if backend()=='memory':
        if window is None or BUCKETS.get((name,key),(None,None))[1]==window:reset(name,key)
        return
    try:
        async with _connection(connection) as con:
            if window is None:await con.execute('DELETE FROM api_rate_buckets WHERE bucket_key=$1',_bucket(name,key))
            else:await con.execute('DELETE FROM api_rate_buckets WHERE bucket_key=$1 AND reset_at=$2',_bucket(name,key),window)
    except Exception:raise RateLimitUnavailable('shared_rate_store_unavailable') from None


async def ready(con):
    if backend()=='postgres':
        _bucket('readiness','schema')
        await con.fetchval('SELECT bucket_key FROM api_rate_buckets LIMIT 0')


async def evaluation_limit(user_id,*,lightweight=False,connection=None):
    name='text_evaluation' if lightweight else 'ai_evaluation'
    delay=await async_counter(name,str(user_id),consume=True,connection=connection)
    return too_many(delay) if delay else None
