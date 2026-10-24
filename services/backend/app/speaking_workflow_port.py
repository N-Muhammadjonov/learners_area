"""Speaking read/start and AI script from speaking-practice.ts + attempt routes.

Storage-backed deletion/attachment are not included here: no local-only fake
object removal. Only methods with fully represented persistence are registered.
"""
from __future__ import annotations
from datetime import datetime,timezone
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict

router=APIRouter()
PARTS={'part1','part2','part3','general'}
STAFF={'teacher','admin','owner'}
PROMPT_COLUMNS='''id,part,category,prompt_text AS "promptText",cue_card AS "cueCard",
prep_seconds AS "prepSeconds",answer_seconds AS "answerSeconds",
follow_ups AS "followUps",study_support AS "studySupport",external_id AS "externalId",
topic,source_class AS "sourceClass",available_in AS "availableIn",is_active AS "isActive",
publication_state AS "publicationState",publish_at AS "publishAt",created_at AS "createdAt"'''
ATTEMPT_COLUMNS='''id,user_id AS "userId",prompt_id AS "promptId",
content_version_id AS "contentVersionId",part,status,recording_object_key AS "recordingObjectKey",
recording_original_name AS "recordingOriginalName",recording_mime_type AS "recordingMimeType",
recording_size AS "recordingSize",recording_duration_ms AS "recordingDurationMs",
transcript,transcript_provider AS "transcriptProvider",transcript_origin AS "transcriptOrigin",
started_at AS "startedAt",submitted_at AS "submittedAt",created_at AS "createdAt"'''
LIVE='''(publication_state='published' OR (publication_state='scheduled' AND publish_at <= NOW()))'''
TOPIC="CASE WHEN topic IS NULL OR btrim(topic)='' THEN '__untitled__' ELSE lower(btrim(topic)) END"

async def actor(req):
    return await core.current_user(req,active=True)

@router.get('/api/speaking/ai/script')
async def examiner_script(req:Request):
    u=await actor(req)
    if not u:return core.auth_error()
    mode=req.query_params.get('mode','full')
    if mode not in ('full','part1','part2','part3'):return core.j({'error':'invalid_mode'},400)
    db=await core.pool()
    script=[];cue_topic=None
    query=f'''SELECT id,part,topic,prompt_text AS "promptText",cue_card AS "cueCard",
       prep_seconds AS "prepSeconds",answer_seconds AS "answerSeconds" FROM speaking_prompts
       WHERE {LIVE} AND (available_in @> '["ai"]'::jsonb OR available_in @> '["practice_alone"]'::jsonb)
       AND NOT EXISTS (SELECT 1 FROM activity_events e WHERE e.id=md5('deleted-content:' || speaking_prompts.id::text)::uuid AND e.type='CONTENT_DELETED')
       AND part=$1::speaking_part AND ({TOPIC})=$2'''
    async with db.acquire() as con:
        for part,limit in [('part1',4),('part2',1),('part3',4)]:
            if mode not in ('full',part):continue
            topic=cue_topic if part=='part3' else None
            if topic is not None:
                same=await con.fetchval(f'''SELECT EXISTS(SELECT 1 FROM speaking_prompts WHERE {LIVE}
                AND (available_in @> '["ai"]'::jsonb OR available_in @> '["practice_alone"]'::jsonb)
                AND NOT EXISTS (SELECT 1 FROM activity_events e WHERE e.id=md5('deleted-content:' || speaking_prompts.id::text)::uuid AND e.type='CONTENT_DELETED')
       AND NOT EXISTS (SELECT 1 FROM activity_events e WHERE e.id=md5('deleted-content:' || speaking_prompts.id::text)::uuid AND e.type='CONTENT_DELETED')
                AND part=$1::speaking_part AND ({TOPIC})=$2)''',part,topic)
                if not same:topic=None
            if topic is None:
                topic=await con.fetchval(f'''SELECT {TOPIC} AS key FROM speaking_prompts
                WHERE {LIVE} AND (available_in @> '["ai"]'::jsonb OR available_in @> '["practice_alone"]'::jsonb)
                AND NOT EXISTS (SELECT 1 FROM activity_events e WHERE e.id=md5('deleted-content:' || speaking_prompts.id::text)::uuid AND e.type='CONTENT_DELETED')
                AND part=$1::speaking_part GROUP BY {TOPIC} ORDER BY random() LIMIT 1''',part)
            if topic is None:continue
            rows=await con.fetch(query+(' ORDER BY random() LIMIT 1' if part=='part2' else ' ORDER BY created_at ASC,id ASC LIMIT '+str(limit)),part,topic)
            script.extend(map(row_to_dict,rows))
            if part=='part2' and rows:
                raw=rows[0]['topic']
                cue_topic=raw.strip().lower() if raw and raw.strip() else '__untitled__'
    return core.j({'mode':mode,'script':script},headers={'cache-control':'no-store'})

