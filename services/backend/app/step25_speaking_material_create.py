"""Create a Speaking resource with owned finalized uploads, ordered blocks and a
private-key-free canonical content version. Reproduces speaking/materials POST.
"""
from __future__ import annotations
import json,uuid
from fastapi import APIRouter,Request
from . import main as core
from .step22_speaking_patch import valid_primary,valid_block,resolve,release
from .step25_content_version import pin
router=APIRouter()
CATEGORIES={'part1','part2','part3','general','top_structures'}

def valid(b):
    if not isinstance(b,dict):return False
    if b.get('category') not in CATEGORIES:return False
    if not isinstance(b.get('title'),str) or not 3<=len(b['title'])<=200:return False
    if not valid_primary(b.get('primary')):return False
    return ('blocks' not in b or isinstance(b['blocks'],list) and len(b['blocks'])<=50 and all(valid_block(x) for x in b['blocks']))

async def claimed(con,ref,user,kind):
    if not isinstance(ref,dict) or not ref.get('uploadId'):return None,'missing_attachment',None
    return await resolve(con,ref,user,kind,'',[])

@router.post('/api/speaking/materials')
async def create(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if user['role'] not in ('teacher','admin','owner'):return core.j({'error':'forbidden'},403)
    b=await core.payload(req)
    if not valid(b):return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as con:
        claimed_ids=[]
        try:
            async with con.transaction():
                primary=b['primary']
                if primary['mode']=='link':
                    meta={'primary_type':'link','primary_url':primary['primaryUrl'],'primary_object_key':None,'primary_original_name':None,'primary_mime_type':None,'primary_size':None}
                else:
                    obj,err,uid=await claimed(con,primary['ref'],user['id'],'primary')
                    if err:return core.j({'error':err},400)
                    if uid:claimed_ids.append(uid)
                    mime=obj['mimeType'];ptype='video' if mime.startswith('video/') else 'audio' if mime.startswith('audio/') else 'file'
                    meta={'primary_type':ptype,'primary_url':'/api/resources/'+obj['objectKey'],'primary_object_key':obj['objectKey'],
                          'primary_original_name':obj['originalName'],'primary_mime_type':mime,'primary_size':obj['size']}
                blocks=[]
                for idx,item in enumerate(b.get('blocks',[])):
                    kind=item['type'];obj=None
                    if kind in ('text','link'):
                        record={'type':kind,'position':idx,'text_content':item.get('textContent') if kind=='text' else None,
                                'link_url':item.get('linkUrl') if kind=='link' else None,'object_url':None,'object_key':None,
                                'original_name':None,'mime_type':None,'size':None}
                    else:
                        obj,err,uid=await claimed(con,item['ref'],user['id'],kind)
                        if err:
                            await release(con,claimed_ids)
                            return core.j({'error':err},400)
                        if uid:claimed_ids.append(uid)
                        record={'type':kind,'position':idx,'text_content':None,'link_url':None,'object_url':'/api/resources/'+obj['objectKey'],
                                'object_key':obj['objectKey'],'original_name':obj['originalName'],'mime_type':obj['mimeType'],'size':obj['size']}
                    blocks.append(record)
                row=await con.fetchrow('''INSERT INTO speaking_materials(created_by_user_id,category,title,primary_type,primary_url,
                     primary_object_key,primary_original_name,primary_mime_type,primary_size)
                     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,publication_state''',user['id'],b['category'],b['title'],*meta.values())
                mid=row['id']
                for r in blocks:
                    await con.execute('''INSERT INTO material_blocks(material_id,type,position,text_content,link_url,object_url,
                      object_key,original_name,mime_type,size) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)''',mid,*r.values())
                source=b.get('sourceRef') if isinstance(b.get('sourceRef'),str) and b['sourceRef'].strip() else str(uuid.uuid4())
                snapshot={'title':b['title'],'category':b['category'],'primaryType':meta['primary_type'],
                 'primaryUrl':meta['primary_url'] if meta['primary_type']=='link' else None,'hasPrimary':bool(meta['primary_url']),
                 'primaryOriginalName':meta['primary_original_name'],'primaryMimeType':meta['primary_mime_type'],
                 'primarySize':meta['primary_size'],'blocks':[{'type':x['type'],**({'text':x['text_content']} if x['text_content'] else {}),
                  **({'link':x['link_url']} if x['link_url'] else {})} for x in blocks]}
                await pin(con,'speaking','material',source,b['title'],snapshot,user['id'],pub=row['publication_state'],
                          target_type='speaking_material',target_id=mid,provenance={'via':'upload_route','store':'speaking_materials'})
        except Exception:
            return core.j({'error':'create_failed'},500)
        await con.execute('''INSERT INTO activity_events(user_id,type,payload) VALUES($1,'SPEAKING_MATERIAL_POSTED',$2::jsonb)''',user['id'],json.dumps({'materialId':str(mid)}))
    return core.j({'ok':True,'id':str(mid),'sourceRef':source,'contentType':'speaking:material'})

def install():core.app.include_router(router)
