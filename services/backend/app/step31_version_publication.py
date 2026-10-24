"""CMS revision publication service.

Source: admin/content/versions/[id]/publication/route.ts, content/authoring.ts,
content/authors.ts, listening/question-set.ts, content/lessons.ts.
Every state change uses one PostgreSQL transaction. No surrogate success paths.
"""
from __future__ import annotations
import json,re
from datetime import datetime,timezone
from fastapi import APIRouter,Request
from . import main as core
from .step29_lesson_revision_blocks import reconcile_blocks

router=APIRouter()
STATES=('draft','scheduled','published','archived')
TRANSITIONS={'draft':('scheduled','published','archived'),'scheduled':('draft','published','archived'),
 'published':('draft','scheduled','archived'),'archived':('draft','published')}
AUTHORS={('listening','full_test'):'listening_tests',('listening','section'):'listening_tests',
 ('writing','task1'):'writing_prompts',('writing','task2'):'writing_prompts',
 ('writing','lesson'):'writing_lessons',('writing','model_text'):'writing_model_texts',
 ('writing','pattern'):'writing_language_patterns',('writing','translation_set'):'writing_translation_sets',
 ('speaking','part1_question'):'speaking_prompts',('speaking','cue_card'):'speaking_prompts',
 ('speaking','part3_question'):'speaking_prompts',('speaking','material'):'speaking_materials',
 ('grammar','topic'):'grammar_topics',('lesson','lesson'):'lessons',
 ('vocabulary','topic_pack'):'vocabulary_topic_packs'}
READING={('reading','passage'),('reading','general_set')}

class PublicationRefusal(Exception):
    def __init__(self,code,message,field=None):
        self.issue={'code':code,'message':message}
        if field is not None:self.issue['field']=field

def bad(code,message,field=None):raise PublicationRefusal(code,message,field)

def parse_body(body):
    if not isinstance(body,dict):return None,'Required'
    state=body.get('to')
    if state not in STATES:return None,"Invalid enum value. Expected 'draft' | 'scheduled' | 'published' | 'archived'"
    raw=body.get('publishAt')
    if raw is None: return (state,None),None
    if not isinstance(raw,str):return None,'Expected string, received number'
    # z.string().datetime() requires RFC3339 with an explicit timezone.
    if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)',raw):
        return None,'Invalid datetime'
    try:date=datetime.fromisoformat(raw.replace('Z','+00:00'))
    except ValueError:return None,'Invalid datetime'
    return (state,date),None

def snapshot_of(row):
    val=row.get('content_snapshot')
    if isinstance(val,str):return json.loads(val)
    return val

def full_test_issue(data):
    if not isinstance(data,dict) or not isinstance(data.get('questions'),list):return None
    count=len(data['questions'])
    if count!=40:return f'A formal Listening full test has 40 questions; this revision has {count}. Publish it as a Listening section instead, or complete it before publishing.'
    sections=data.get('sections')
    if isinstance(sections,list) and len(sections)!=4:return f'A formal Listening full test has 4 parts; this revision has {len(sections)}.'
    return None

async def update_state(con,table,key,value,state,date):
    """Tables are from a fixed source-derived registry, never user supplied."""
    if table=='grammar_topics':
        if state=='scheduled':bad('scheduling_unsupported','This content type cannot hold a publish moment.','publishAt')
        await con.execute('UPDATE grammar_topics SET publication_state=$2 WHERE id=$1',value,state)
    else:
        await con.execute(f'UPDATE {table} SET publication_state=$2,publish_at=$3 WHERE {key}=$1',value,state,date)

