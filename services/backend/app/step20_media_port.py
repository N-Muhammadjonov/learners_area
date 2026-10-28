"""Private resource GET/HEAD and authenticated media-worker backchannel.

Stable media protocol copied from lib/media/protocol.ts. Every file requires
actual user/session authority and a resource-owner DB lookup.
"""
from __future__ import annotations
import base64,hashlib,hmac,json,os,re,time
from datetime import datetime,timezone
from urllib.parse import urlencode,quote,urlparse
from fastapi import APIRouter,Request
from fastapi.responses import Response,RedirectResponse
from . import main as core
from .step19_storage import valid_key,head_object,read_object
from .writing_source_materials import graph_bytes,GRAPHS

router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}
STAFF={'owner','admin','teacher'}
ORIGIN='https://learnersarea-media.owneruchunla.workers.dev'
TTL=120

def b64(b):return base64.urlsafe_b64encode(b).decode().rstrip('=')
def unb64(value):
    if not isinstance(value,str) or not re.fullmatch('[A-Za-z0-9_-]+',value) or len(value)%4==1:raise ValueError('invalid_encoding')
    result=base64.urlsafe_b64decode(value+'='*((-len(value))%4))
    if b64(result)!=value:raise ValueError('noncanonical_encoding')
    return result

def media_conf():
    address=os.getenv('MEDIA_WORKER_URL'); secret=os.getenv('MEDIA_SIGNING_SECRET')
    if not address and not secret:return None
    url=urlparse(address or '')
    if (not address or not secret or len(secret.encode())<32 or url.scheme!='https' or
        url.netloc!='learnersarea-media.owneruchunla.workers.dev' or url.path!='/' or url.params or url.query or url.fragment or url.username or url.password):
        raise ValueError('invalid_media_configuration')
    return secret

def safe_media_key(key):
    return isinstance(key,str) and 0<len(key)<=400 and bool(re.fullmatch('[A-Za-z0-9][A-Za-z0-9_./-]*',key)) and '..' not in key and all(s and s!='.' for s in key.split('/'))

def sign(secret,text):return b64(hmac.new(secret.encode(),text.encode(),hashlib.sha256).digest())

def token_payload(claim):
    return json.dumps([claim[k] for k in ('v','aud','uid','authVersion','sessionKey','sessionExpiresAt','key','exp')],separators=(',',':'),ensure_ascii=False)

def claim_valid(c,now):
    return (c.get('v')==1 and c.get('aud')=='learnersarea-media' and core.uuid_value(c.get('uid')) is not None
      and type(c.get('authVersion'))==int and c['authVersion']>=0 and isinstance(c.get('sessionKey'),str)
      and bool(re.fullmatch('[a-f0-9]{64}',c['sessionKey'])) and safe_media_key(c.get('key'))
      and type(c.get('exp'))==int and now<c['exp']<=now+TTL
      and type(c.get('sessionExpiresAt'))==int and c['sessionExpiresAt']>=c['exp'])

def create_capability(secret,user_id,auth_version,session_key,expires_at,key):
    now=int(time.time())
    claims={'v':1,'aud':'learnersarea-media','uid':str(user_id),'authVersion':int(auth_version),
            'sessionKey':session_key,'sessionExpiresAt':int(expires_at),'key':key,'exp':min(now+TTL,int(expires_at))}
    if not claim_valid(claims,now):raise ValueError('invalid_media_scope')
    raw=b64(token_payload(claims).encode())
    return raw+'.'+sign(secret,'la-media-read-v1\n'+raw),claims

def verify_capability(secret,token,key):
    try:
        if not isinstance(token,str) or len(token)>2400 or not safe_media_key(key):return None
        data=token.split('.')
        if len(data)!=2:return None
        raw,proof=data
        if not hmac.compare_digest(unb64(proof),unb64(sign(secret,'la-media-read-v1\n'+raw))):return None
        json_text=unb64(raw).decode('utf-8')
        arr=json.loads(json_text)
        if not isinstance(arr,list) or len(arr)!=8:return None
        c=dict(zip(('v','aud','uid','authVersion','sessionKey','sessionExpiresAt','key','exp'),arr))
        if c['key']!=key or not claim_valid(c,int(time.time())) or token_payload(c)!=json_text:return None
        return c
    except (ValueError,KeyError,TypeError):return None

