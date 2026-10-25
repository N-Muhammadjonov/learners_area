"""Private upload-intent and local/direct proxy transport.
Source: validation/uploads.ts, data/uploads.ts, uploads/{intent,route}.ts.
"""
from __future__ import annotations
import os,re,uuid,math,asyncio
from pathlib import Path
from fastapi import APIRouter,Request
from . import main as core
from .rate_limit import counter,client_key,RULES
RULES.setdefault('upload_intent',(120,900))
from .step19_storage import provider,_client,valid_key
from .step20_upload_finalize_port import problem
router=APIRouter()
MIB=1024*1024
DOC={'.pdf':'application/pdf','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.ppt':'application/vnd.ms-powerpoint','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.xls':'application/vnd.ms-excel','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.zip':'application/zip','.txt':'text/plain','.csv':'text/csv','.md':'text/markdown','.rtf':'application/rtf','.html':'text/plain','.htm':'text/plain','.xml':'text/plain','.json':'application/json'}
MEDIA={'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.m4v':'video/x-m4v','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.oga':'audio/ogg','.opus':'audio/ogg','.flac':'audio/flac','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}
RECORDING={'.webm':'audio/webm','.ogg':'audio/ogg','.mp4':'audio/mp4'}
CATEGORIES={'primary':(set(DOC)|set(MEDIA),'MAX_UPLOAD_MB',500),'image':({'.png','.jpg','.jpeg','.webp','.gif'},'MAX_IMAGE_UPLOAD_MB',10),'audio':({'.mp3','.wav','.m4a','.aac','.ogg','.oga','.opus','.webm','.flac','.mp4'},'MAX_AUDIO_UPLOAD_MB',60),'video':({'.mp4','.webm','.mov','.m4v'},'MAX_VIDEO_UPLOAD_MB',500),'file':(set(DOC),'MAX_FILE_UPLOAD_MB',60)}
DANGEROUS=re.compile(r'\.(?:exe|msi|dmg|pkg|app|apk|ipa|bat|cmd|com|scr|pif|ps1|psm1|vbs|vbe|jse?|wsf|wsh|hta|cpl|jar|sh|bash|zsh|csh|ksh|command|run|bin|elf|dll|so|dylib|lnk|reg|gadget|msc|php\d?|phtml|py|pl|rb|cgi|asp|aspx|jsp)$',re.I)
EXE={'exe','bat','cmd','ps1','sh','msi','scr','vbs','js','jar','apk','dmg'}

def extension(filename):
    p=filename.rfind('.');return filename[p:].lower() if 0<p<len(filename)-1 else ''

def dangerous(filename):
    s=filename.strip().lower();parts=s.split('.')[1:]
    return bool(DANGEROUS.search(s)) or any(p in EXE for p in parts[:-1])

def policy(filename,content_type,size,category):
    if not filename:return 'missing_file'
    if dangerous(filename):return 'dangerous_type'
    allowed,env,default=CATEGORIES[category]
    ext=extension(filename)
    mime=(content_type or '').split(';',1)[0].strip().lower()
    mime_ok= mime in (['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/zip','application/x-zip-compressed','text/plain','text/csv','text/markdown','text/x-markdown','application/rtf','text/rtf','text/html','application/xml','text/xml','application/json'] if category in ('primary','file') else []) or any(mime.startswith(prefix) for prefix in ({'primary':('video/','audio/','image/'),'image':('image/',),'audio':('audio/',),'video':('video/',),'file':()}[category]))
    if ext not in allowed:return 'unsupported_type'
    if type(size) not in (int,float) or not math.isfinite(size) or size<=0:return 'missing_file'
    try:limit=float(os.getenv(env,str(default)))
    except ValueError:limit=default
    if limit<=0:limit=default
    if size>round(limit*MIB):return 'file_too_large'
    return None

def category(purpose,kind):return 'audio' if purpose=='speaking_recording' else 'primary' if purpose=='material_primary' else kind or 'file'

def key_for(material,attempt,intent,kind,filename):
    ext=re.sub('[^a-z0-9.]','',extension(filename));ext=ext if len(ext)<=12 else ''
    kind={'primary':'primary','image':'images','audio':'audio','video':'video','file':'files'}[kind]
    scope=f'speaking/attempts/{attempt}' if attempt else f'resources/{material}' if material else f'pending/{intent}'
    return f'{scope}/{kind}/{uuid.uuid4()}{ext}'

def friendly_error(code,status):return problem(code,status)

@router.post('/api/uploads/intent')
async def upload_intent(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return friendly_error('unauthenticated',401)
    delay=counter('upload_intent',client_key(req),consume=True)
    if delay:return core.j({'error':'rate_limited'},429,{'Retry-After':str(delay)})
    b=await core.payload(req)
    if not isinstance(b,dict) or not all(isinstance(b.get(x),str) for x in ('purpose','filename','contentType')):return friendly_error('invalid_input',400)
    purpose=b['purpose'];kind=b.get('blockKind');size=b.get('size')
    if purpose not in ('material_primary','material_block','speaking_recording'):return friendly_error('invalid_purpose',400)
    if type(size) not in (int,float) or not math.isfinite(size) or size<=0:return friendly_error('invalid_size',400)
    if purpose=='material_block' and kind not in ('image','audio','video','file'):return friendly_error('invalid_block_kind',400)
    material=b.get('materialId') if isinstance(b.get('materialId'),str) else None
    attempt=b.get('speakingAttemptId') if isinstance(b.get('speakingAttemptId'),str) else None
    db=await core.pool()
    async with db.acquire() as con:
        if purpose=='speaking_recording':
            if not attempt:return friendly_error('missing_attempt_id',400)
            record=await con.fetchrow('SELECT user_id,status FROM speaking_attempts WHERE id=$1',core.uuid_value(attempt)) if core.uuid_value(attempt) else None
            if not record:return friendly_error('attempt_not_found',404)
            if record['user_id']!=u['id']:return friendly_error('forbidden',403)
            if record['status']!='recording':return friendly_error('attempt_already_submitted',409)
        elif u['role'] not in ('admin','owner','teacher'):return friendly_error('forbidden',403)
        if material:
            record=await con.fetchrow('SELECT created_by_user_id FROM speaking_materials WHERE id=$1',core.uuid_value(material)) if core.uuid_value(material) else None
            if not record:return friendly_error('material_not_found',404)
            if u['role']!='owner' and record['created_by_user_id']!=u['id']:return friendly_error('forbidden',403)
        cat=category(purpose,kind)
        error=policy(b['filename'],b['contentType'],size,cat)
        if error:return friendly_error(error,413 if error=='file_too_large' else 400)
        new_id=uuid.uuid4();obj_key=key_for(material,attempt,new_id,cat,b['filename'])
        direct=provider()!='local'
        if not direct and size>60*MIB:return friendly_error('file_too_large',413)
        canonical=RECORDING.get(extension(b['filename'])) if cat=='audio' else None
        canonical=canonical or DOC.get(extension(b['filename'])) or MEDIA.get(extension(b['filename'])) or 'application/octet-stream'
        url=None
        if direct:
            s3,bucket=_client()
            url=await asyncio.to_thread(s3.generate_presigned_url,'put_object',Params={'Bucket':bucket,'Key':obj_key,'ContentType':canonical},ExpiresIn=300)
        await con.execute('''INSERT INTO upload_intents(id,user_id,material_id,speaking_attempt_id,purpose,block_kind,object_key,original_name,mime_type,size,status,direct_to_storage,expires_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,NOW()+INTERVAL '15 minutes')''',new_id,u['id'],core.uuid_value(material),core.uuid_value(attempt),purpose,kind,obj_key,b['filename'][:255],canonical[:120],int(size),direct)
    return core.j({'ok':True,'uploadId':str(new_id),'objectKey':obj_key,'mode':'direct' if direct else 'proxy','uploadUrl':url,'contentType':canonical,'expiresInSeconds':300 if direct else 900})

@router.post('/api/uploads')
async def upload_bytes(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    try:form=await req.form()
    except Exception:return core.j({'error':'invalid_input'},400)
    upload=form.get('uploadId');file=form.get('file')
    if not isinstance(upload,str) or not hasattr(file,'read') or not hasattr(file,'size'):return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as con:
        intent=await con.fetchrow('SELECT * FROM upload_intents WHERE id=$1',core.uuid_value(upload)) if core.uuid_value(upload) else None
        if not intent or intent['user_id']!=u['id']:return core.j({'error':'upload_not_found'},404)
        if intent['status'] not in ('pending','finalized'):return core.j({'error':'upload_not_active'},409)
        if intent['direct_to_storage']:return core.j({'error':'use_direct_upload'},409)
        if isinstance(file.size,int) and file.size>60*MIB:return core.j({'error':'file_too_large'},413)
        category_=category(intent['purpose'],intent['block_kind'])
        if not valid_key(intent['object_key']) or provider()!='local':return core.j({'error':'storage_unavailable'},503)
        root=Path(os.getenv('STORAGE_LOCAL_DIR') or '.data/uploads').resolve()
        path=(root/intent['object_key']).resolve()
        if not path.is_relative_to(root):return core.j({'error':'storage_unavailable'},503)
        data=await file.read(60*MIB+1)
        if len(data)>60*MIB:return core.j({'error':'file_too_large'},413)
        error=policy(intent['original_name'],intent['mime_type'],len(data),category_)
        if error:return core.j({'error':error},413 if error=='file_too_large' else 400)
        def write():
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes(data)
        await asyncio.to_thread(write)
    return core.j({'ok':True,'uploadId':str(intent['id']),'objectKey':intent['object_key']})

def install():core.app.include_router(router)
