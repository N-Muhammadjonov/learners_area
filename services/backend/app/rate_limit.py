"""In-process fixed-window counters with the original per-action limits."""
import ipaddress
import os
import time
from fastapi import Request
from fastapi.responses import JSONResponse

RULES = {
    'login_account': (8, 900), 'login_ip': (40, 900), 'register': (10, 3600),
    'admission_request': (10, 3600), 'presence': (8, 60),
    'upload_intent': (120, 900),
}
BUCKETS: dict[tuple[str, str], tuple[int, float]] = {}


def _as_ip(value):
    """Match rate-limit.ts asIpAddress including IPv4 proxy :port."""
    candidate = value.strip() if value else ''
    if not candidate: return None
    if candidate.startswith('['):
        bare = candidate[1:].split(']', 1)[0]
    elif candidate.count(':') == 1:
        bare = candidate.split(':', 1)[0]
    else:
        bare = candidate
    if __import__('re').fullmatch(r'(?:\d{1,3}\.){3}\d{1,3}', bare):
        return bare if all(int(part) <= 255 for part in bare.split('.')) else None
    if ':' in bare and __import__('re').fullmatch(r'[0-9a-f:]+', bare, __import__('re').I):
        return bare.lower()
    return None


def client_key(req: Request) -> str:
    for header in ('x-vercel-forwarded-for', 'x-real-ip'):
        value = req.headers.get(header)
        if value:
            candidate = _as_ip(value)
            if candidate: return candidate
    hops = (req.headers.get('x-forwarded-for') or '').split(',')
    for candidate in reversed(hops):
        candidate = _as_ip(candidate)
        if candidate: return candidate
    return 'local'


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