@router.get('/api/speaking/attempts')
async def attempts(req:Request):
    u=await actor(req)
    if not u:return core.auth_error()
    db=await core.pool()
    async with db.acquire() as con:
        if u['role'] in STAFF:
            rows=await con.fetch(f'SELECT {ATTEMPT_COLUMNS} FROM speaking_attempts ORDER BY started_at DESC LIMIT 100')
        else:
            rows=await con.fetch(f'SELECT {ATTEMPT_COLUMNS} FROM speaking_attempts WHERE user_id=$1 ORDER BY started_at DESC LIMIT 100',u['id'])
        ids=[r['promptId'] for r in rows if r['promptId']]
        prompts={}
        if ids:
            pp=await con.fetch(f'SELECT {PROMPT_COLUMNS} FROM speaking_prompts WHERE id=ANY($1::uuid[])',ids)
            prompts={str(r['id']):row_to_dict(r) for r in pp}
    result=[]
    for r in rows:
        x=row_to_dict(r);x['prompt']=prompts.get(str(r['promptId'])) if r['promptId'] else None
        result.append(x)
    return core.j({'ok':True,'attempts':result,'limit':100,'returned':len(result)})

@router.get('/api/speaking/attempts/{id}')
async def attempt_detail(req:Request,id:str):
    if not core.uuid_value(id):return core.j({'error':'not_found'},404)
    u=await actor(req)
    if not u:return core.auth_error()
    db=await core.pool()
    async with db.acquire() as con:
        r=await con.fetchrow(f'SELECT {ATTEMPT_COLUMNS} FROM speaking_attempts WHERE id=$1',id)
    if not r:return core.j({'error':'not_found'},404)
    if u['role'] not in STAFF and str(r['userId'])!=str(u['id']):return core.j({'error':'forbidden'},403)
    return core.j({'ok':True,'attempt':row_to_dict(r)})

@router.post('/api/speaking/attempts')
async def start_attempt(req:Request):
    u=await actor(req)
    if not u:return core.auth_error()
    b=await core.payload(req)
    if not isinstance(b,dict) or set(b)-{'part','promptId'} or b.get('part') not in PARTS or ('promptId' in b and b['promptId'] is not None and not core.uuid_value(b['promptId'])):
        return core.j({'error':'invalid_input'},400)
    prompt_id=b.get('promptId');part=b['part']
    db=await core.pool()
    async with db.acquire() as con:
        version=None;binding='free_practice'
        if prompt_id:
            p=await con.fetchrow('''SELECT id,part,external_id,is_active,publication_state,publish_at
              FROM speaking_prompts WHERE id=$1''',prompt_id)
            if not p or not p['is_active']:return core.j({'error':'prompt_not_found'},404)
            if p['part']!=part:return core.j({'error':'part_mismatch'},422)
            published=(p['publication_state']=='published' or (p['publication_state']=='scheduled' and p['publish_at'] is not None and p['publish_at']<=datetime.now(timezone.utc)))
            if not published:return core.j({'error':'prompt_not_live'},422)
            content_type={'part1':'part1_question','part2':'cue_card','part3':'part3_question'}.get(p['part'])
            if content_type and p['external_id']:
                version=await con.fetchval('''SELECT id FROM content_versions WHERE module='speaking' AND content_type=$1
                  AND source_ref=$2 AND status='published' ORDER BY version_no DESC LIMIT 1''',content_type,p['external_id'])
            binding='pinned' if version else 'no_canonical_revision'
        r=await con.fetchrow(f'''INSERT INTO speaking_attempts(user_id,prompt_id,part,status,content_version_id)
           VALUES($1,$2,$3::speaking_part,'recording',$4) RETURNING {ATTEMPT_COLUMNS}''',u['id'],prompt_id,part,version)
    return core.j({'ok':True,'attempt':row_to_dict(r),'binding':binding,'contentVersionId':str(version) if version else None})

def install():core.app.include_router(router)
