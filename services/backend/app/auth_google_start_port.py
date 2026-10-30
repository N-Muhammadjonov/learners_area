"""Google OIDC authorization start, PKCE S256 + httpOnly 10-min flow cookie."""
from __future__ import annotations
import os,hashlib,secrets,json,base64
from urllib.parse import urlencode,urlparse
from fastapi import APIRouter,Request
from fastapi.responses import RedirectResponse
from . import main as core
from .rate_limit import async_counter as counter,client_key,too_many
router=APIRouter()

def b64url(b):return base64.urlsafe_b64encode(b).decode().rstrip('=')
def google_config():
    cid=os.getenv('GOOGLE_CLIENT_ID','').strip(); secret=os.getenv('GOOGLE_CLIENT_SECRET','').strip()
    origin=os.getenv('PUBLIC_BASE_URL','').strip().rstrip('/')
    redir=os.getenv('GOOGLE_REDIRECT_URI','').strip() or (origin+'/api/auth/google/callback' if origin else '')
    parsed=urlparse(redir)
    if (not cid.endswith('.apps.googleusercontent.com') or len(secret)<10 or
       not ((parsed.scheme=='https') or (parsed.scheme=='http' and parsed.hostname in ('localhost','127.0.0.1')))
       or parsed.path!='/api/auth/google/callback' or parsed.query or parsed.fragment):return None
    return {'clientId':cid,'clientSecret':secret,'redirectUri':redir}

@router.get('/api/auth/google/start')
async def google_start(req:Request):
    if not core.auth_policy()['googleEnabled']:
        return core.auth_disabled()
    delay=await counter('login_ip',client_key(req),consume=True)
    if delay:return too_many(delay)
    config=google_config()
    if not config:
        return RedirectResponse(str(req.url_for('google_start')).split('/api/auth/google/start')[0]+'/login?error=google_unavailable',status_code=307)
    state=b64url(secrets.token_bytes(32)); nonce=b64url(secrets.token_bytes(32)); verifier=b64url(secrets.token_bytes(48))
    challenge=b64url(hashlib.sha256(verifier.encode()).digest())
    qs=urlencode({'client_id':config['clientId'],'redirect_uri':config['redirectUri'],
                  'response_type':'code','scope':'openid email profile','state':state,
                  'nonce':nonce,'code_challenge':challenge,'code_challenge_method':'S256','prompt':'select_account'})
    resp=RedirectResponse('https://accounts.google.com/o/oauth2/v2/auth?'+qs,status_code=307)
    resp.set_cookie('la_google_flow',json.dumps({'state':state,'nonce':nonce,'verifier':verifier},separators=(',',':')),
                    max_age=600,httponly=True,secure=(req.url.scheme=='https'),samesite='lax',path='/api/auth/google')
    resp.headers['Cache-Control']='no-store'
    return resp

def install():core.app.include_router(router)
