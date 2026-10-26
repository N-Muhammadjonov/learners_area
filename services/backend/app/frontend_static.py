"""Allowlisted static build and SPA documents; no repository-directory serving."""
from __future__ import annotations

import json
import mimetypes
import os
import re
import secrets
from pathlib import Path
from urllib.parse import quote
from urllib.parse import urlencode, parse_qsl
from fastapi import Request
from fastapi.responses import FileResponse, RedirectResponse, Response
from . import main as core
from .security import add_security_headers, build_csp

ROOT = Path(__file__).resolve().parents[3]
PUBLIC_PAGES = frozenset(('/', '/login', '/register', '/reset-password', '/reset-password/confirm', '/auth/recovery'))
PREFIXES = ('/api', '/_frontend', '/.git', '/.env', '/services', '/src', '/drizzle', '/node_modules')


class StaticFrontend:
    def __init__(self):
        self._cache = None

    def build(self):
        root = Path(os.getenv('FRONTEND_DIST', str(ROOT / 'frontend/vanilla/build'))).resolve()
        manifest = root / 'asset-manifest.json'
        try:
            stat = manifest.stat()
            key = (str(root), stat.st_mtime_ns, stat.st_size)
            if not self._cache or self._cache[0] != key:
                doc = json.loads(manifest.read_text())
                if doc.get('version') != 1 or not isinstance(doc.get('files'), dict) or not isinstance(doc.get('routes'), list):
                    return None
                self._cache = key, root, doc
            return self._cache[1:]
        except (OSError, ValueError, TypeError):
            return None

    async def __call__(self, scope, receive, send):
        req = Request(scope, receive)
        path = req.url.path
        response = None
        if req.method not in ('GET', 'HEAD'):
            response = core.j({'error': 'method_not_allowed'}, 405, {'Allow': 'GET, HEAD'})
        elif path == '/healthz':
            response = core.j({'ok': True, 'service': 'learners-area-fastapi'}, headers=core.PRIVATE)
        elif path == '/readyz':
            try:
                db = await core.pool()
                async with db.acquire() as con:
                    await con.fetchval('SELECT 1')
                response = core.j({'ok': True, 'frontend': self.build() is not None}, headers=core.PRIVATE)
                if not self.build():
                    response.status_code = 503
            except Exception as exc:
                response = core.db_failure(exc)
        elif any(path == p or path.startswith(p + '/') for p in PREFIXES):
            response = core.j({'error': 'not_found'}, 404)
        elif ('\\' in path or '%' in path or any(ord(c) < 32 for c in path)
              or any(part.startswith('.') for part in path.split('/') if part)):
            response = core.j({'error': 'not_found'}, 404)
        else:
            built = self.build()
            if not built:
                response = core.j({'error': 'frontend_build_missing'}, 503, core.PRIVATE)
            else:
                root, manifest = built
                redirect = None
                for rule in manifest.get('redirects',[]):
                    source,destination = rule['source'],rule['destination']
                    prefix = source.removesuffix('/:path*')
                    if path==source or source.endswith('/:path*') and path.startswith(prefix+'/'):
                        tail = path[len(prefix)+1:] if source.endswith('/:path*') else ''
                        redirect = destination.replace(':path*',tail)
                        break
                if path=='/app/reading':
                    aliases={'academic':'academic','practice':'academic','general-reading':'general','types':'general','retention':'retention'}
                    tab=req.query_params.get('tab')
                    destination=aliases.get(tab)
                    if tab=='general': redirect='/app/reading'
                    else:
                        destination=destination or ('general' if any(k in req.query_params for k in ('q','topic','type','status','page')) else 'lessons')
                        keep={k:req.query_params[k] for k in ('q','topic','type','status','page') if req.query_params.get(k)}
                        redirect='/app/reading/'+destination+('?' + urlencode(keep) if keep else '')
                    response = RedirectResponse(redirect,307,headers=core.PRIVATE)
                elif redirect:
                    target_path,_,search=redirect.partition('?')
                    params=dict(parse_qsl(req.url.query));params.update(dict(parse_qsl(search)))
                    response=RedirectResponse(target_path+('?' + urlencode(params) if params else ''),307,headers=core.PRIVATE)
                name = path.lstrip('/')
                versioned = False
                if name.startswith('assets/'):
                    parts = name.split('/',2)
                    if len(parts)!=3 or parts[1]!=manifest.get('revision'):
                        response = core.j({'error':'asset_version_changed'},404,
                            {'Cache-Control':'no-store','X-Learners-Asset-Version':manifest.get('revision','')})
                    else:
                        name=parts[2];versioned=True
                if response is not None:
                    pass
                elif name in manifest['files'] and name != 'index.html':
                    target = (root / name).resolve()
                    if target.is_relative_to(root) and target.is_file() and not target.is_symlink():
                        row=manifest['files'][name]
                        cache='public, max-age=31536000, immutable' if versioned else 'public, max-age=0, must-revalidate'
                        accepts={part.split(';',1)[0].strip():part for part in req.headers.get('accept-encoding','').lower().split(',')}
                        gzip_allowed='gzip' in accepts and not re.search(r'q\s*=\s*0(?:\.0*)?\s*(?:;|$)',accepts['gzip'])
                        compressed=root/row['gzip'] if row.get('gzip') and gzip_allowed and 'range' not in req.headers else None
                        if compressed and (not compressed.resolve().is_relative_to(root) or not compressed.is_file() or compressed.is_symlink()):
                            compressed=None
                        etag='"'+(row.get('gzipSha256',row['sha256']+'-gzip') if compressed else row['sha256'])+'"'
                        headers={'Cache-Control':cache,'ETag':etag,'Vary':'Accept-Encoding','X-Learners-Asset-Version':manifest.get('revision','')}
                        if etag in [value.strip() for value in req.headers.get('if-none-match','').split(',')]:
                            response=Response(status_code=304,headers=headers)
                        elif compressed:
                            response=FileResponse(compressed,media_type=mimetypes.guess_type(name)[0] or 'application/octet-stream',headers={**headers,'Content-Encoding':'gzip'})
                        else:
                            response=FileResponse(target,headers=headers)
                else:
                    matched = path in PUBLIC_PAGES or any(
                        re.fullmatch(pattern, path) for pattern in manifest['routes'])
                    if matched:
                        user = None
                        if path not in PUBLIC_PAGES:
                            try:
                                user = await core.current_user(req)
                            except Exception as exc:
                                response = core.db_failure(exc)
                            if response is None:
                                if not user:
                                    response = RedirectResponse('/login?next=' + quote(path + ('?' + req.url.query if req.url.query else ''), safe=''), 303)
                                elif user['account_status'] != 'active' and path != '/pending':
                                    response = RedirectResponse('/pending', 303)
                                elif path == '/pending' and user['account_status'] == 'active':
                                    response = RedirectResponse('/app', 303)
                                elif path.startswith('/app/owner') and user['role'] != 'owner':
                                    response = RedirectResponse('/app', 303)
                                elif path.startswith('/app/admin') and not re.match(r'^/app/admin/(materials|video-lessons)(/|$)',path) and user['role'] not in ('admin','owner'):
                                    response = RedirectResponse('/app',303)
                                elif re.match(r'^/app/(management|teacher|admin)(/|$)', path) and user['role'] not in ('teacher', 'admin', 'owner'):
                                    response = RedirectResponse('/app', 303)
                        if response is None:
                            nonce = secrets.token_hex(16)
                            html = (root / 'index.html').read_text()
                            html = re.sub(r'<script\b', f'<script nonce="{nonce}"', html)
                            response = Response(html, media_type='text/html', headers={
                                **core.PRIVATE, 'Content-Security-Policy': build_csp(req, nonce)})
                if response is None:
                    response = core.j({'error': 'not_found'}, 404)
        add_security_headers(response, req)
        await response(scope, receive, send)