async def listening_materialize(con,row):
    tid=row['target_id'];vid=row['id'];data=snapshot_of(row)
    counts=await con.fetchrow('''SELECT count(*)::int AS total,count(*) FILTER(WHERE content_version_id IS NULL)::int AS legacy
       FROM listening_questions WHERE test_id=$1''',tid)
    if counts and counts['legacy']>0:return
    questions=data.get('questions',[]) if isinstance(data,dict) else []
    await con.execute('DELETE FROM listening_questions WHERE test_id=$1 AND content_version_id=$2',tid,vid)
    for ix,q in enumerate(questions):
        if not isinstance(q,dict):continue
        qtype=q.get('type');storage=q.get('storageType')
        if not storage:
            storage='multiple_choice' if qtype in ('mcq_single','mcq_multi','mcq','multiple_choice') else 'short_answer'
        para=q.get('paraphrase');para=[para] if isinstance(para,dict) else None
        await con.execute('''INSERT INTO listening_questions(test_id,content_version_id,"order",type,type_code,question_text,
            options,correct_answer,explanation,keywords,paraphrases)
            VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb)''',tid,vid,q.get('order',ix+1),storage,qtype,q.get('questionText'),
            json.dumps(q.get('options')) if q.get('options') is not None else None,q.get('correctAnswer'),q.get('explanation') or '',q.get('keywords'),
            json.dumps(para) if para is not None else None)
    content=data if isinstance(data,dict) else {}
    await con.execute('''UPDATE listening_tests SET title=COALESCE($2,title),audio_type=COALESCE($3,audio_type),audio_url=$4,
             transcript=$5,difficulty_level=COALESCE($6,difficulty_level) WHERE id=$1''',tid,row['title'],content.get('audioType'),content.get('audioUrl'),content.get('transcript'),content.get('difficultyLevel'))

async def reading_update(con,row,state,date):
    ref=row['source_ref'];data=snapshot_of(row);target=row.get('target_id')
    await con.execute("SELECT pg_advisory_xact_lock(hashtext($1))",'reading-version:'+ref)
    ids=data.get('canonicalPassageIds') if isinstance(data,dict) else None
    sid=data.get('canonicalSetId') if isinstance(data,dict) else None
    valid=isinstance(ids,list) and bool(ids) and all(core.uuid_value(p) is not None for p in ids) and ('canonicalSetId' in data) and (sid is None or core.uuid_value(sid) is not None)
    if not valid:
        if not target:bad('no_target','The revision is not attached to any content row.')
        await con.execute('''UPDATE reading_passages SET publication_state=$2,publish_at=$3 WHERE source_ref=$1
          AND NOT EXISTS (SELECT 1 FROM content_versions v WHERE v.module='reading'
          AND v.content_snapshot->'canonicalPassageIds' @> jsonb_build_array(reading_passages.id::text))''',ref,state,date)
        return
    rows=await con.fetch('SELECT id FROM reading_passages WHERE id=ANY($1::uuid[])',[core.uuid_value(x) for x in ids])
    if len(rows)!=len(ids):bad('no_target','The revision is not attached to any content row.')
    if state=='published':
        old=await con.fetch("SELECT * FROM content_versions WHERE module='reading' AND source_ref=$1 AND status='published' AND id<>$2",ref,row['id'])
        for earlier in old:
            other=snapshot_of(dict(earlier));oldids=other.get('canonicalPassageIds') if isinstance(other,dict) else None
            oldsid=other.get('canonicalSetId') if isinstance(other,dict) else None
            if isinstance(oldids,list) and len(oldids)>0 and all(core.uuid_value(x) for x in oldids):
                await con.execute("UPDATE reading_passages SET publication_state='archived',publish_at=NULL WHERE id=ANY($1::uuid[])",[core.uuid_value(x) for x in oldids])
                if oldsid:await con.execute("UPDATE general_reading_sets SET publication_state='archived',publish_at=NULL WHERE id=$1",core.uuid_value(oldsid))
            else:
                await con.execute('''UPDATE reading_passages SET publication_state='archived',publish_at=NULL WHERE source_ref=$1
                  AND NOT EXISTS (SELECT 1 FROM content_versions v WHERE v.module='reading'
                  AND v.content_snapshot->'canonicalPassageIds' @> jsonb_build_array(reading_passages.id::text))''',ref)
                await con.execute("UPDATE general_reading_sets SET publication_state='archived',publish_at=NULL WHERE source_ref=$1",ref)
    await con.execute('UPDATE reading_passages SET publication_state=$2,publish_at=$3 WHERE id=ANY($1::uuid[])',[core.uuid_value(x) for x in ids],state,date)
    if sid:await con.execute('UPDATE general_reading_sets SET publication_state=$2,publish_at=$3 WHERE id=$1',core.uuid_value(sid),state,date)

