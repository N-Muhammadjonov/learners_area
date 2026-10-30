"""Private Writing notes, three-colour highlights and learner-created chunks."""
import json
from uuid import UUID,uuid5,NAMESPACE_URL
from fastapi import APIRouter,Request
from . import main as core
from .writing_study_data import STUDY,PERSONAL,decoded,study_id,source_hash,session_source,personal_patterns,usage_uz
from .rate_limit import async_counter as counter,RULES
router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}
RULES.setdefault('writing_study',(180,60))

def fail(code,status=400):return core.j({'error':code},status,PRIVATE)

def validate_study(body,text):
    if not isinstance(body,dict) or set(body)!={'notes','highlights','sourceHash','revision'}:return False
    if not isinstance(body['notes'],str) or len(body['notes'])>20000 or type(body['revision']) is not int or body['revision']<0:return False
    if body['sourceHash']!=source_hash(text) or not isinstance(body['highlights'],list) or len(body['highlights'])>500:return False
    if any(not isinstance(h,dict) or type(h.get('start')) is not int for h in body['highlights']):return False
    length=len(text.encode('utf-16-le'))//2;previous=0;ids=set()
    for h in sorted(body['highlights'],key=lambda h:h.get('start',-1) if isinstance(h,dict) else -1):
        if not isinstance(h,dict) or set(h)!={'id','start','end','color'}:return False
        if not isinstance(h['id'],str) or not core.uuid_value(h['id']) or h['id'] in ids:return False
        if type(h['start']) is not int or type(h['end']) is not int or not 0<=h['start']<h['end']<=length or h['start']<previous:return False
        if h['color'] not in ('yellow','blue','orange'):return False
        previous=h['end'];ids.add(h['id'])
    return True

async def authority(req,id):
    user=await core.current_user(req,active=True)
    if not user:return None,fail('unauthenticated',401)
    if not core.uuid_value(id):return None,fail('not_found',404)
    return user,None

@router.get('/api/writing/stealing/sessions/{id}/study')
async def study_get(req:Request,id:str):
    user,error=await authority(req,id)
    if error is not None:return error
    db=await core.pool()
    async with db.acquire() as con:
        source=await session_source(con,user['id'],id)
        if not source:return fail('not_found',404)
        row=await con.fetchrow('SELECT payload FROM activity_events WHERE id=$1 AND user_id=$2 AND type=$3',study_id(user['id'],source['model_text_id']),user['id'],STUDY)
        data=decoded(row['payload']) if row else {}
    digest=source_hash(source['body'])
    return core.j({'notes':data.get('notes',''),'highlights':data.get('highlights',[]) if data.get('sourceHash')==digest else [],'sourceHash':digest,'revision':data.get('revision',0)},headers=PRIVATE)

@router.put('/api/writing/stealing/sessions/{id}/study')
async def study_put(req:Request,id:str):
    user,error=await authority(req,id)
    if error is not None:return error
    delay=await counter('writing_study',str(user['id']),consume=True)
    if delay:
        response=fail('rate_limited',429);response.headers['Retry-After']=str(delay);return response
    body=await core.payload(req);db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            source=await session_source(con,user['id'],id)
            if not source:return fail('not_found',404)
            if not validate_study(body,source['body']):return fail('invalid_input')
            await con.fetchrow('SELECT id FROM users WHERE id=$1 FOR UPDATE',user['id'])
            key=study_id(user['id'],source['model_text_id'])
            row=await con.fetchrow('SELECT payload FROM activity_events WHERE id=$1 AND user_id=$2 AND type=$3',key,user['id'],STUDY)
            old=decoded(row['payload']) if row else {}
            if old.get('revision',0)!=body['revision']:return fail('study_conflict',409)
            saved={**body,'revision':body['revision']+1,'modelId':str(source['model_text_id'])}
            await con.execute('''INSERT INTO activity_events(id,user_id,type,payload) VALUES($1,$2,$3,$4::jsonb)
              ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE activity_events.user_id=excluded.user_id AND activity_events.type=excluded.type''',key,user['id'],STUDY,json.dumps(saved,ensure_ascii=False))
    return core.j({'ok':True,'revision':saved['revision']},headers=PRIVATE)

