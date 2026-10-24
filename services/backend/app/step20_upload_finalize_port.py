"""Upload finalization: storage HEAD, byte signature, atomic pending->finalized.
Never trust a client's assertion that the upload succeeded.
"""
from __future__ import annotations
import os,uuid
from fastapi import APIRouter,Request
from . import main as core
from .step19_storage import head_object,read_object,delete_object
router=APIRouter()

RETRYABLE={'storage_unavailable','database_unavailable','server_error','network_error',
    'upload_timeout','storage_rejected','intent_expired','size_mismatch','unknown','rate_limited'}
NORMALIZED={'invalid_upload_id':'not_found','upload_not_found':'not_found','upload_expired':'intent_expired',
    'upload_not_active':'intent_expired','upload_not_found_in_storage':'size_mismatch',
    'upload_type_mismatch':'type_mismatch','upload_size_mismatch':'size_mismatch'}

def problem(code,status):
    normalized=NORMALIZED.get(code,code)
    return core.j({'error':code,'code':normalized,'message':normalized,'retryable':normalized in RETRYABLE},status)

def audio_magic(b):
    if b[:3]==b'ID3' or (len(b)>1 and b[0]==0xff and b[1]&0xe0==0xe0):return True
    return (b[:4]==b'RIFF' and b[8:12]==b'WAVE') or b[:4] in (b'fLaC',b'OggS',b'\x1a\x45\xdf\xa3') or b[4:8]==b'ftyp'

def signature(filename,b):
    if not b:return 'mismatch'
    if b[:2]==b'MZ' or b[:4] in (b'\x7fELF',b'\xcf\xfa\xed\xfe',b'\xfe\xed\xfa\xcf') or b[:2]==b'#!':return 'executable'
    ext=os.path.splitext(filename)[1].lower()
    magic={'.pdf':b.startswith(b'%PDF'),'.docx':b[:2]==b'PK' and len(b)>2 and b[2] in (3,5,7),
        '.pptx':b[:2]==b'PK' and len(b)>2 and b[2] in (3,5,7),
        '.xlsx':b[:2]==b'PK' and len(b)>2 and b[2] in (3,5,7),
        '.zip':b[:2]==b'PK' and len(b)>2 and b[2] in (3,5,7),
        '.doc':b.startswith(bytes.fromhex('d0cf11e0a1b11ae1')),
        '.ppt':b.startswith(bytes.fromhex('d0cf11e0a1b11ae1')),
        '.xls':b.startswith(bytes.fromhex('d0cf11e0a1b11ae1')),
        '.rtf':b.startswith(b'{\\rtf'),'.png':b.startswith(b'\x89PNG'),
        '.jpg':b.startswith(b'\xff\xd8'),'.jpeg':b.startswith(b'\xff\xd8'),
        '.gif':b.startswith(b'GIF8'),'.webp':b.startswith(b'RIFF') and b[8:12]==b'WEBP',
        '.mp4':b[4:8] in (b'ftyp',b'moov',b'mdat',b'wide',b'free'),
        '.mov':b[4:8] in (b'ftyp',b'moov',b'mdat',b'wide',b'free'),
        '.m4v':b[4:8] in (b'ftyp',b'moov',b'mdat',b'wide',b'free'),
        '.webm':b.startswith(b'\x1a\x45\xdf\xa3'),
        '.mp3':audio_magic(b),'.wav':audio_magic(b),'.m4a':audio_magic(b),
        '.aac':audio_magic(b),'.ogg':audio_magic(b),'.oga':audio_magic(b),
        '.opus':audio_magic(b),'.flac':audio_magic(b)}
    if ext in ('.txt','.csv','.md','.html','.htm','.xml','.json'):return 'mismatch' if b'\x00' in b[:4096] else None
    return None if magic.get(ext,False) else 'mismatch'

def mime_match(actual,declared):
    a=actual.split(';')[0].strip().lower();b=declared.split(';')[0].strip().lower()
    return a==b or a=='application/octet-stream' or b=='application/octet-stream'

@router.post('/api/uploads/finalize')
async def finalize(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return problem('unauthenticated',401)
    data=await core.payload(req)
    upload_id=data.get('uploadId') if isinstance(data,dict) else None
    if not isinstance(upload_id,str) or not core.uuid_value(upload_id):return problem('invalid_upload_id',400)
    db=await core.pool()
    async with db.acquire() as con:
        intent=await con.fetchrow('SELECT * FROM upload_intents WHERE id=$1',core.uuid_value(upload_id))
        if not intent or intent['user_id']!=user['id']:return problem('upload_not_found',404)
        response={'ok':True,'uploadId':str(intent['id']),'objectKey':intent['object_key'],
                  'originalName':intent['original_name'],'mimeType':intent['mime_type'],'size':intent['size']}
        if intent['status'] in ('finalized','attached'):return core.j(response)
        if intent['status']!='pending':return problem('upload_not_active',409)
        from datetime import datetime,timezone
        if intent['expires_at']<datetime.now(timezone.utc):return problem('upload_expired',410)
        meta=await head_object(intent['object_key'])
        if not meta:return problem('upload_not_found_in_storage',409)
        if meta.get('contentType') and not mime_match(meta['contentType'],intent['mime_type']):return problem('upload_type_mismatch',409)
        if isinstance(meta.get('size'),int) and meta['size']>0 and meta['size']!=intent['size']:return problem('upload_size_mismatch',409)
        prefix=await read_object(intent['object_key'],0,min(4096,meta['size'])-1) if meta['size'] else None
        reason=signature(intent['original_name'],prefix or b'')
        if reason:
            await con.execute("UPDATE upload_intents SET status='aborted',error=$2 WHERE id=$1 AND status='pending'",intent['id'],'signature_'+reason)
            try:await delete_object(intent['object_key'])
            except Exception:pass
            return problem('dangerous_type' if reason=='executable' else 'upload_type_mismatch',422)
        changed=await con.fetchrow('''UPDATE upload_intents SET status='finalized',finalized_at=NOW(),error=NULL
            WHERE id=$1 AND status='pending' AND expires_at>NOW() RETURNING id''',intent['id'])
        if not changed:return problem('upload_not_active',409)
        return core.j(response)

def install():core.app.include_router(router)