def media_url(key,token):
    return ORIGIN+'/v1/media/'+b64(key.encode())+'?'+urlencode({'token':token})

def media_range(header,size):
    if type(size) is not int or size<=0 or size>=2**53:return None
    match=re.fullmatch(r'bytes=(\d*)-(\d*)',header.strip())
    if not match or not any(match.groups()):return None
    left,right=match.groups()
    if not left:
        n=int(right)
        return (max(0,size-n),size-1) if n>0 and n<2**53 else None
    start=int(left);end=int(right) if right else size-1
    return (start,min(size-1,end)) if start<size and end>=start and start<2**53 and end<2**53 else None

def published(row):
    if row.get('publication_state')=='published':return True
    return row.get('publication_state')=='scheduled' and row.get('publish_at') and row['publish_at']<=datetime.now(timezone.utc)

async def owner_access(con,user,typ,id):
    if typ not in ('lesson','reading','listening','writing','speaking','grammar','assignment','live_class'):return None
    table={'lesson':'lessons','reading':'reading_passages','listening':'listening_tests','writing':'writing_prompts',
           'speaking':'speaking_materials','grammar':'grammar_topics','assignment':'assignments','live_class':'live_classes'}[typ]
    row=await con.fetchrow(f'SELECT * FROM {table} WHERE id=$1',id)
    if not row:return None
    rd=dict(row)
    if typ in ('reading','listening','writing','speaking'):
        # This parameter is PostgreSQL text, while resource owner IDs are decoded UUIDs.
        deleted=await con.fetchval("SELECT EXISTS(SELECT 1 FROM activity_events WHERE id=md5('deleted-content:' || $1::text)::uuid AND type='CONTENT_DELETED')",str(id))
        if deleted:return None
    can= True if typ in ('lesson','grammar','assignment','live_class') else bool(published(rd))
    if typ=='speaking':can=can and bool(rd.get('is_active'))
    if user['role'] not in STAFF and not can:return 'forbidden'
    if typ=='listening' and user['role'] not in STAFF:
        from .step17_mcq_port import sequence
        if not await sequence(con,user,row):return 'forbidden'
    return 'allowed'

async def allow_resource(con,user,key):
    # No fallback from private ownership to a guessed filename.
    block=await con.fetchrow('SELECT material_id FROM material_blocks WHERE object_key=$1 LIMIT 1',key)
    primary=await con.fetchrow('SELECT id FROM speaking_materials WHERE primary_object_key=$1 LIMIT 1',key) if not block else None
    mid=block['material_id'] if block else primary['id'] if primary else None
    if mid:
        mat=await con.fetchrow('SELECT * FROM speaking_materials WHERE id=$1',mid)
        if not mat:return 'not_found'
        if not mat['is_active'] and not (user['role'] in ('owner','admin') or
              (user['role']=='teacher' and user['id']==mat['created_by_user_id'])):return 'forbidden'
        return 'allowed'
    try:
        pkg=await con.fetchrow('SELECT test_id FROM listening_packages WHERE audio_object_key=$1 OR image_object_key=$1 LIMIT 1',key)
    except Exception:pkg=None
    if pkg:return (await owner_access(con,user,'listening',pkg['test_id'])) or 'not_found'
    block=await con.fetchrow('SELECT owner_type,owner_id FROM resource_blocks WHERE object_key=$1 LIMIT 1',key)
    if block and block['owner_type'] in ('lesson','reading','listening','writing','speaking','grammar','assignment','live_class'):
        return (await owner_access(con,user,block['owner_type'],block['owner_id'])) or 'not_found'
    attempt=await con.fetchrow('SELECT user_id FROM speaking_attempts WHERE recording_object_key=$1 LIMIT 1',key)
    if not attempt:return 'not_found'
    if user['role']=='owner':return 'allowed'
    if user['role']=='student':return 'allowed' if attempt['user_id']==user['id'] else 'forbidden'
    if user['role']=='teacher':
        allowed=await con.fetchval('''SELECT EXISTS(SELECT 1 FROM teacher_student_links l JOIN users s
          ON s.id=l.student_user_id AND s.role='student' WHERE l.teacher_user_id=$1 AND l.student_user_id=$2)''',
          user['id'],attempt['user_id'])
        return 'allowed' if allowed else 'forbidden'
    return 'forbidden'

