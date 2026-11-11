"""Host the existing signalling protocol in the single-worker Railway process."""
from __future__ import annotations

from functools import lru_cache
import importlib.util
import os
from pathlib import Path
from urllib.parse import urlsplit

from starlette.responses import JSONResponse

PREFIX = '/api/live-partner/signaling'


def configuration() -> tuple[str, str] | None:
    secret = os.getenv('LIVE_PARTNER_SIGNAL_SECRET', '')
    public = os.getenv('PUBLIC_BASE_URL', '').rstrip('/')
    endpoint = urlsplit(public)
    if len(secret) < 32 or endpoint.scheme != 'https' or not endpoint.netloc or endpoint.path:
        return None
    return secret, public


def hosted_url() -> str | None:
    settings = configuration()
    return 'wss://' + urlsplit(settings[1]).netloc + PREFIX + '/signal' if settings else None


@lru_cache(maxsize=1)
def relay(secret: str, origin: str):
    # The standalone service lives in a legacy directory with a hyphen. Load
    # that trusted file so both deployments retain one protocol implementation.
    source = Path(__file__).resolve().parents[2] / 'live-signal' / 'server.py'
    spec = importlib.util.spec_from_file_location('learners_area_signal', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.create_app(secret=secret, allowed_origins=[origin])


async def dispatch(scope, receive, send):
    settings = configuration()
    if not settings:
        if scope['type'] == 'websocket':
            await send({'type': 'websocket.close', 'code': 1008})
        else:
            await JSONResponse({'error': 'realtime_not_configured'}, 503,
                               headers={'Cache-Control': 'private, no-store'})(scope, receive, send)
        return
    child = dict(scope)
    child['path'] = scope['path'][len(PREFIX):] or '/'
    await relay(*settings)(child, receive, send)
