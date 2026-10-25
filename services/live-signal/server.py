"""Python WebRTC signalling relay. No audio, persistence or payload logging."""
from __future__ import annotations
import asyncio
import json
import math
import os
import re
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
import jwt

AUDIENCE='learners-area-live-signal'
ISSUER='learners-area'
MAX_MESSAGE=16*1024
RELAY_TYPES={'offer','answer','candidate','bye','restart'}


def verify_token(token,secret,now=None):
    if not isinstance(token,str) or len(token)>2048: raise ValueError('malformed')
    try:
        claims=jwt.decode(token,secret,algorithms=['HS256'],audience=AUDIENCE,issuer=ISSUER,
                          options={'verify_exp':False,'verify_iat':False,'verify_nbf':False})
    except jwt.InvalidTokenError as exc: raise ValueError('invalid') from exc
    expiry=claims.get('exp');current=time.time() if now is None else now
    if isinstance(expiry,bool) or not isinstance(expiry,(int,float)) or not math.isfinite(expiry) or expiry<=current: raise ValueError('expired')
    if any(not isinstance(claims.get(key),str) for key in ('sub','sid','peer')) or claims['sub']==claims['peer']: raise ValueError('claims')
    return {'userId':claims['sub'],'sessionId':claims['sid'],'peerId':claims['peer'],
            'role':'offerer' if claims.get('role')=='offerer' else 'answerer'}


def is_relay_candidate(candidate):
    if candidate is None: return True
    line=candidate.get('candidate') if isinstance(candidate,dict) else None
    return line=='' or isinstance(line,str) and len(line)<1024 and re.search(r' typ relay( |$)',line) is not None


def create_app(*,secret,allowed_origins,now=time.time):
    if not secret or len(secret)<32: raise ValueError('LIVE_PARTNER_SIGNAL_SECRET must be at least 32 characters')
    if not allowed_origins: raise ValueError('ALLOWED_ORIGINS must explicitly name the app origins')
    app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
    rooms={};app.state.rooms=rooms

    @app.get('/healthz')
    async def health():
        return JSONResponse({'ok':True,'service':'learners-area-live-signal','rooms':len(rooms)},headers={'Cache-Control':'no-store'})

    @app.websocket('/signal')
    async def signal(socket:WebSocket):
        if socket.headers.get('origin') not in allowed_origins:
            await socket.close(code=1008);return
        await socket.accept()
        identity=None;room=None
        async def reject(reason):
            await socket.send_json({'type':'error','reason':reason})
            await socket.close(code=4401,reason=reason)
        async def receive(timeout=None):
            text=await asyncio.wait_for(socket.receive_text(),timeout) if timeout else await socket.receive_text()
            if len(text.encode('utf-8'))>MAX_MESSAGE:
                await socket.close(code=1009,reason='too big');return None
            try: message=json.loads(text)
            except ValueError: await reject('bad_json');return None
            if not isinstance(message,dict): await reject('bad_message');return None
            return message
        try:
            try: message=await receive(5)
            except asyncio.TimeoutError: await reject('auth_timeout');return
            if message is None: return
            if message.get('type')!='auth': await reject('auth_required');return
            try: identity=verify_token(message.get('token'),secret,now())
            except ValueError as exc: await reject('token_'+str(exc));return
            room=rooms.get(identity['sessionId'])
            if room is None:
                room={'allowed':{identity['userId'],identity['peerId']},'members':{}}
                rooms[identity['sessionId']]=room
            if room['allowed']!={identity['userId'],identity['peerId']}:
                await reject('not_participant');return
            previous=room['members'].get(identity['userId'])
            room['members'][identity['userId']]=socket
            if previous and previous is not socket: await previous.close(code=4000,reason='replaced')
            await socket.send_json({'type':'ready','role':identity['role'],'peerPresent':len(room['members'])==2})
            for user,other in list(room['members'].items()):
                if user!=identity['userId']: await other.send_json({'type':'peer-joined'})
            tokens=60.;last=now()
            while True:
                message=await receive()
                if message is None:return
                current=now();tokens=min(60,tokens+max(0,current-last)*6);last=current
                if tokens<1: await reject('rate_limited');return
                tokens-=1
                if message.get('type')=='ping': await socket.send_json({'type':'pong'});continue
                kind=message.get('kind');data=message.get('data')
                if message.get('type')!='signal' or not isinstance(kind,str) or kind not in RELAY_TYPES: await reject('bad_message');return
                if kind=='candidate' and not is_relay_candidate(data):
                    await socket.send_json({'type':'error','reason':'non_relay_candidate_dropped'});continue
                if kind in ('offer','answer') and (not isinstance(data,dict) or not isinstance(data.get('sdp'),str) or len(data['sdp'])>12000):
                    await reject('bad_sdp');return
                for user,other in list(room['members'].items()):
                    if user!=identity['userId']: await other.send_json({'type':'signal','kind':kind,'data':data})
        except (WebSocketDisconnect,RuntimeError,KeyError):
            pass
        finally:
            if identity and room and room['members'].get(identity['userId']) is socket:
                del room['members'][identity['userId']]
                for other in list(room['members'].values()):
                    try: await other.send_json({'type':'peer-left'})
                    except (RuntimeError,WebSocketDisconnect): pass
                if not room['members']:rooms.pop(identity['sessionId'],None)
    return app


def environment_app():
    origins=[x.strip() for x in os.environ.get('ALLOWED_ORIGINS','').split(',') if x.strip()]
    return create_app(secret=os.environ.get('LIVE_PARTNER_SIGNAL_SECRET'),allowed_origins=origins)


if __name__=='__main__':
    import uvicorn
    uvicorn.run(environment_app(),host='0.0.0.0',port=int(os.getenv('PORT','8787')),
                ws='wsproto',access_log=False,proxy_headers=False,server_header=False)
