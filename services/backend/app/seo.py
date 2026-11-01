"""Public discovery documents and indexing policy for the native application."""
import ipaddress
import os
import re
from urllib.parse import urlsplit
from .runtime_config import environment
from .security import normalize_origin

CANONICAL = 'https://learnersarea.uz/'
PRIVATE_ROBOTS = 'noindex, nofollow, noarchive'
PRIVATE_SEGMENTS = (
    'app', 'api', '_frontend', 'onboarding', 'pending', 'dashboard', 'courses',
    'writing', 'vocabulary', 'listening', 'reading', 'speaking', 'grammar',
    'mocks', 'coach', 'assignments', 'progress', 'live-classes', 'video-lessons',
    'teacher', 'admin', 'owner', 'profile', 'notifications', 'reports', 'support',
    'management',
)


def canonical_home():
    """Explicit public identity only; incoming/forwarded hosts are untrusted."""
    configured = os.getenv('PUBLIC_BASE_URL') or os.getenv('NEXT_PUBLIC_APP_URL') or CANONICAL
    supplied = urlsplit(configured)
    origin = normalize_origin(configured)
    if (not origin or supplied.username is not None or supplied.password is not None or
            '%' in configured or any(c.isspace() or ord(c) < 32 for c in configured)):
        raise ValueError('invalid_public_origin')
    parsed = urlsplit(origin)
    host = parsed.hostname.encode('idna').decode('ascii')
    if ':' in host:
        host = '[' + str(ipaddress.IPv6Address(host)) + ']'
    elif not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label)
                 for label in host.rstrip('.').split('.')) or len(host) > 253:
        raise ValueError('invalid_public_origin')
    return f'{parsed.scheme}://{host}' + (f':{parsed.port}' if parsed.port else '') + '/'


def robots_document():
    home = canonical_home()
    if environment() == 'preview':
        return 'User-agent: *\nDisallow: /\n'
    return ('User-agent: *\nAllow: /$\n' +
            ''.join(f'Disallow: /{segment}\n' for segment in PRIVATE_SEGMENTS) +
            f'\nSitemap: {home}sitemap.xml\n')


def sitemap_document():
    home = canonical_home()
    location = '' if environment() == 'preview' else f'  <url><loc>{home}</loc></url>\n'
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
            location + '</urlset>\n')


def public_document(html):
    home = canonical_home()
    def metadata(match):
        block = match[0].replace(CANONICAL, home)
        if environment() == 'preview':
            block = block.replace('content="index,follow"', 'content="noindex,nofollow,noarchive"')
        return block
    return re.sub(r'<!--public-meta-start-->.*?<!--public-meta-end-->', metadata, html, flags=re.S)


def private_document(html):
    """The public welcome content and metadata never enter private documents."""
    html = re.sub(r'<!--public-meta-start-->.*?<!--public-meta-end-->',
                  '<meta name="robots" content="noindex,nofollow,noarchive">\n'
                  '<title>Learners Area</title>', html, flags=re.S)
    return re.sub(r'<!--public-content-start-->.*?<!--public-content-end-->',
                  '', html, flags=re.S)


class IndexingPolicy:
    """Apply noindex to every private response, including redirects and errors."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)

        async def indexed_send(message):
            if message['type'] == 'http.response.start':
                path = scope['path']
                public = (path in ('/', '/robots.txt', '/sitemap.xml') and
                          message['status'] == 200 and environment() != 'preview')
                policy = 'index, follow' if public else PRIVATE_ROBOTS
                message = dict(message)
                message['headers'] = [(k, v) for k, v in message.get('headers', [])
                                      if k.lower() != b'x-robots-tag']
                message['headers'].append((b'x-robots-tag', policy.encode('ascii')))
            await send(message)

        await self.app(scope, receive, indexed_send)