async def materialize_lesson(con,row):
    target=row['target_id'];raw=snapshot_of(row)
    if not isinstance(raw,dict):return
    existing=await con.fetchrow('SELECT id FROM lessons WHERE id=$1',target)
    if not existing:return
    params=[];keys=[]
    for source,col in [('unitId','unit_id'),('slug','slug'),('order','"order"'),('learningArea','learning_area')]:
        val=raw.get(source)
        if isinstance(val,str) and val and source!='order' or source=='order' and type(val) in (int,float) or source=='learningArea' and isinstance(val,str) and val:
            params.append(core.uuid_value(val) if source=='unitId' else val);keys.append(f'{col}=${len(params)+1}')
    for source,col in [('summary','summary'),('teacherNotes','teacher_notes'),('estimatedMinutes','estimated_minutes')]:
        params.append(raw.get(source));keys.append(f'{col}=${len(params)+1}')
    await con.execute('UPDATE lessons SET '+','.join(keys)+',updated_at=NOW() WHERE id=$1',target,*params)
    if isinstance(raw.get('blocks'),list):await reconcile_blocks(con,target,raw['blocks'])

async def publish(con,row,state,date,actor,*,system_schedule=False):
    """Atomic domain write + version switch; raised refusal rolls the entire transaction back."""
    current=row['publication_state']
    if current not in STATES or state not in TRANSITIONS[current]:
        bad('publication_transition_refused',f'A {current} revision cannot become {state}.','to')
    if state=='scheduled' and not date:bad('missing_publish_at','A scheduled revision needs the moment it opens.','publishAt')
    if state in ('scheduled','published'):
        if actor['role'] not in ('admin','owner') and not (system_schedule and actor['role']=='system'):bad('publish_forbidden','Publishing content requires an owner or administrator role.')
        key=(row['module'],row['content_type'])
        if key not in AUTHORS and key not in READING:bad('authoring_not_available',f'No author is registered for {row["module"]}:{row["content_type"]}; it cannot be published here.')
        if not row['target_id'] or not row['target_type']:bad('no_target','The revision is not attached to any content row.')
        if key==('listening','full_test'):
            structure=full_test_issue(snapshot_of(row))
            if structure:bad('incomplete_full_test',structure,'questions')
    key=(row['module'],row['content_type'])
    if key in AUTHORS and row['target_id']:
        if key[0]=='listening' and state in ('published','scheduled'):await listening_materialize(con,row)
        await update_state(con,AUTHORS[key],'id',row['target_id'],state,date)
    elif key in READING and row['target_id']:
        await reading_update(con,row,state,date)
    if state=='published':
        await con.execute('''UPDATE content_versions SET status='superseded',superseded_at=NOW() WHERE module=$1
          AND content_type=$2 AND source_ref=$3 AND status='published' AND id<>$4''',row['module'],row['content_type'],row['source_ref'],row['id'])
    updated=await con.fetchrow('''UPDATE content_versions SET publication_state=$2,status=$3,
       published_at=CASE WHEN $2='published' THEN NOW() ELSE published_at END WHERE id=$1 RETURNING *''',
       row['id'],state,'published' if state=='published' else 'archived' if state=='archived' else 'draft')
    if state=='published' and key==('lesson','lesson'):await materialize_lesson(con,dict(updated))
    return {'ok':True,'versionId':str(row['id']),'publicationState':state}

@router.post('/api/admin/content/versions/{id}/publication')
async def version_publication(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401)
    if user['role'] not in ('teacher','admin','owner'):return core.j({'error':'forbidden'},403)
    body,validation=parse_body(await core.payload(req))
    if validation:return core.j({'error':validation},400)
    state,date=body
    db=await core.pool()
    async with db.acquire() as con:
        # nextjs looks up `versionById` outside the write transaction.
        row=await con.fetchrow('''SELECT * FROM content_versions WHERE id=$1 AND NOT EXISTS
          (SELECT 1 FROM activity_events deleted_content WHERE
          deleted_content.id=md5('deleted-content:' || content_versions.id::text)::uuid
          AND deleted_content.type='CONTENT_DELETED')''',core.uuid_value(id)) if core.uuid_value(id) else None
        if row is None:return core.j({'error':'not_found'},404)
        row=dict(row);key=(row['module'],row['content_type'])
        if key not in AUTHORS and key not in READING:return core.j({'error':'forbidden'},403)
        if user['role']=='teacher' and key!=('lesson','lesson'):return core.j({'error':'forbidden'},403)
        try:
            async with con.transaction():
                answer=await publish(con,row,state,date,user)
        except PublicationRefusal as refusal:
            return core.j({'ok':False,'issues':[refusal.issue]},403 if refusal.issue['code']=='publish_forbidden' else 422)
        return core.j(answer)

def install():core.app.include_router(router)
