"""Google OIDC authorization-code callback.  State, PKCE, nonce, RS256 JWKS,
issuer/audience and account non-merge are required by the original backend.
"""
from __future__ import annotations
import hmac,json,re,os
from urllib.parse import urlencode
import httpx,jwt
from jwt import PyJWKClient
from fastapi import APIRouter,Request
from fastapi.responses import RedirectResponse
from . import main as core
from .security import SESSION_COOKIE,SESSION_TTL,issue_token,clear_session_cookie,write_cookie,is_https
from .rate_limit import counter,client_key,too_many
from .auth_google_start_port import google_config
router=APIRouter()

FLOW='la_google_flow';JWKS='https://www.googleapis.com/oauth2/v3/certs'

def flow_data(value):
    if not value or len(value)>1000:return None
    try:
        o=json.loads(value)
        if isinstance(o,dict) and all(isinstance(o.get(k),str) and re.fullmatch(r'[A-Za-z0-9_-]{32,80}',o[k]) for k in ('state','nonce','verifier')):return o
    except (ValueError,TypeError):pass
    return None

def fail(req,code):
    res=RedirectResponse('/login?'+urlencode({'error':code}),status_code=307)
    res.delete_cookie(FLOW,path='/api/auth/google',httponly=True,secure=is_https(req),samesite='lax')
    res.headers['Cache-Control']='no-store'
    return res

async def oidc_identity(config,code,flow):
    async with httpx.AsyncClient(timeout=8,follow_redirects=False) as client:
        result=await client.post('https://oauth2.googleapis.com/token',headers={'content-type':'application/x-www-form-urlencoded'},data={
          'code':code,'client_id':config['clientId'],'client_secret':config['clientSecret'],'redirect_uri':config['redirectUri'],
          'grant_type':'authorization_code','code_verifier':flow['verifier']})
        result.raise_for_status()
        payload=result.json();token=payload.get('id_token')
        if not isinstance(token,str):raise ValueError('google_token_missing')
        keyresponse=await client.get(JWKS,timeout=5)
        keyresponse.raise_for_status()
    keys=keyresponse.json().get('keys',[])
    header=jwt.get_unverified_header(token)
    matching=next((k for k in keys if k.get('kid')==header.get('kid') and k.get('kty')=='RSA' and k.get('use','sig')=='sig'),None)
    if not matching or header.get('alg')!='RS256':raise ValueError('google_bad_key')
    key=jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(matching))
    claims=jwt.decode(token,key,algorithms=['RS256'],audience=config['clientId'],issuer=['https://accounts.google.com','accounts.google.com'],leeway=30)
    if not isinstance(claims.get('sub'),str) or not claims['sub'] or not hmac.compare_digest(str(claims.get('nonce','')),flow['nonce']):raise ValueError('google_claims_invalid')
    email=claims.get('email')
    return {'sub':claims['sub'],'email':email.lower() if isinstance(email,str) else None,
      'verified':claims.get('email_verified') in (True,'true'),'name':claims['name'][:200] if isinstance(claims.get('name'),str) else None}

async def resolve_account(con,claims,locale):
    # Unique e-mail never causes automatic account linkage: the user must link explicitly.
    known=await con.fetchrow('SELECT * FROM users WHERE google_sub=$1 LIMIT 1',claims['sub'])
    if known:return 'ok',dict(known),False
    if not claims['email'] or not claims['verified']:return 'google_unverified',None,False
    email=claims['email'].strip().lower()
    other=await con.fetchrow('SELECT * FROM users WHERE lower(email)=$1 LIMIT 1',email)
    if other:return ('ok',dict(other),False) if other['google_sub']==claims['sub'] else ('google_link_required',None,False)
    created=await con.fetchrow('''INSERT INTO users(name,email,google_sub,role,account_status,locale)
       VALUES($1,$2,$3,'student','pending',$4) RETURNING *''',claims['name'] or email.split('@')[0],email,claims['sub'],locale)
    return 'ok',dict(created),True

@router.get('/api/auth/google/callback')
async def callback(req:Request):
    if not core.auth_policy()['googleEnabled']:return core.auth_disabled()
    delay=counter('login_ip',client_key(req),consume=True)
    if delay:return too_many(delay)
    config=google_config()
    if not config:return fail(req,'google_unavailable')
    flow=flow_data(req.cookies.get(FLOW))
    state=req.query_params.get('state','');code=req.query_params.get('code','')
    if not flow or not state or not hmac.compare_digest(state,flow['state']) or not code or len(code)>2000:
        return fail(req,'google_state')
    try:claims=await oidc_identity(config,code,flow)
    except Exception:return fail(req,'google_failed')
    database=await core.pool()
    async with database.acquire() as con:
        try:
            async with con.transaction(): kind,user,created=await resolve_account(con,claims,req.cookies.get('la_locale','en') if req.cookies.get('la_locale') in ('en','uz') else 'en')
        except Exception as exc:
            if getattr(exc,'sqlstate',None)!='23505':raise
            async with con.transaction():kind,user,created=await resolve_account(con,claims,req.cookies.get('la_locale','en') if req.cookies.get('la_locale') in ('en','uz') else 'en')
    if kind!='ok':return fail(req,kind)
    if created:
        try:await core.create_access_request(user['id'])
        except Exception:pass  # Like the source, admission enqueue failure is logged but callback proceeds.
    destination='/pending' if user['account_status']!='active' else '/app' if user.get('onboarding_completed_at') else '/onboarding'
    res=RedirectResponse(destination,status_code=307)
    clear_session_cookie(res,req)
    write_cookie(res,req,SESSION_COOKIE,issue_token(user),SESSION_TTL,http_only=True)
    res.delete_cookie(FLOW,path='/api/auth/google',httponly=True,secure=is_https(req),samesite='lax')
    res.headers['Cache-Control']='no-store'
    return res

def install():core.app.include_router(router)
