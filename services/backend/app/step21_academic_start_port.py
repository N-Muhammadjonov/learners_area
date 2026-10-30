"""Academic Reading start: serializable membership and exact 40-question snapshot.

Keeps source's one active attempt, immutable 3-passage mapping, and the four
reviewed omissions for 41-question source material.
"""
from __future__ import annotations
from fastapi import APIRouter,Request
from . import main as core
from .step17_mcq_port import staff, live

router=APIRouter()
OMISSIONS={
 'reading105:test:08':('t08-p2-european-heat-wave',14),
 'reading105:test:12':('t12-p1-how-printed-books-began',14),
 'reading105:test:30':('t30-p1-the-terracotta-army',16),
 'reading105:test:31':('t31-p1-this-is-very-much-the-story-of-a-story',14),
}

async def eligible(con,set_row):
    slots=await con.fetch('SELECT passage_id,passage_no FROM general_reading_passages WHERE set_id=$1 ORDER BY passage_no',set_row['id'])
    if len(slots)!=3 or [int(s['passage_no']) for s in slots]!=[1,2,3]:return None
    questions=await con.fetch('''SELECT q.id,q.passage_id,q."order",q.question_no,p.external_id
      FROM reading_questions q JOIN reading_passages p ON p.id=q.passage_id
      WHERE q.passage_id=ANY($1::uuid[])''',[s['passage_id'] for s in slots])
    omit=OMISSIONS.get(set_row['source_ref'])
    if len(questions)==41 and omit:
        excluded=[q for q in questions if q['external_id']==omit[0] and q['question_no']==omit[1]]
        if len(excluded)==1:questions=[q for q in questions if q['id']!=excluded[0]['id']]
    if len(questions)!=40 or any(not any(q['passage_id']==s['passage_id'] for q in questions) for s in slots):return None
    for slot in slots:
        passage=await con.fetchrow('SELECT publication_state,publish_at FROM reading_passages WHERE id=$1',slot['passage_id'])
        if not passage or not live(passage):return None
    return slots,sorted(questions,key=lambda q:([s['passage_id'] for s in slots].index(q['passage_id']),q['order']))

@router.post('/api/reading/academic')
async def start(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    data=await core.payload(req)
    if not isinstance(data,dict) or set(data)!={'setId'} or not core.uuid_value(data['setId']):return core.j({'error':'invalid_input'},400)
    key=core.uuid_value(data['setId'])
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            await con.execute('SELECT pg_advisory_xact_lock(hashtext($1))',str(user['id'])+':'+str(key))
            set_row=await con.fetchrow('''SELECT * FROM general_reading_sets WHERE id=$1 AND
            NOT EXISTS(SELECT 1 FROM activity_events a WHERE a.id=md5('deleted-content:' || general_reading_sets.id::text)::uuid AND a.type='CONTENT_DELETED') FOR SHARE''',key)
            if not set_row or not live(set_row):return core.j({'error':'not_found'},404)
            from .browser_reading import academic_locked
            if await academic_locked(con,user,set_row):return core.j({'error':'sequence_locked'},403)
            chosen=await eligible(con,set_row)
            if not chosen:return core.j({'error':'not_found'},404)
            slots,questions=chosen
            previous=await con.fetchrow('''SELECT a.id FROM reading_attempts a JOIN reading_assessments r ON r.attempt_id=a.id
                WHERE a.user_id=$1 AND r.set_id=$2 AND a.status='in_progress' ORDER BY a.started_at DESC LIMIT 1''',user['id'],key)
            if previous:return core.j({'id':str(previous['id'])},headers={'Cache-Control':'private, no-store'})
            rev=await con.fetchrow("""SELECT id FROM content_versions WHERE target_type='general_reading_set' AND target_id=$1
            AND status='published' ORDER BY version_no DESC LIMIT 1""",key)
            attempt=await con.fetchrow('''INSERT INTO reading_attempts(user_id,passage_id,content_version_id)
                VALUES($1,$2,$3) RETURNING id''',user['id'],slots[0]['passage_id'],rev['id'] if rev else None)
            await con.execute('INSERT INTO reading_assessments(attempt_id,set_id,title) VALUES($1,$2,$3)',attempt['id'],key,set_row['title'])
            await con.executemany('INSERT INTO reading_assessment_passages(attempt_id,passage_id,passage_no) VALUES($1,$2,$3)',
                [(attempt['id'],s['passage_id'],s['passage_no']) for s in slots])
            if await con.fetchval("SELECT to_regclass('public.reading_assessment_questions') IS NOT NULL"):
                await con.executemany('''INSERT INTO reading_assessment_questions(attempt_id,question_id,position) VALUES($1,$2,$3)''',
                    [(attempt['id'],q['id'],i+1) for i,q in enumerate(questions)])
    return core.j({'id':str(attempt['id'])},headers={'Cache-Control':'private, no-store'})

def install():core.app.include_router(router)
