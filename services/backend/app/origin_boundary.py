"""Optional shared-secret origin boundary for a Cloudflare-proxied deployment.

Off until an operator installs the same strong value in the Cloudflare request
header transform and Railway environment. This is not user authentication.
"""
import os
from secrets import compare_digest
from starlette.responses import JSONResponse

HEADER = b'x-la-origin-verify'
ENV = 'CLOUDFLARE_ORIGIN_SECRET'


class OriginBoundary:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] not in ('http', 'websocket'):
            return await self.app(scope, receive, send)
        secret = os.environ.get(ENV, '')
        if not secret:
            return await self.app(scope, receive, send)
        valid = 32 <= len(secret) <= 256 and secret.isascii() and not any(c.isspace() for c in secret)
        path = scope.get('path', '')
        # Railway probes do not pass through Cloudflare. Readiness must still fail
        # for a malformed configured boundary rather than deploying an unusable app.
        if scope['type'] == 'http' and (path in ('/health', '/healthz') or path == '/readyz' and valid):
            return await self.app(scope, receive, send)
        values = [v for k, v in scope.get('headers', ()) if k.lower() == HEADER]
        allowed = valid and len(values) == 1 and compare_digest(values[0], secret.encode('ascii'))
        edge_verified = allowed
        # The existing bot credential keeps internal Telegram calls working even
        # when they use Railway's origin URL. It cannot open any learner route.
        if valid and not allowed and scope['type'] == 'http' and path.startswith('/api/internal/telegram/'):
            bot_secret = os.environ.get('BOT_SERVICE_SECRET', '')
            auth = [v for k, v in scope.get('headers', ()) if k.lower() == b'authorization']
            allowed = bool(bot_secret and len(auth) == 1 and
                           compare_digest(auth[0], ('Bearer ' + bot_secret).encode('utf-8')))
        if allowed:
            scope.setdefault('state', {})['cloudflare_origin_verified'] = edge_verified
            return await self.app(scope, receive, send)
        # Reject before reading uploads, querying authority, or opening a stream.
        if scope['type'] == 'websocket':
            await send({'type': 'websocket.close', 'code': 1008})
            return
        response = JSONResponse({'error': 'origin_unavailable' if not valid else 'origin_forbidden'},
                                status_code=503 if not valid else 403,
                                headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})
        await response(scope, receive, send)
