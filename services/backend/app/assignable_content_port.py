"""Only published, known, canonical-live content can be assigned."""
from fastapi import APIRouter,Request
from . import main as core
from .content_capabilities_port import TAXONOMY,is_staff
router=APIRouter()
KNOWN={(module,k) for module,_,_,types in TAXONOMY for k in types}
TARGETS={'listening_test':'listening_tests','reading_passage':'reading_passages',
 'general_reading_set':'general_reading_sets','writing_prompt':'writing_prompts',
 'speaking_prompt':'speaking_prompts','grammar_topic':'grammar_topics',
 'lesson':'lessons','vocabulary_topic_pack':'vocabulary_topic_packs','video_lesson':'video_lessons'}

@router.get('/api/assignments/assignable')
async def assignable(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    if not is_staff(u['role']):return core.j({'error':'forbidden'},403)
    db=await core.pool()
    async with db.acquire() as conn:
        rows=await conn.fetch('''SELECT module,content_type AS "contentType",source_ref AS "sourceRef",
          title,track,id AS "versionId",version_no AS "versionNo",publication_state AS "publicationState",
          target_type AS "targetType",target_id AS "targetId"
          FROM content_versions WHERE status='published' AND publication_state='published' ORDER BY version_no DESC''')
        known=[r for r in rows if (r['module'],r['contentType']) in KNOWN]
        targets={}
        for r in known:
            if r['targetType'] and r['targetId']:
                targets.setdefault(r['targetType'],set()).add(str(r['targetId']))
        live=set()
        for target_type,ids in targets.items():
            table=TARGETS.get(target_type)
            if not table:continue
            where="publication_state='published'" if target_type=='grammar_topic' else (
                 "(publication_state='published' OR (publication_state='scheduled' AND publish_at<=NOW()))")
            found=await conn.fetch(f'SELECT id FROM {table} WHERE id=ANY($1::uuid[]) AND {where}',list(ids))
            live.update((target_type,str(x['id'])) for x in found)
    bykey={}
    for r in known:
        if r['targetType'] and r['targetId'] and (r['targetType'],str(r['targetId'])) not in live:continue
        key=f"{r['module']}:{r['contentType']}|{r['sourceRef']}"
        if key in bykey:continue
        bykey[key]={'module':r['module'],'contentType':r['contentType'],'sourceRef':r['sourceRef'],
          'title':r['title'],'track':r['track'],'versionId':str(r['versionId']),
          'versionNo':r['versionNo'],'publicationState':r['publicationState']}
    result=sorted(bykey.values(),key=lambda x:f"{x['module']}:{x['contentType']}:{x['title']}")
    return core.j({'ok':True,'items':result},headers={'Cache-Control':'private, no-store'})
def install():core.app.include_router(router)
