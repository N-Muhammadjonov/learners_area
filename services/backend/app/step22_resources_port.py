"""Resource-block replacement with owner and upload-intent checks.

Source: src/app/api/materials/[type]/[id]/route.ts and src/lib/data/resources.ts.
"""
from __future__ import annotations
import json
from urllib.parse import urlsplit
from fastapi import APIRouter, Request
from . import main as core
from .step21_safe_reads_port import OWNER, get_owner
from .rate_limit import counter, RULES

router=APIRouter()
RULES.setdefault('upload_intent',(120,900))

async def claim(con, block, owner_id, user, retained):
    key=block.get('objectKey'); upload=block.get('uploadId')
    if upload:
        if not core.uuid_value(upload):return None,'invalid_upload_id'
        intent=await con.fetchrow('SELECT * FROM upload_intents WHERE id=$1',core.uuid_value(upload))
        if not intent or str(intent['user_id'])!=str(user['id']):return None,'upload_not_found'
        if intent['purpose']!='material_block':return None,'upload_purpose_mismatch'
        if intent['block_kind']!=block['type']:return None,'upload_kind_mismatch'
        if intent['material_id'] and str(intent['material_id'])!=owner_id:return None,'upload_material_mismatch'
        if intent['status']!='finalized' or intent['used_at']:return None,'upload_not_finalized'
        changed=await con.fetchval('''UPDATE upload_intents SET status='attached',used_at=NOW()
          WHERE id=$1 AND status='finalized' RETURNING id''',core.uuid_value(upload))
        if not changed:return None,'upload_not_finalized'
        return {'objectKey':intent['object_key'],'originalName':intent['original_name'],'mimeType':intent['mime_type'],'size':intent['size']},None
    if key:
        for row in retained:
            if row['object_key']==key:return {'objectKey':key,'originalName':row['original_name'] or 'file','mimeType':row['mime_type'] or 'application/octet-stream','size':row['size'] or 0},None
        return None,'object_not_owned'
    return None,'missing_attachment'

def validate(b):
    if not isinstance(b,dict) or set(b)!={'blocks'} or not isinstance(b['blocks'],list) or len(b['blocks'])>40:return False
    for row in b['blocks']:
        if not isinstance(row,dict) or set(row)-{'type','textContent','linkUrl','uploadId','objectKey'}:return False
        if row.get('type') not in ('text','link','file','image','audio'):return False
        for name,n in [('textContent',4000),('linkUrl',2048),('objectKey',512)]:
            if name in row and row[name] is not None and (not isinstance(row[name],str) or len(row[name])>n):return False
        if 'uploadId' in row and row['uploadId'] is not None and not core.uuid_value(row['uploadId']):return False
    return True

@router.put('/api/materials/{type}/{id}')
async def put_materials(req:Request,type:str,id:str):
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    if type not in OWNER or not core.uuid_value(id):return core.j({'error':'not_found'},404)
    if u['role'] not in ('teacher','admin','owner'):return core.j({'error':'forbidden'},403)
    db=await core.pool()
    async with db.acquire() as con:
        owner=await get_owner(con,type,id)
        if not owner:return core.j({'error':'not_found'},404)
        if owner['creatorId'] and u['role']=='teacher' and str(owner['creatorId'])!=str(u['id']):return core.j({'error':'forbidden'},403)
        limited=counter('upload_intent',f'resources:{u["id"]}',consume=True)
        if limited:return core.j({'error':'rate_limited'},429,{'Retry-After':str(limited)})
        b=await core.payload(req)
        if not validate(b):return core.j({'error':'invalid_input'},400)
        # Resolve every upload from its stored finalized intent. Never trust client metadata.
        existing=await con.fetch('SELECT * FROM resource_blocks WHERE owner_type=$1 AND owner_id=$2 ORDER BY position',type,core.uuid_value(id))
        rows=[]
        claimed=[]
        for n,block in enumerate(b['blocks']):
            typ=block['type']; row={'type':typ,'position':n,'text':None,'link':None,'objectKey':None,'originalName':None,'mimeType':None,'size':None}
            if typ=='text':
                v=(block.get('textContent') or '').strip()
                if not v:return core.j({'error':'empty_text_block'},400)
                row['text']=v[:4000]
            elif typ=='link':
                link=(block.get('linkUrl') or '').strip()
                parsed=urlsplit(link)
                if parsed.scheme not in ('http','https') or not parsed.netloc:return core.j({'error':'invalid_link'},400)
                row['link']=link[:2048]
            else:
                value,err=await claim(con,block,id,u,existing)
                if err:return core.j({'error':err},400)
                row.update(value)
                if block.get('uploadId'):claimed.append(block['uploadId'])
            rows.append(row)
        try:
            async with con.transaction():
                await con.execute('DELETE FROM resource_blocks WHERE owner_type=$1 AND owner_id=$2',type,core.uuid_value(id))
                for row in rows:
                    await con.execute('''INSERT INTO resource_blocks(owner_type,owner_id,position,type,text_content,link_url,
                     object_key,original_name,mime_type,size,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)''',
                     type,core.uuid_value(id),row['position'],row['type'],row['text'],row['link'],row['objectKey'],row['originalName'],row['mimeType'],row['size'],u['id'])
        except Exception:
            if claimed:await con.execute("UPDATE upload_intents SET status='finalized',used_at=NULL WHERE id=ANY($1::uuid[])",[core.uuid_value(x) for x in claimed])
            return core.j({'error':'write_failed'},500)
        saved=await con.fetch('''SELECT id,type,position,text_content AS "textContent",link_url AS "linkUrl",
        object_key AS "objectKey",original_name AS "originalName",mime_type AS "mimeType",size
        FROM resource_blocks WHERE owner_type=$1 AND owner_id=$2 ORDER BY position''',type,core.uuid_value(id))
    from .db import row_to_dict
    return core.j({'ok':True,'blocks':[row_to_dict(x) for x in saved]})

def install():core.app.include_router(router)
