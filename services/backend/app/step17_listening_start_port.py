"""Listening attempt creation: account-serialized start, pinned published revision."""
from __future__ import annotations
import json
from fastapi import APIRouter,Request
from fastapi.responses import Response
from . import main as core
from .step17_mcq_port import sequence,live,staff
router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}
CSP="default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data: blob:; img-src data: blob:; media-src data: blob:; font-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'"
async def test_detail(con,user,id,requires_package=False):
    test=await con.fetchrow('SELECT * FROM listening_tests WHERE id=$1',core.uuid_value(id))
    if not test or (not staff(user) and not live(test)):return None
    if not await sequence(con,user,test):return 'sequence_locked'
    if requires_package:
        pkg=await con.fetchrow('SELECT * FROM listening_packages WHERE test_id=$1',core.uuid_value(id))
        if not pkg:return None
        return (test,pkg)
    return (test,None)
async def begin(con,user,testid):
    async with con.transaction():
        locked=await con.fetchrow('SELECT id FROM users WHERE id=$1 FOR UPDATE',user['id'])
        if not locked:return None
        existing=await con.fetchrow('''SELECT id FROM listening_attempts WHERE user_id=$1 AND test_id=$2 AND status='in_progress' LIMIT 1''',user['id'],core.uuid_value(testid))
        if existing:return str(existing['id'])
        # Publish-bound attempt retains its own revision if an editor updates the bank.
        version=await con.fetchrow("""SELECT id FROM content_versions WHERE target_type='listening_test' AND target_id=$1 AND status='published' ORDER BY version_no DESC LIMIT 1""",core.uuid_value(testid))
        if not version:
            row=await con.fetchrow('SELECT source_id FROM listening_packages WHERE test_id=$1',core.uuid_value(testid))
            if row:
                version=await con.fetchrow("""SELECT id FROM content_versions WHERE module='listening' AND content_type='full_test' AND source_ref=$1 AND status='published' ORDER BY version_no DESC LIMIT 1""",row['source_id'])
        created=await con.fetchrow('''INSERT INTO listening_attempts(user_id,test_id,content_version_id) VALUES($1,$2,$3) RETURNING id''',user['id'],core.uuid_value(testid),version['id'] if version else None)
        return str(created['id'])
@router.post('/api/listening/attempts')
async def start_attempt(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    data=await core.payload(req)
    if not isinstance(data,dict) or not core.uuid_value(data.get('testId')):return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as con:
        detail=await test_detail(con,user,data['testId'])
        if detail=='sequence_locked':return core.j({'error':'sequence_locked'},403)
        if not detail:return core.j({'error':'not_found'},404)
        question=await con.fetchrow('SELECT id FROM listening_questions WHERE test_id=$1 LIMIT 1',core.uuid_value(data['testId']))
        if not question:return core.j({'error':'not_found'},404)
        attempt=await begin(con,user,data['testId'])
    return core.j({'id':attempt}) if attempt else core.auth_error()
@router.post('/api/listening/full/{id}/start')
async def start_full(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if not core.uuid_value(id):return core.j({'error':'not_found'},404)
    db=await core.pool()
    async with db.acquire() as con:
        detail=await test_detail(con,user,id,requires_package=True)
        if detail=='sequence_locked':return core.j({'error':'sequence_locked'},403,PRIVATE)
        if not detail:return core.j({'error':'not_found'},404)
        pkg=detail[1]['payload'];pkg=json.loads(pkg) if isinstance(pkg,str) else pkg
        if not pkg.get('questions'):return core.j({'error':'authored_runtime_only'},409)
        attempt=await begin(con,user,id)
    return core.j({'id':attempt},headers=PRIVATE) if attempt else core.j({'error':'unauthenticated'},401)

@router.get('/api/listening/full/{id}/sandbox')
async def sandbox(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if id=='preview':
        if user['role'] not in ('admin','owner'):return core.auth_error()
    elif not core.uuid_value(id):return core.j({'error':'not_found'},404)
    if id!='preview':
        db=await core.pool()
        async with db.acquire() as con:
            detail=await test_detail(con,user,id,requires_package=True)
            if detail=='sequence_locked':return core.j({'error':'sequence_locked'},403,PRIVATE)
            if not detail:return core.j({'error':'not_found'},404)
            pkg=detail[1]
            payload=pkg['payload'];payload=json.loads(payload) if isinstance(payload,str) else payload
            from .step17_listening_course_port import runtime_source
            if not (payload.get('authoredRuntime') or runtime_source(id,pkg['source_id'])):return core.j({'error':'not_found'},404)
    host=req.headers.get('x-forwarded-host',req.headers.get('host',req.url.netloc)).split(',')[0].strip()
    protocol='https:' if req.headers.get('x-forwarded-proto')=='https' else req.url.scheme+':'
    expected=json.dumps(f'{protocol}//{host}',ensure_ascii=False).replace('<','\\u003c')
    html=("<!doctype html><script>addEventListener('message',function init(e){if(e.source!==parent||e.origin!=="+expected+"||e.data?.channel!=='learners-area-sandbox-init'||typeof e.data.html!=='string'||e.data.html.length>6*1024*1024)return;let html=e.data.html,total=0;const assets=Object.entries(e.data.assets||{});if(assets.length>200)return;for(const [key,blob]of assets){if(!key.startsWith('blob:')||!(blob instanceof Blob)||(total+=blob.size)>150*1024*1024)return;}for(const [key,blob]of assets)html=html.replaceAll(key,URL.createObjectURL(blob));removeEventListener('message',init);document.open();document.write(html);document.close();});</script>")
    return Response(content=html,media_type='text/html',headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Content-Security-Policy':CSP+'; sandbox allow-scripts','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'})
def install():core.app.include_router(router)