@router.post('/api/writing/stealing/sessions/{id}/patterns')
async def personal_create(req:Request,id:str):
    user,error=await authority(req,id)
    if error is not None:return error
    b=await core.payload(req)
    if not isinstance(b,dict) or set(b)!={'pattern','example','usageNote'} or any(not isinstance(b[k],str) or len(b[k])>n for k,n in [('pattern',200),('example',800),('usageNote',2000)]) or len(b['pattern'].strip())<2:return fail('invalid_input')
    delay=await counter('writing_study',str(user['id']),consume=True)
    if delay:
        response=fail('rate_limited',429);response.headers['Retry-After']=str(delay);return response
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            source=await session_source(con,user['id'],id)
            if not source:return fail('not_found',404)
            await con.fetchrow('SELECT id FROM users WHERE id=$1 FOR UPDATE',user['id'])
            model_id=source['model_text_id'];key=uuid5(NAMESPACE_URL,f"learners-area:personal-pattern:{user['id']}:{model_id}:{b['pattern'].strip().casefold()}")
            existing=await con.fetchval('SELECT id FROM activity_events WHERE id=$1 AND user_id=$2 AND type=$3',key,user['id'],PERSONAL)
            count=await con.fetchval("""SELECT (SELECT count(*) FROM writing_language_patterns WHERE source_ref=$1 AND (publication_state='published' OR (publication_state='scheduled' AND publish_at<=NOW())))+
              (SELECT count(*) FROM activity_events WHERE user_id=$2 AND type=$3 AND payload->>'modelId'=$1)""",str(model_id),user['id'],PERSONAL)
            if not existing and count>=70:return fail('pattern_limit',409)
            payload={k:v.strip() for k,v in b.items()};payload['modelId']=str(model_id)
            await con.execute('INSERT INTO activity_events(id,user_id,type,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING',key,user['id'],PERSONAL,json.dumps(payload,ensure_ascii=False))
            rows=await personal_patterns(con,user['id'],model_id)
    return core.j({'ok':True,'pattern':next(p for p in rows if p['id']==str(key))},headers=PRIVATE)

@router.post('/api/writing/stealing/patterns/{id}/vocabulary')
async def pattern_vocabulary(req:Request,id:str):
    user,error=await authority(req,id)
    if error is not None:return error
    b=await core.payload(req)
    if not isinstance(b,dict) or set(b)!={'folderId'} or b['folderId'] is not None and not core.uuid_value(b['folderId']):return fail('invalid_input')
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            p=await con.fetchrow("""SELECT p.pattern,p.example,p.usage_note,m.id model_id,m.title source_title
              FROM writing_language_patterns p JOIN writing_model_texts m ON m.id::text=p.source_ref
              WHERE p.id=$1 AND (p.publication_state='published' OR (p.publication_state='scheduled' AND p.publish_at<=NOW()))
              AND (m.publication_state='published' OR (m.publication_state='scheduled' AND m.publish_at<=NOW()))
              AND NOT EXISTS(SELECT 1 FROM activity_events d WHERE d.id IN (md5('deleted-content:'||p.id::text)::uuid,md5('deleted-content:'||m.id::text)::uuid) AND d.type='CONTENT_DELETED')""",UUID(id))
            if p:p=dict(p)
            else:
                personal=next((x for x in await personal_patterns(con,user['id']) if x['id']==id),None)
                if not personal:return fail('not_found',404)
                p={'pattern':personal['pattern'],'example':personal['example'],'usage_note':personal['usageNote'],'model_id':UUID(personal['sourceId']),'source_title':personal['sourceTitle']}
            await con.fetchrow('SELECT id FROM users WHERE id=$1 FOR UPDATE',user['id'])
            folder=UUID(b['folderId']) if b['folderId'] else None
            if folder and not await con.fetchval('SELECT id FROM vocab_folders WHERE id=$1 AND user_id=$2',folder,user['id']):return fail('folder_not_found',404)
            if not folder:
                name=('Writing : '+p['source_title'])[:200]
                folder=await con.fetchval('SELECT id FROM vocab_folders WHERE user_id=$1 AND lower(name)=lower($2) LIMIT 1',user['id'],name)
                if not folder:folder=await con.fetchval('INSERT INTO vocab_folders(user_id,name) VALUES($1,$2) RETURNING id',user['id'],name)
            from .step21_vocab_batch import add_batch
            note=p['usage_note'] or 'A reusable expression from the linked writing text.'
            result=await add_batch(con,user['id'],[{'term':p['pattern'],'definitionEn':note,'translationUz':usage_uz(note),'exampleSentence':p['example'] or None,'partOfSpeech':None,'sourceSnapshot':{'patternId':id,'modelTextId':str(p['model_id']),'sourceTitle':p['source_title'],'surfaceForm':p['pattern'],'sentenceText':p['example'] or ''}}],source_type='writing_language_pattern',source_id=p['model_id'],folder_id=folder)
    return core.j(result,headers=PRIVATE)

def install():core.app.include_router(router)
