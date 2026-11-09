"""Bounded GET-only release smoke. Never logs cookies, capabilities or response text.

Examples:
  python scripts/phase2_readonly_smoke.py --base https://learnersarea.uz --output smoke.json
  QA_READ_ONLY_COOKIE='<operator-owned session>' python ... --base <staging> ...
No authentication is created. Private feature checks require an existing session.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urlsplit,urljoin
import httpx

MAX_BODY=1024*1024

def classification(status,error=None):
    if error:return error
    return {200:'ok',206:'partial_content',304:'not_modified',401:'authentication_required',
        403:'forbidden',404:'not_found',409:'conflict',410:'expired',422:'invalid_input',
        429:'rate_limited',500:'server_error',503:'unavailable'}.get(status,'redirect' if 300<=status<400 else 'unexpected_status')

async def smoke(base,expected_commit=None):
    parsed=urlsplit(base)
    if parsed.scheme not in ('https','http') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/'):
        raise ValueError('Use one HTTP(S) origin without credentials, path or query')
    if parsed.scheme=='http' and parsed.hostname not in ('127.0.0.1','localhost','::1'):
        raise ValueError('Plain HTTP is permitted only for a loopback fixture')
    base=base.rstrip('/');rows=[];cookie=os.getenv('QA_READ_ONLY_COOKIE','').strip()
    async with httpx.AsyncClient(base_url=base,timeout=10,trust_env=False,follow_redirects=False,
             headers={'Accept-Encoding':'gzip, identity','User-Agent':'LearnersArea-ReadOnly-Smoke/2'}) as client:
        async def check(label,path,expected=(200,),headers=None,private=False):
            options=dict(headers or {})
            if private and cookie:options['Cookie']=cookie
            began=time.perf_counter();status=0;body=b'';safe={};error=None
            try:
                async with client.stream('GET',path,headers=options) as response:
                    status=response.status_code
                    for key in ('cache-control','content-type','content-length','content-encoding','etag','vary','accept-ranges','content-range','x-learners-asset-version','x-robots-tag','retry-after'):
                        if key in response.headers:safe[key]=response.headers[key]
                    safe['cspNoncePresent']=bool(re.search(r"'nonce-[^']+'",response.headers.get('content-security-policy','')))
                    async for chunk in response.aiter_bytes():
                        body+=chunk
                        if len(body)>MAX_BODY:error='response_limit';break
            except httpx.TimeoutException:error='timeout'
            except httpx.HTTPError as exc:error='transport_'+type(exc).__name__
            row={'check':label,'status':status,'classification':classification(status,error),
                 'latencyMs':round((time.perf_counter()-began)*1000,3),'decodedBytes':len(body),
                 'pass':not error and status in expected,'headers':safe}
            rows.append(row);return row,body
        await check('liveness','/healthz')
        await check('readiness','/readyz')
        version,raw=await check('backend-version','/api/version')
        if version['status']==200:
            try:
                value=json.loads(raw);version['version']={k:value.get(k) for k in ('commit','shortCommit','region','environment')}
                if expected_commit:version['expectedCommitMatches']=value.get('commit')==expected_commit;version['pass']&=version['expectedCommitMatches']
            except ValueError:version['pass']=False;version['classification']='invalid_version_json'
        await check('public-policy','/api/frontend/public')
        await check('anonymous-session-denied','/api/frontend/session',expected=(401,))
        if cookie:
            await check('existing-session','/api/frontend/session',private=True)
            await check('listening-catalogue','/api/frontend/view?route=/app/listening/academic',private=True)
            await check('reading-catalogue','/api/frontend/view?route=/app/reading/academic',private=True)
        html,raw=await check('document','/')
        text=raw.decode('utf-8',errors='replace')
        revision=re.search(r'<meta name="la-build" content="([a-f0-9]{20})"',text)
        assets=re.findall(r'(?:href|src)="(/assets/[a-f0-9]{20}/[^"?#]+\.(?:css|js))"',text)
        if revision:
            html['assetRevision']=revision[1]
            for suffix in ('.css','.js'):
                path=next((x for x in assets if x.endswith(suffix)),None)
                if not path:continue
                asset,_=await check('asset-'+suffix[1:],path)
                asset['pass']&='immutable' in asset['headers'].get('cache-control','')
                if etag:=asset['headers'].get('etag'):
                    await check('conditional-'+suffix[1:],path,expected=(304,),headers={'If-None-Match':etag})
                ranged,content=await check('range-'+suffix[1:],path,expected=(206,),headers={'Range':'bytes=0-9','Accept-Encoding':'identity'})
                ranged['pass']&=len(content)==10 and ranged['headers'].get('content-range','').startswith('bytes 0-9/')
            stale,_=await check('stale-revision','/assets/'+'0'*20+'/js/main.js',expected=(404,))
            stale['pass']&='no-store' in stale['headers'].get('cache-control','')
        else:html['assetRevision']='not_observed'
    return {'scope':'Bounded GET-only synthetic smoke; no writes, login, grants or load test',
            'origin':base,'existingSessionProvided':bool(cookie),'checks':rows,
            'passed':sum(r['pass'] for r in rows),'failed':sum(not r['pass'] for r in rows),
            'notVerified':['Private catalogue/media playback without operator session' if not cookie else 'Signed-media playback, grading and authenticated write actions'],
            'thresholds':{'timeoutSeconds':10,'responseLimitBytes':MAX_BODY,'suggestedAlarm':'2 consecutive 5xx/readiness failures; commit/revision mismatch; unexpected private public-cache headers'}}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--base',required=True)
    p.add_argument('--expected-commit');p.add_argument('--output',required=True);args=p.parse_args()
    result=asyncio.run(smoke(args.base,args.expected_commit));Path(args.output).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'passed':result['passed'],'failed':result['failed'],'output':args.output}))
    raise SystemExit(1 if result['failed'] else 0)
