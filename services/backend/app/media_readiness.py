"""Opt-in, read-only media deployment probe. Never exposes grants or object bytes.

Runs inside the existing service with its existing storage credentials. No test
account, login cookie, database write, exam start, or public endpoint is created.
"""
import asyncio
import hashlib
import json
import logging
import os
import time

import httpx

LOG=logging.getLogger('uvicorn.error')
KEY='listening/academic/test-01/full.mp3'

def error_code(exc):
    return str(getattr(exc,'response',{}).get('Error',{}).get('Code') or type(exc).__name__)

async def probe():
    from . import main as core,step19_storage as storage,step20_media_port as media
    result={'event':'listening_media_readiness'}
    try:
        info=await storage.head_object(KEY)
        data=await storage.read_object(KEY,0,15) if info else None
        result.update(directReady=bool(info and data and len(data)==16),directSize=info['size'] if info else 0,
                      directType=info.get('contentType') if info else None)
    except Exception as exc:result.update(directReady=False,directError=error_code(exc))
    try:
        secret=media.media_conf()
        if not secret:result['workerStatus']='unconfigured'
        else:
            db=await core.pool()
            async with db.acquire() as con:
                user=await con.fetchrow("SELECT id,role,account_status,auth_version FROM users WHERE role='owner' AND account_status='active' ORDER BY id LIMIT 1")
                if not user or await media.allow_resource(con,dict(user),KEY)!='allowed':
                    result['workerStatus']='probe_resource_not_authorized'
                    return result
            # A narrow server-side resource grant, never a user login/session.
            token,_=media.create_capability(secret,user['id'],user['auth_version'],hashlib.sha256(os.urandom(32)).hexdigest(),int(time.time())+120,KEY)
            async with httpx.AsyncClient(timeout=15,follow_redirects=False) as client:
                async with client.stream('GET',media.media_url(KEY,token),headers={'Range':'bytes=0-15'}) as reply:
                    result['workerStatus']=reply.status_code
                    result['workerType']=reply.headers.get('content-type','').split(';')[0]
                    result['workerRange']=reply.headers.get('content-range')
                    if reply.status_code==206:
                        sample=b''
                        async for chunk in reply.aiter_bytes(16):sample+=chunk;break
                        result['workerReady']=len(sample)==16
            if os.getenv('MEDIA_READINESS_FULL')=='1':
                started=time.perf_counter();size=0;digest=hashlib.md5(usedforsecurity=False)
                async with httpx.AsyncClient(timeout=httpx.Timeout(60,connect=5,read=20),follow_redirects=False) as client:
                    async with client.stream('GET',media.media_url(KEY,token),headers={'Origin':'https://learnersarea.uz'}) as reply:
                        result['fullStatus']=reply.status_code
                        result['corsReady']=reply.headers.get('access-control-allow-origin')=='https://learnersarea.uz'
                        if reply.status_code==200:
                            async for chunk in reply.aiter_bytes(65536):size+=len(chunk);digest.update(chunk)
                elapsed=time.perf_counter()-started
                result.update(fullBytes=size,fullSeconds=round(elapsed,3),fullMbps=round(size*8/elapsed/1e6,2),fullReady=bool(info and size==info['size']))
                if info and info.get('etag') and '-' not in info['etag']:
                    result['fullHashMatches']=digest.hexdigest()==info['etag'].strip('"')
    except Exception as exc:result['workerError']=error_code(exc)
    return result

async def log_probe():
    try:
        async with asyncio.timeout(90 if os.getenv('MEDIA_READINESS_FULL')=='1' else 40):result=await probe()
    except Exception as exc:result={'event':'listening_media_readiness','error':type(exc).__name__}
    LOG.info('%s',json.dumps(result,separators=(',',':')))
