"""Isolated real-API browser fixture; never included in the application build.

Faults are explicitly armed from the QA toolbar and affect disposable data only.
This runner contains no long-session/soak scheduling.
"""
from __future__ import annotations
import argparse,asyncio,gzip,json,os,re,subprocess,time
from pathlib import Path
from urllib.parse import parse_qs
from isolated_db import OwnedDatabase,ROOT,UID,PASSWORD


async def run(args):
    out=Path(args.artifacts).resolve();out.mkdir(parents=True,exist_ok=True)
    db=OwnedDatabase(out);release=asyncio.Event();mode='none';events=[]
    try:
        await db.start()
        import httpx,uvicorn
        from app import asgi
        from app.db import pool,close_pool
        from browser_fixtures import id as fid
        from starlette.responses import Response,JSONResponse
        from app.frontend_static import StaticFrontend
        class FixedStatic(StaticFrontend):
            def __init__(self,root):self.root=root;self.manifest=json.loads((root/'asset-manifest.json').read_text())
            def build(self):return self.root,self.manifest
        variants={'after':FixedStatic(ROOT/'frontend/vanilla/build')}
        if args.baseline:variants['before']=FixedStatic(Path(args.baseline)/'build')
        media=db.root/'media/listening/fixture.mp3';media.parent.mkdir(parents=True)
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=22050:duration=180','-af','volume=0.002','-ac','1','-b:a','16k',str(media)],check=True)
        async with (await pool()).acquire() as c:
            await c.execute("UPDATE listening_packages SET payload=jsonb_set(payload,'{audio,durationSec}','180'::jsonb) WHERE source_id LIKE 'browser:%'")
        async def application(scope,receive,send):
            nonlocal mode
            path=scope.get('path','')
            if scope['type']=='http' and path.startswith('/__qa'):
                params=parse_qs(scope.get('query_string',b'').decode())
                if path=='/__qa/perf-probe.js':
                    return await Response((ROOT/'frontend/vanilla/tests/performance-phase2/cold-warm-probe.js').read_bytes(),media_type='application/javascript')(scope,receive,send)
                if path=='/__qa/metrics':
                    body=b''
                    while True:
                        m=await receive();body+=m.get('body',b'')
                        if len(body)>200000:return await Response(status_code=413)(scope,receive,send)
                        if not m.get('more_body'):break
                    data=json.loads(body)
                    with (out/'cold-warm-browser.ndjson').open('a') as f:f.write(json.dumps(data)+'\n')
                    return await JSONResponse({'saved':True})(scope,receive,send)
                if path=='/__qa/perf':
                    html='''<!doctype html><meta charset="utf-8"><title>Phase 2 paired browser measurements</title><style>body{margin:0;font:14px system-ui;background:#e2e8f0}header,pre{padding:10px}pre{max-height:180px;overflow:auto}iframe{height:900px;border:0;display:block;background:white}</style><header>Isolated paired dashboard cohorts · no stability run <button id="start">Run 40 measurements</button></header><pre id="progress">Ready</pre><iframe title="Measured application"></iframe>
<script>const f=document.querySelector('iframe'),p=document.querySelector('#progress'),rows=[];let receive;addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.phase2ColdWarm&&receive){const r=receive;receive=null;r(e.data.phase2ColdWarm)}});async function sample(stage,profile,token,cache,i,prime=false){f.style.width=(profile==='desktop'?1440:390)+'px';const row=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{receive=null;reject(Error('cohort timeout'))},25000);receive=x=>{clearTimeout(timeout);resolve(x)};f.src='/app/dashboard?__qa_stage='+stage+'&__qa_token='+token+'&__qa_profile='+profile;});Object.assign(row,{cache,sample:i,prime});await fetch('/__qa/metrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row)});if(!prime)rows.push(row);p.textContent=JSON.stringify({complete:rows.length,latest:row},null,2)}document.querySelector('#start').onclick=async()=>{document.querySelector('#start').disabled=true;try{const prefix=Date.now().toString(36);for(const profile of ['desktop','latency150'])for(const cache of ['cold','warm']){if(cache==='warm')for(const stage of ['before','after'])await sample(stage,profile,prefix+'-'+profile+'-warm-'+stage,cache,0,true);for(let i=0;i<5;i++)for(const stage of (i%2?['after','before']:['before','after']))await sample(stage,profile,prefix+'-'+profile+'-'+cache+'-'+stage+(cache==='cold'?'-'+i:''),cache,i)}p.textContent=JSON.stringify({status:'COMPLETE',count:rows.length,rows},null,2)}catch(e){p.textContent=JSON.stringify({status:'FAILED',complete:rows.length,error:e.message})}};</script>'''
                    return await Response(html,media_type='text/html',headers={'Cache-Control':'no-store'})(scope,receive,send)
                if path=='/__qa/control':
                    action=params.get('action',[''])[0]
                    if action in ('fail','hold'):mode=action;release.clear()
                    elif action=='release':release.set();mode='none'
                    elif action=='receipt':
                        async with (await pool()).acquire() as c:
                            rows=await c.fetch('''SELECT a.id::text,a.status::text,
                              coalesce(jsonb_object_agg(r.question_id::text,r.user_answer) FILTER(WHERE r.question_id IS NOT NULL),'{}'::jsonb) answers
                              FROM reading_attempts a LEFT JOIN reading_answers r ON r.attempt_id=a.id
                              WHERE a.user_id=$1 GROUP BY a.id ORDER BY a.started_at DESC''',UID)
                            data={'attempts':[dict(x) for x in rows],'events':events[-20:]}
                        (out/'browser-save-receipt.json').write_text(json.dumps(data,indent=2,default=str)+'\n')
                        return await JSONResponse(data)(scope,receive,send)
                    elif action in ('reading','listening'):
                        headers=dict(scope.get('headers',[]));cookie=headers.get(b'cookie',b'').decode()
                        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=asgi.application),base_url='http://localhost:'+str(args.port),headers={'cookie':cookie}) as client:
                            endpoint='/api/reading/academic' if action=='reading' else '/api/listening/attempts'
                            body={'setId':fid('reading-set')} if action=='reading' else {'testId':fid('listening-academic')}
                            r=await client.post(endpoint,json=body)
                        if r.status_code!=200:return await JSONResponse({'error':'fixture_start_failed','status':r.status_code,'detail':r.text},r.status_code)(scope,receive,send)
                        route='/app/reading/attempts/' if action=='reading' else '/app/listening/attempts/'
                        return await JSONResponse({'route':route+r.json()['id']})(scope,receive,send)
                    else:return await JSONResponse({'error':'unknown_fixture_action'},400)(scope,receive,send)
                    return await JSONResponse({'armed':mode})(scope,receive,send)
                if path=='/__qa':
                    html='''<!doctype html><meta charset="utf-8"><title>Learners Area isolated acceptance checks</title>
<style>body{margin:0;font:14px system-ui;background:#e2e8f0}header{padding:10px;display:flex;gap:8px;flex-wrap:wrap}button{padding:8px}pre{margin:0;padding:10px;max-height:180px;overflow:auto}iframe{width:100%;height:calc(100vh - 220px);border:0;background:white}</style>
<header><strong>Synthetic data · Real API · No stability run</strong><button data-action="reading">Open Reading</button><button data-action="listening">Open Listening</button><button data-action="fail">Fail next Reading save</button><button data-action="hold">Hold next Reading save</button><button data-action="release">Release held save</button><button data-action="receipt">Read database receipt</button><button id="snapshot">DOM snapshot</button></header><pre id="result">Ready</pre><iframe title="Learners Area test application" src="/app/dashboard"></iframe>
<script>const frame=document.querySelector('iframe'),result=document.querySelector('#result');document.querySelectorAll('[data-action]').forEach(b=>b.onclick=async()=>{const response=await fetch('/__qa/control?action='+b.dataset.action,{method:'POST'}),data=await response.json();result.textContent=JSON.stringify(data,null,2);if(data.route)frame.src=data.route;});document.querySelector('#snapshot').onclick=()=>{const d=frame.contentDocument,a=d.querySelector('audio'),timer=d.querySelector('[data-time-remaining]');result.textContent=JSON.stringify({route:frame.contentWindow.location.pathname,nodes:d.querySelectorAll('*').length,focus:d.activeElement?.id,save:d.querySelector('[data-save-state]')?.dataset.saveState,timer:timer?.dataset.timeRemaining,audio:a?{paused:a.paused,time:a.currentTime,error:a.error?.code}:null},null,2)};</script>'''
                    response=Response(html,media_type='text/html',headers={'Cache-Control':'no-store'})
                    if b'la_session=' not in dict(scope.get('headers',[])).get(b'cookie',b'') or params.get('fresh')==['1']:
                        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=asgi.application),base_url='http://localhost:'+str(args.port)) as client:
                            r=await client.post('/api/auth/login',json={'email':'phase2@example.test','password':PASSWORD})
                            assert r.status_code==200,r.text
                            for cookie in r.headers.get_list('set-cookie'):response.headers.append('set-cookie',cookie)
                    return await response(scope,receive,send)
                return await Response(status_code=404)(scope,receive,send)
            if scope['type']=='http' and scope.get('method')=='PATCH' and path.startswith('/api/reading/attempts/'):
                event={'path':path,'at':time.monotonic(),'mode':mode};events.append(event)
                if mode=='fail':
                    mode='none';event['status']=503
                    return await JSONResponse({'error':'isolated_fault'},503)(scope,receive,send)
                if mode=='hold':
                    mode='none';event['held']=True
                    try:await asyncio.wait_for(release.wait(),10)
                    except TimeoutError:pass
                async def record(message):
                    if message['type']=='http.response.start':event['status']=message['status']
                    await send(message)
                return await asgi.application(scope,receive,record)
            if scope['type']=='http':
                query=parse_qs(scope.get('query_string',b'').decode());stage=query.get('__qa_stage',[None])[0];token=query.get('__qa_token',[None])[0]
                profile=query.get('__qa_profile',['desktop'])[0]
                asset=re.match(r'^/assets/([^/]+)-qa-([^/]+)/(.*)$',path)
                if asset:
                    rev,token,tail=asset.groups();stage=next((s for s,v in variants.items() if v.manifest['revision']==rev),None)
                    profile='latency150' if 'latency150' in token else 'desktop'
                    scope={**scope,'path':'/assets/'+rev+'/'+tail,'raw_path':('/assets/'+rev+'/'+tail).encode()}
                if stage in variants and (token or asset):
                    if profile=='latency150':await asyncio.sleep(.15)
                    messages=[]
                    async def capture(message):messages.append(message)
                    await variants[stage](scope,receive,capture)
                    start=messages[0];headers=dict(start.get('headers',[]));body=b''.join(m.get('body',b'') for m in messages[1:]);encoded=headers.get(b'content-encoding')==b'gzip'
                    if encoded:body=gzip.decompress(body)
                    rev=variants[stage].manifest['revision'];body=body.replace(('/assets/'+rev+'/').encode(),('/assets/'+rev+'-qa-'+str(token)+'/').encode())
                    if b'text/html' in headers.get(b'content-type',b''):
                        nonce=re.search(rb"'nonce-([^']+)'",headers.get(b'content-security-policy',b''));nonce=nonce.group(1) if nonce else b''
                        body=body.replace(b'<head>',b'<head><script nonce="'+nonce+b'" src="/__qa/perf-probe.js"></script>',1)
                    if encoded:body=gzip.compress(body,compresslevel=9,mtime=0)
                    hs=[(k,v) for k,v in start['headers'] if k.lower() not in (b'content-length',b'etag')]
                    hs.append((b'content-length',str(len(body)).encode()))
                    await send({**start,'headers':hs});await send({'type':'http.response.body','body':body});return
            return await asgi.application(scope,receive,send)
        print('ISOLATED_ACCEPTANCE_READY; no stability run',flush=True)
        await uvicorn.Server(uvicorn.Config(application,host='0.0.0.0',port=args.port,access_log=False,log_level='warning')).serve()
    finally:
        try:
            from app.db import close_pool
            await close_pool()
        finally:db.close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=4173);p.add_argument('--host',default='0.0.0.0');p.add_argument('--strictPort',action='store_true');p.add_argument('--artifacts',required=True);p.add_argument('--baseline')
    asyncio.run(run(p.parse_args()))
