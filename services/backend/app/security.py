"""Transport, session tokens and origin checks ported from src/lib/auth + src/lib/http.

HS256 tokens are wire-compatible with jose JWT tokens used by the original.
No role/permissions are trusted from JWT; live PostgreSQL authority is required.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import time
import uuid
from urllib.parse import urlsplit
from fastapi import Request
from fastapi.responses import Response

SESSION_COOKIE = 'la_session'
SESSION_TTL = 60 * 60 * 24 * 30
JS_MAX_SAFE_INTEGER = 2 ** 53 - 1
ROLES = {'student', 'teacher', 'admin', 'owner'}


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def _decode(data: str) -> bytes:
    if not re.fullmatch(r'[A-Za-z0-9_-]+', data):
        raise ValueError('invalid b64')
    return base64.urlsafe_b64decode(data + '=' * ((-len(data)) % 4))


def secret() -> bytes:
    key = os.environ.get('AUTH_SECRET', '')
    if len(key) < 16:
        raise RuntimeError('AUTH_SECRET must contain at least 16 characters')
    return key.encode('utf8')


def issue_token(user: dict) -> str:
    now = int(time.time())
    header = {'alg': 'HS256', 'typ': 'JWT'}
    body = {'sub': str(user['id']), 'authVersion': user.get('auth_version', 0), 'role': user['role'],
            'name': user['name'], 'locale': user['locale'],
            'onboarded': bool(user.get('onboarding_completed_at')), 'jti': str(uuid.uuid4()),
            'iat': now, 'exp': now + SESSION_TTL}
    signed = '.'.join((_b64(json.dumps(header, separators=(',', ':')).encode()),
                       _b64(json.dumps(body, separators=(',', ':')).encode())))
    return signed + '.' + _b64(hmac.digest(secret(), signed.encode('ascii'), 'sha256'))


def verify_token(token: str | None) -> dict | None:
    if not token or len(token) > 16000:
        return None
    try:
        h, p, s = token.split('.')
        if not hmac.compare_digest(hmac.digest(secret(), f'{h}.{p}'.encode(), 'sha256'), _decode(s)):
            return None
        header, payload = json.loads(_decode(h)), json.loads(_decode(p))
        if not isinstance(header, dict) or header.get('alg') != 'HS256' or not isinstance(payload, dict):
            return None
        # jose's jwtVerify validates standard NumericDate claims and rejects
        # critical protected-header extensions it cannot process.
        if 'crit' in header and header['crit']:
            return None
        if 'iat' in payload and (type(payload['iat']) not in (int, float) or
                                 not math.isfinite(payload['iat'])):
            return None
        if 'nbf' in payload and (type(payload['nbf']) not in (int, float) or
                                 not math.isfinite(payload['nbf'])):
            return None
        version = payload.get('authVersion', 0)
        exp = payload.get('exp')
        if (not isinstance(payload.get('sub'), str) or payload.get('role') not in ROLES or
            not isinstance(payload.get('name'), str) or not isinstance(payload.get('locale'), str) or
            not isinstance(payload.get('onboarded'), bool) or type(version) is not int or
            not 0 <= version <= JS_MAX_SAFE_INTEGER or
            type(exp) is not int or not 0 <= exp <= JS_MAX_SAFE_INTEGER or exp <= int(time.time()) or
            (payload.get('nbf') is not None and payload.get('nbf') > time.time())):
            return None
        payload['authVersion'] = version
        payload['expiresAt'] = exp
        payload['sessionKey'] = hashlib.sha256(token.encode()).hexdigest()
        return payload
    except (ValueError, TypeError, RuntimeError, UnicodeError):
        return None


def normalize_origin(s: str | None) -> str | None:
    if not s: return None
    try:
        p = urlsplit(s.strip())
        if (p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password or
            p.path not in ('', '/') or p.query or p.fragment):
            return None
        port = p.port
        host = p.hostname.lower()
        if ':' in host: host = '[' + host + ']'
        return f'{p.scheme}://{host}' + (f':{port}' if port and port != (443 if p.scheme == 'https' else 80) else '')
    except ValueError:
        return None


def request_origin(req: Request) -> str:
    env = os.environ
    trust = env.get('TRUST_PROXY_HEADERS') == 'true'
    if trust:
        host = (req.headers.get('x-forwarded-host') or req.headers.get('host') or '').split(',')[0].strip()
        proto = (req.headers.get('x-forwarded-proto') or '').split(',')[0].strip()
        if proto in ('http', 'https') and host:
            resolved = normalize_origin(f'{proto}://{host}')
            if resolved: return resolved
    return normalize_origin(f'{req.url.scheme}://{req.headers.get("host", req.url.netloc)}') or str(req.base_url).rstrip('/')


def check_origin(req: Request) -> tuple[bool, str | None]:
    if req.method.upper() in ('GET', 'HEAD', 'OPTIONS'):
        return True, None
    trusted = {request_origin(req)}
    for value in (os.environ.get('TRUSTED_ORIGINS', '').split(',') +
                  [os.environ.get('PUBLIC_BASE_URL', '')]):
        o = normalize_origin(value)
        if o: trusted.add(o)
    origin = req.headers.get('origin')
    if origin:
        if origin == 'null': return False, 'opaque_origin'
        return (True, None) if normalize_origin(origin) in trusted else (False, 'cross_origin')
    referer = req.headers.get('referer')
    if referer:
        try:
            u = urlsplit(referer)
            origin_of_referer = normalize_origin(f'{u.scheme}://{u.netloc}')
            if origin_of_referer in trusted: return True, None
        except ValueError:
            pass
        return False, 'cross_origin_referer'
    if req.headers.get('sec-fetch-site') == 'cross-site':
        return False, 'cross_site_without_origin'
    return True, None


def is_https(req: Request) -> bool:
    return bool(req.url.scheme == 'https' or
                req.headers.get('x-forwarded-proto', '').split(',')[0].lower().strip() == 'https' or
                req.headers.get('origin', '').lower().startswith('https://') or
                req.headers.get('referer', '').lower().startswith('https://'))


def cookie_attrs(req: Request) -> tuple[str, bool, bool]:
    secure = is_https(req)
    return ('None' if secure else 'Lax', secure, secure)


def clear_session_cookie(response: Response, req: Request) -> None:
    samesite, secure, partitioned = cookie_attrs(req)
    clear = f'{SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite={samesite}'
    if secure: clear += '; Secure'
    if partitioned: clear += '; Partitioned'
    response.headers.append('set-cookie', clear)
    if partitioned:
        response.headers.append('set-cookie', f'{SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax')


def write_cookie(response: Response, req: Request, name: str, value: str, ttl: int, http_only=False) -> None:
    same_site, secure, partitioned = cookie_attrs(req)
    value = value.replace('\n', '').replace('\r', '').replace(';', '')
    cookie = f'{name}={value}; Path=/; Max-Age={ttl}; SameSite={same_site}'
    if http_only: cookie += '; HttpOnly'
    if secure: cookie += '; Secure'
    if partitioned: cookie += '; Partitioned'
    response.headers.append('set-cookie', cookie)


def build_csp(req: Request, nonce: str) -> str:
    secure, dev = is_https(req), (os.environ.get('APP_ENV') != 'production')
    def origins(name): return [n for v in os.environ.get(name, '').split(',') if (n := normalize_origin(v))]
    storage = [n for s in (os.environ.get('R2_ENDPOINT'), os.environ.get('S3_ENDPOINT')) if (n := normalize_origin(s))]
    media = normalize_origin(os.environ.get('AUTHORIZED_MEDIA_ORIGIN'))
    worker = normalize_origin(os.environ.get('MEDIA_WORKER_URL'))
    worker = worker if worker == 'https://learnersarea-media.owneruchunla.workers.dev' else None
    connect = list(dict.fromkeys(origins('CSP_CONNECT_SRC') + storage + ([worker] if worker else [])))
    signal = os.environ.get('LIVE_PARTNER_SIGNAL_URL', '')
    if signal.startswith('wss://'):
        try:
            u = urlsplit(signal)
            if u.hostname and not u.username and not u.password: connect.append(f'wss://{u.netloc}')
        except ValueError: pass
    frame = ["'self'"] + origins('ALLOWED_FRAME_ANCESTORS')
    scripts = ["'self'", f"'nonce-{nonce}'", "'strict-dynamic'"] + (["'unsafe-eval'"] if dev else [])
    directives = ["default-src 'self'", "base-uri 'self'", "object-src 'none'",
                  'frame-ancestors ' + ' '.join(frame), "form-action 'self'",
                  'script-src ' + ' '.join(scripts), "style-src 'self' 'unsafe-inline'",
                  "img-src 'self' data: blob: https:",
                  "media-src 'self' blob: data: " + ' '.join(storage + ([media] if media else []) + ([worker] if worker else [])),
                  "font-src 'self' data:",
                  'connect-src ' + ' '.join(["'self'"] + connect + (['ws:', 'wss:'] if dev else [])),
                  "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://oauth.telegram.org",
                  "worker-src 'self' blob:", "manifest-src 'self'"]
    if secure: directives.append('upgrade-insecure-requests')
    return '; '.join(d.strip() for d in directives)


def add_security_headers(response: Response, req: Request) -> None:
    # The authenticated Listening launcher has a stricter opaque-origin sandbox
    # policy with its own inline bootstrap. Do not overwrite that route policy.
    if 'content-security-policy' not in response.headers:
        response.headers['content-security-policy'] = build_csp(req, uuid.uuid4().hex)
    response.headers['x-content-type-options'] = 'nosniff'
    response.headers['referrer-policy'] = 'strict-origin-when-cross-origin'
    response.headers['permissions-policy'] = 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)'
    response.headers['x-dns-prefetch-control'] = 'off'
    if is_https(req) and os.environ.get('APP_ENV') == 'production':
        response.headers['strict-transport-security'] = 'max-age=15552000; includeSubDomains'
