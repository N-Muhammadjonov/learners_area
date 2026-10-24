"""Speaking material ordered block edits and signed upload-intent attachment ownership.
Source: src/app/api/speaking/materials/[id]/route.ts; claimAttachment.
"""
from __future__ import annotations
import json
from urllib.parse import urlsplit
from fastapi import APIRouter,Request
from . import main as core
from .step19_storage import delete_object
router=APIRouter()


def validate_ref(ref):
    return isinstance(ref,dict) and ((isinstance(ref.get('uploadId'),str) and core.uuid_value(ref['uploadId'])) or (isinstance(ref.get('objectKey'),str) and 1<=len(ref['objectKey'])<=400))

def valid_url(v):
    if not isinstance(v,str) or len(v)>2000:return False
    s=urlsplit(v);return s.scheme in ('https','http') and bool(s.netloc)

def valid_block(b):
    if not isinstance(b,dict):return False
    typ=b.get('type')
    if typ=='text':return isinstance(b.get('textContent'),str) and 1<=len(b['textContent'])<=4000
    if typ=='link':return valid_url(b.get('linkUrl'))
    return typ in ('image','audio','file') and validate_ref(b.get('ref'))

def valid_primary(p):
    if not isinstance(p,dict):return False
    if p.get('mode')=='link':return p.get('primaryType')=='link' and valid_url(p.get('primaryUrl'))
    if p.get('mode')=='upload':return p.get('primaryType') in ('video','audio','file') and validate_ref(p.get('ref'))
    return False

def valid_patch(b):
    return isinstance(b,dict) and (b.get('title') is None or isinstance(b['title'],str) and 3<=len(b['title'])<=200) and ('isActive' not in b or isinstance(b['isActive'],bool)) and ('primary' not in b or valid_primary(b['primary'])) and ('blocks' not in b or isinstance(b['blocks'],list) and len(b['blocks'])<=50 and all(valid_block(r) for r in b['blocks']))

async def resolve(con,ref,user_id,kind,material_id,retained):
    if ref.get('uploadId'):
        uid=core.uuid_value(ref['uploadId'])
        if not uid:return None,'invalid_upload_id',None
        r=await con.fetchrow('SELECT * FROM upload_intents WHERE id=$1',uid)
        if not r or r['user_id']!=user_id:return None,'upload_not_found',None
        if r['purpose']!=('material_primary' if kind=='primary' else 'material_block'):return None,'upload_purpose_mismatch',None
        if kind!='primary' and r['block_kind']!=kind:return None,'upload_kind_mismatch',None
        if r['material_id'] and str(r['material_id'])!=material_id:return None,'upload_material_mismatch',None
        if r['status']!='finalized' or r['used_at']:return None,'upload_not_finalized',None
        changed=await con.fetchval("UPDATE upload_intents SET status='attached',used_at=NOW() WHERE id=$1 AND status='finalized' RETURNING id",uid)
        if not changed:return None,'upload_not_finalized',None
        return {'objectKey':r['object_key'],'originalName':r['original_name'],'mimeType':r['mime_type'],'size':r['size']},None,uid
    key=ref.get('objectKey')
    for r in retained:
        if r['object_key']==key:
            return {'objectKey':key,'originalName':r['original_name'] or 'file','mimeType':r['mime_type'] or 'application/octet-stream','size':r['size'] or 0},None,None
    return None,'object_not_owned' if key else 'missing_attachment',None

async def release(con, ids):
    if not ids:return
    await con.execute("UPDATE upload_intents SET status='finalized',used_at=NULL WHERE id=ANY($1::uuid[]) AND status='attached'",ids)

@router.patch('/api/speaking/materials/{id}')
async def patch_material(req:Request,id:str):
    target=core.uuid_value(id)
    if not target:return core.j({'error':'not_found'},404)
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    db=await core.pool()
    async with db.acquire() as con:
        m=await con.fetchrow('SELECT * FROM speaking_materials WHERE id=$1',target)
        if not m:return core.j({'error':'not_found'},404)
        if u['role'] not in ('owner','teacher','admin') or u['role']!='owner' and m['created_by_user_id'] is not None and m['created_by_user_id']!=u['id']:return core.j({'error':'forbidden'},403)
        b=await core.payload(req)
        if not valid_patch(b):return core.j({'error':'invalid_input'},400)
        retained=await con.fetch('SELECT * FROM material_blocks WHERE material_id=$1',target)
        claimed=[]
        primary=None;blocks=None
        try:
            if 'primary' in b:
                p=b['primary']
                if p['mode']=='link':primary={'primary_type':'link','primary_url':p['primaryUrl'],'primary_object_key':None,'primary_original_name':None,'primary_mime_type':None,'primary_size':None}
                else:
                    value,error,upload=await resolve(con,p['ref'],u['id'],'primary',id,retained)
                    if error:return core.j({'error':error},400)
                    if upload:claimed.append(upload)
                    mime=value['mimeType'];typ='video' if mime.startswith('video/') else 'audio' if mime.startswith('audio/') else 'file'
                    primary={'primary_type':typ,'primary_url':'/api/resources/'+value['objectKey'],'primary_object_key':value['objectKey'],'primary_original_name':value['originalName'],'primary_mime_type':mime,'primary_size':value['size']}
            if 'blocks' in b:
                blocks=[]
                for pos,item in enumerate(b['blocks']):
                    typ=item['type']
                    if typ in ('text','link'):
                        blocks.append({'type':typ,'position':pos,'text_content':item.get('textContent') if typ=='text' else None,'link_url':item.get('linkUrl') if typ=='link' else None,'object_url':None,'object_key':None,'original_name':None,'mime_type':None,'size':None})
                    else:
                        value,error,upload=await resolve(con,item['ref'],u['id'],typ,id,retained)
                        if error:
                            await release(con,claimed)
                            return core.j({'error':error},400)
                        if upload:claimed.append(upload)
                        blocks.append({'type':typ,'position':pos,'text_content':None,'link_url':None,'object_url':'/api/resources/'+value['objectKey'],'object_key':value['objectKey'],'original_name':value['originalName'],'mime_type':value['mimeType'],'size':value['size']})
            existing_keys=[r['object_key'] for r in retained if r['object_key']]
            kept={r['object_key'] for r in blocks if r['object_key']} if blocks is not None else set(existing_keys)
            removed=[key for key in existing_keys if key not in kept] if blocks is not None else []
            old_key=m['primary_object_key']
            if primary and old_key and old_key!=primary['primary_object_key']:removed.append(old_key)
            try:
                async with con.transaction():
                    cols={}
                    if 'title' in b:cols['title']=b['title']
                    if 'isActive' in b:cols['is_active']=b['isActive']
                    cols.update(primary or {})
                    if cols:
                        sql=', '.join(f'{key}=${i+2}' for i,key in enumerate(cols))
                        await con.execute(f'UPDATE speaking_materials SET {sql},updated_at=NOW() WHERE id=$1',target,*cols.values())
                    if blocks is not None:
                        await con.execute('DELETE FROM material_blocks WHERE material_id=$1',target)
                        for block in blocks:
                            await con.execute('''INSERT INTO material_blocks(material_id,type,position,text_content,link_url,object_url,object_key,original_name,mime_type,size)
                            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)''',target,*block.values())
            except Exception:
                await release(con,claimed)
                return core.j({'error':'update_failed'},500)
            for key in removed:
                try:await delete_object(key)
                except Exception:pass
            return core.j({'ok':True})
        except Exception:
            await release(con,claimed)
            raise

def install():core.app.include_router(router)