async def stored_mime(con,key):
    rows=(('material_blocks','mime_type','object_key'),('speaking_materials','primary_mime_type','primary_object_key'),
          ('upload_intents','mime_type','object_key'),('speaking_attempts','recording_mime_type','recording_object_key'))
    for table,col,k in rows:
        row=await con.fetchrow(f'SELECT {col} FROM {table} WHERE {k}=$1 LIMIT 1',key)
        if row and row[col]:return row[col]
    return None

async def deliver(req,key,head):
    try:
        authority=await core.current_authority(req)
        if not authority or authority['user']['account_status']!='active':return core.j({'error':'unauthenticated'},401,PRIVATE)
        if not safe_media_key(key):return core.j({'error':'invalid_key'},400,PRIVATE)
        db=await core.pool()
        async with db.acquire() as con:
            allowed=await allow_resource(con,authority['user'],key)
            if allowed!='allowed':return core.j({'error':allowed},403 if allowed=='forbidden' else 404,PRIVATE)
        graph=graph_bytes(key)
        if graph is not None:
            if req.query_params.get('capability')=='1':
                from urllib.parse import urlsplit,urlunsplit
                u=urlsplit(str(req.url))
                url=urlunsplit((u.scheme,u.netloc,u.path,'stream=1',''))
                return core.j({'url':url,'expiresAt':min(int(time.time()*1000)+120000,int(authority['expiresAt'])*1000),'key':key},headers=PRIVATE)
            size=len(graph);etag='"'+GRAPHS[key]['sha256']+'"'
            h={**PRIVATE,'Content-Type':'image/png','Accept-Ranges':'bytes','ETag':etag,'Content-Disposition':'inline; filename="'+GRAPHS[key]['originalName']+'"'}
            header=None if head else req.headers.get('range')
            if req.headers.get('if-range') not in (None,etag):header=None
            span=media_range(header,size) if header else None
            if header and span is None:
                return Response(status_code=416,headers={**h,'Content-Range':f'bytes */{size}'})
            h['Content-Length']=str(span[1]-span[0]+1 if span else size)
            if span:h['Content-Range']=f'bytes {span[0]}-{span[1]}/{size}'
            return Response(None if head else graph[span[0]:span[1]+1] if span else graph,status_code=206 if span else 200,headers=h)
        secret=media_conf()
        want_cap=req.query_params.get('capability')=='1'
        if secret:
            token,claims=create_capability(secret,authority['user']['id'],authority['authVersion'],authority['sessionKey'],authority['expiresAt'],key)
            url=media_url(key,token)
            if want_cap:return core.j({'url':url,'expiresAt':claims['exp']*1000,'key':key},headers=PRIVATE)
            if req.query_params.get('download')!='1':
                return RedirectResponse(url,status_code=302,headers=PRIVATE)
            import httpx
            forwarded={k:req.headers[k] for k in ('range','if-range') if k in req.headers}
            async with httpx.AsyncClient(timeout=20,follow_redirects=False) as client:
                reply=await client.request('HEAD' if head else 'GET',url,headers=forwarded)
            h=dict(PRIVATE)
            for name in ('Content-Type','Content-Length','Content-Range','Accept-Ranges','ETag','Last-Modified','Content-Disposition'):
                if name in reply.headers:h[name]=reply.headers[name]
            return Response(None if head else reply.content,status_code=reply.status_code,headers=h)
        if want_cap:
            from urllib.parse import urlsplit,urlunsplit
            u=urlsplit(str(req.url))
            url=urlunsplit((u.scheme,u.netloc,u.path,'stream=1',''))
            return core.j({'url':url,'expiresAt':min(int(time.time()*1000)+120000,int(authority['expiresAt'])*1000),'key':key},headers=PRIVATE)
        info=await head_object(key)
        if info is None:return core.j({'error':'not_found'},404,PRIVATE)
        mime=None
        if not info.get('contentType'):
            db=await core.pool()
            async with db.acquire() as con:
                mime=await stored_mime(con,key)
        size=info['size']
        local_types={'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.m4v':'video/x-m4v',
             '.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg',
             '.opus':'audio/opus','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg',
             '.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.doc':'application/msword',
             '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             '.ppt':'application/vnd.ms-powerpoint','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation',
             '.xls':'application/vnd.ms-excel','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             '.zip':'application/zip','.txt':'text/plain; charset=utf-8','.csv':'text/csv; charset=utf-8'}
        ext=os.path.splitext(key)[-1].lower()
        content_type=info.get('contentType') or mime or local_types.get(ext,'application/octet-stream')
        h=dict(PRIVATE);h['Content-Type']=content_type;h['Accept-Ranges']='bytes'
        range_header=None if head else req.headers.get('range')
        byte_range=media_range(range_header,size) if range_header else None
        if range_header and byte_range is None:
            h['Content-Range']=f'bytes */{size}'
            return Response(status_code=416,headers=h)
        h['Content-Length']=str(byte_range[1]-byte_range[0]+1 if byte_range else size)
        inline=content_type.startswith(('image/','audio/','video/','text/plain'))
        h['Content-Disposition']=('inline' if inline else 'attachment')+'; filename="'+key.split('/')[-1]+'"'
        if byte_range:h['Content-Range']=f'bytes {byte_range[0]}-{byte_range[1]}/{size}'
        if head:return Response(status_code=200,headers=h)
        data=await read_object(key,*(byte_range or (None,None)))
        return Response(data,status_code=206 if byte_range else 200,headers=h) if data is not None else core.j({'error':'not_found'},404,PRIVATE)
    except Exception:return core.j({'error':'temporarily_unavailable'},503,PRIVATE)

@router.get('/api/resources/{key:path}')
async def resource_get(req:Request,key:str):return await deliver(req,key,False)
@router.head('/api/resources/{key:path}')
async def resource_head(req:Request,key:str):return await deliver(req,key,True)

@router.post('/api/media/authorize')
async def authorize(req:Request):
    h={k:v for k,v in PRIVATE.items() if k!='Referrer-Policy'}
    try:
        secret=media_conf()
        if not secret or int(req.headers.get('content-length','0'))>5000:return core.j({'allowed':False},403,h)
        raw=await req.body()
        if not raw or len(raw)>5000:return core.j({'allowed':False},403,h)
        b=json.loads(raw)
        if not isinstance(b,dict) or b.get('method') not in ('GET','HEAD') or not isinstance(b.get('token'),str) or len(b['token'])>2400 or type(b.get('timestamp'))!=int or abs(int(time.time())-b['timestamp'])>30 or not isinstance(b.get('proof'),str):
            return core.j({'allowed':False},403,h)
        payload=json.dumps(['la-media-backchannel-v1',b['method'],b['token'],b['timestamp']],separators=(',',':'))
        expected=sign(secret,payload)
        if not hmac.compare_digest(b['proof'],expected):return core.j({'allowed':False},403,h)
        claims=verify_capability(secret,b['token'],b.get('key'))
        if not claims:return core.j({'allowed':False},403,h)
        db=await core.pool()
        async with db.acquire() as con:
            user=await con.fetchrow('''SELECT id,name,email,role,account_status,locale,onboarding_completed_at,status_reason
                FROM users WHERE id=$1 AND auth_version=$2
                AND NOT EXISTS(SELECT 1 FROM auth_session_revocations r WHERE r.token_hash=$3 AND r.user_id=$1 AND r.expires_at>NOW())''',
                core.uuid_value(claims['uid']),claims['authVersion'],claims['sessionKey'])
            if (not user or user['account_status']!='active' or claims['sessionExpiresAt']<=time.time() or
              await allow_resource(con,dict(user),claims['key'])!='allowed'):
                return core.j({'allowed':False},403,h)
        return core.j({'allowed':True},headers=h)
    except Exception:return core.j({'allowed':False},503,h)

def install():core.app.include_router(router)
