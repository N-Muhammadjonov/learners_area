"""Public discovery documents and indexing policy for the native application."""
import re

CANONICAL = 'https://learnersarea.uz/'
PRIVATE_ROBOTS = 'noindex, nofollow, noarchive'
PRIVATE_SEGMENTS = (
    'app', 'api', '_frontend', 'onboarding', 'pending', 'dashboard', 'courses',
    'writing', 'vocabulary', 'listening', 'reading', 'speaking', 'grammar',
    'mocks', 'coach', 'assignments', 'progress', 'live-classes', 'video-lessons',
    'teacher', 'admin', 'owner', 'profile', 'notifications', 'reports', 'support',
    'management',
)
ROBOTS = ('User-agent: *\nAllow: /$\n' +
          ''.join(f'Disallow: /{segment}\n' for segment in PRIVATE_SEGMENTS) +
          f'\nSitemap: {CANONICAL}sitemap.xml\n')
SITEMAP = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           f'  <url><loc>{CANONICAL}</loc></url>\n</urlset>\n')


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
                public = path in ('/', '/robots.txt', '/sitemap.xml') and message['status'] == 200
                policy = 'index, follow' if public else PRIVATE_ROBOTS
                message = dict(message)
                message['headers'] = [(k, v) for k, v in message.get('headers', [])
                                      if k.lower() != b'x-robots-tag']
                message['headers'].append((b'x-robots-tag', policy.encode('ascii')))
            await send(message)

        await self.app(scope, receive, indexed_send)
