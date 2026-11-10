"""Managed-preview launcher: real ASGI, disposable DB, synthetic decodable media.

Use through sites-preview, not as a production process. Both frontend revisions
use their original StaticFrontend implementation and the real auth/API routes.
Instrumentation is injected only by this test wrapper and never shipped.
"""
from __future__ import annotations
import argparse
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

from isolated_db import OwnedDatabase, ROOT, PASSWORD


def load_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


async def run(args):
    out = Path(args.artifacts).resolve(); out.mkdir(parents=True, exist_ok=True)
    db = OwnedDatabase(out.parent)
    try:
        await db.start()
        os.environ['PUBLIC_BASE_URL'] = f'http://localhost:{args.port}'
        media = db.root/'media/listening/fixture.mp3'; media.parent.mkdir(parents=True)
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i',
            'sine=frequency=440:sample_rate=22050:duration=3660','-af','volume=0.002',
            '-ac','1','-b:a','16k',str(media)], check=True)
        builder = load_file('phase2_builder', ROOT/'scripts/build_native_assets.py')
        roots = {}
        for stage, source in [('before', Path(args.baseline).resolve()), ('after', ROOT/'frontend/vanilla')]:
            dest = out.parent/('browser-'+stage)
            shutil.copytree(source, dest, dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('build','node_modules','tests','.build-*'))
            result = builder.build(dest); roots[stage] = dest/'build'
            (out/f'build-{stage}.json').write_text(json.dumps(result, indent=2)+'\n')
        from app import asgi
        from app.frontend_static import StaticFrontend
        from starlette.responses import Response, JSONResponse
        import uvicorn
        old = load_file('app.phase2_baseline_static', Path(args.baseline).parents[1]/'services/backend/app/frontend_static.py')

        class FixedBuild:
            def build(self): return self.root, self.manifest

        variants = {}
        for stage, cls in [('before', old.StaticFrontend), ('after', StaticFrontend)]:
            typ = type('Fixed'+stage, (FixedBuild, cls), {})
            obj = typ(); obj.root = roots[stage]
            obj.manifest = json.loads((obj.root/'asset-manifest.json').read_text())
            variants[stage] = obj

        class DualStatic:
            async def __call__(self, scope, receive, send):
                headers = dict(scope.get('headers', []))
                before = b'phase2_stage=before' in headers.get(b'cookie', b'')
                for stage, obj in variants.items():
                    if scope.get('path','').startswith('/assets/'+obj.manifest['revision']+'/'):
                        before = stage == 'before'
                await variants['before' if before else 'after'](scope, receive, send)
        asgi.static = DualStatic()
        probe = (ROOT/'frontend/vanilla/tests/performance-phase2/browser-probe.js').read_bytes()

        async def application(scope, receive, send):
            if scope['type'] == 'http' and scope['path'].startswith('/__qa'):
                from urllib.parse import parse_qs
                q = parse_qs(scope.get('query_string',b'').decode())
                if scope['path'] == '/__qa/probe.js':
                    return await Response(probe, media_type='application/javascript', headers={'Cache-Control':'no-store'})(scope, receive, send)
                if scope['path'] == '/__qa/metrics' and scope['method'] == 'POST':
                    body = b''
                    while True:
                        msg = await receive(); body += msg.get('body',b'')
                        if len(body)>200000: return await Response(status_code=413)(scope, receive, send)
                        if not msg.get('more_body'): break
                    value = json.loads(body)
                    with (out/'browser-metrics.ndjson').open('a') as f: f.write(json.dumps(value)+'\n')
                    return await JSONResponse({'ok':True})(scope, receive, send)
                if scope['path'] == '/__qa':
                    route = q.get('route',['/login'])[0]
                    if not route.startswith(('/app','/login')): route='/login'
                    width = max(320,min(1920,int(q.get('width',['1440'])[0])))
                    stage = 'before' if q.get('stage')==['before'] else 'after'
                    theme = 'night' if q.get('theme')==['night'] else 'day'
                    import html
                    page = f'''<!doctype html><html><head><meta charset="utf-8"><title>Isolated Phase 2 QA</title>
<style>body{{margin:0;font:12px system-ui;background:#e2e8f0}}header{{padding:8px;display:flex;gap:8px;align-items:center}}button{{padding:8px}}main{{display:flex;justify-content:center}}iframe{{border:0;transform-origin:top center;flex:0 0 {width}px;background:white}}pre{{margin:0;max-height:140px;overflow:auto;padding:8px}}</style></head><body>
<header>ISOLATED REAL ASGI · synthetic data/media · {stage} · {width}px
<button data-run="snapshot">Snapshot</button><button data-run="reading">200 input events</button><button data-run="navigation">20 SPA navigations</button><button data-run="soak">Start 60-min observation</button><button data-run="soak-nav">Start navigation soak</button></header>
<pre id="qa-report">Waiting for app instrumentation</pre><main><iframe title="Learners Area isolated application" width="{width}" height="900" src="{html.escape(route,quote=True)}"></iframe></main>
<script>const f=document.querySelector('iframe');function fit(){{const s=Math.min(1,(innerWidth-12)/{width},(innerHeight-190)/900);f.style.transform='scale('+s+')';f.parentElement.style.height=900*s+'px'}}fit();addEventListener('resize',fit);addEventListener('message',e=>{{if(e.origin===location.origin&&e.data?.phase2)document.querySelector('#qa-report').textContent=JSON.stringify(e.data.phase2,null,2)}});document.querySelectorAll('[data-run]').forEach(b=>b.onclick=()=>f.contentWindow.postMessage({{phase2Command:b.dataset.run}},location.origin));</script></body></html>'''
                    response = Response(page, media_type='text/html', headers={'Cache-Control':'no-store'})
                    response.set_cookie('phase2_stage',stage); response.set_cookie('la_theme',theme)
                    # Authenticate the already-seeded disposable QA user through
                    # the unchanged login endpoint. No production session or
                    # alternative authentication mechanism is introduced.
                    if b'la_session=' not in dict(scope.get('headers',[])).get(b'cookie',b''):
                        import httpx
                        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=asgi.application),base_url=f'http://localhost:{args.port}') as client:
                            login=await client.post('/api/auth/login',json={'email':'phase2@example.test','password':PASSWORD},headers={'Origin':f'http://localhost:{args.port}'})
                            assert login.status_code==200, 'Disposable fixture login failed'
                            for cookie in login.headers.get_list('set-cookie'): response.headers.append('set-cookie',cookie)
                    return await response(scope, receive, send)
                return await Response(status_code=404)(scope, receive, send)
            async def instrument(message):
                if message['type']=='http.response.start':
                    nonlocal nonce, modify
                    hs = dict(message.get('headers',[]))
                    modify = b'text/html' in hs.get(b'content-type',b'') and message['status']==200
                    match = re.search(rb"'nonce-([^']+)'",hs.get(b'content-security-policy',b''))
                    nonce = match.group(1) if match else b''
                    if modify:
                        message = {**message,'headers':[(k,v) for k,v in message['headers'] if k.lower()!=b'content-length']}
                elif message['type']=='http.response.body' and modify:
                    tag = b'<script nonce="'+nonce+b'" src="/__qa/probe.js"></script>'
                    message = {**message,'body':message.get('body',b'').replace(b'<head>',b'<head>'+tag,1)}
                await send(message)
            nonce=b''; modify=False
            await asgi.application(scope, receive, instrument)
        (out/'preview-fixture.json').write_text(json.dumps({'syntheticOnly':True,'realAuthApi':True,
            'postgresVersion':'18.6','volume':db.volume,'mediaSeconds':3660,
            'mediaType':'audio/mpeg','productionAudioVerified':False},indent=2)+'\n')
        print('Isolated real ASGI preview ready', flush=True)
        await uvicorn.Server(uvicorn.Config(application,host='0.0.0.0',port=args.port,
            log_level='warning',access_log=False)).serve()
    finally: db.close()


if __name__ == '__main__':
    p=argparse.ArgumentParser(); p.add_argument('--port', type=int, default=4173)
    p.add_argument('--host', default='127.0.0.1'); p.add_argument('--strictPort', action='store_true')
    p.add_argument('--baseline', required=True); p.add_argument('--artifacts',required=True)
    asyncio.run(run(p.parse_args()))
