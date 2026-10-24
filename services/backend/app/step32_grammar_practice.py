"""Grammar practice: deterministic structure matching or persisted Coach evaluation.
Port of /api/grammar/exercises/[id]/practice plus grammar/mastery.ts.
"""
from __future__ import annotations
import json,re
from fastapi import APIRouter,Request
from . import main as core
from .step31_learning_production import _exercise_and_topic,_revision,_remove_attempt,_language
from . import step31_coach as coach
router=APIRouter()

def check_structures(answer,structures):
    haystack=re.sub(r'\s+',' ',answer.lower().replace('\u2019',"'").strip())
    used=[];missing=[]
    for raw in structures:
        s=re.sub(r'\s+',' ',raw.lower().replace('\u2019',"'").strip())
        if not s:missing.append(raw);continue
        tokens=s.split(' ')
        escaped=[re.escape(t) for t in tokens]
        simple=r'\b'+r'\s+'.join(escaped)+r'\b'
        pattern=r'\b'+escaped[0]+r'\w*'+r'(?:\s+\w+){0,4}\s+'+r'\s+'.join(escaped[1:])+r'\b'
        ok=bool(re.search(r'\b'+escaped[0]+r'\w*\b',haystack)) if len(tokens)==1 else bool(re.search(pattern,haystack) or re.search(simple,haystack))
        (used if ok else missing).append(raw)
    return {'used':used,'missing':missing,'complete':not missing and bool(used)}

def structure_verdict(check,authored):
    if not authored:return 'undetermined'
    if check['complete']:return 'correct'
    if check['used']:return 'partial'
    return 'incorrect'

@router.post('/api/grammar/exercises/{id}/practice')
async def grammar_practice(req:Request,id:str):
    eid=core.uuid_value(id)
    if not eid:return core.j({'error':'not_found'},404)
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':'unauthenticated'},401)
    body=await core.payload(req)
    if not isinstance(body,dict) or set(body)!={'activity','answer'} or body.get('activity') not in ('translate_it','activate_it') or not isinstance(body.get('answer'),str) or not 2<=len(body['answer'])<=2000:
        return core.j({'error':'invalid_input'},400)
    exercise,topic=await _exercise_and_topic(eid,u['id'])
    if not exercise:return core.j({'error':'not_found'},404)
    structures=exercise.get('target_structures') or []
    if isinstance(structures,str):structures=json.loads(structures)
    check=check_structures(body['answer'],structures)
    verdict=structure_verdict(check,bool(structures))
    needs=body['activity']=='activate_it' or verdict=='undetermined'
    db=await core.pool()
    async with db.acquire() as con:
        revision=await _revision(con,topic) if topic else None
        async def insert_attempt():
            return await con.fetchrow('''INSERT INTO grammar_attempts(user_id,exercise_id,activity,selected_option,response_text,is_correct,content_version_id)
                   VALUES($1,$2,$3,'',$4,$5,$6) RETURNING id''',u['id'],eid,body['activity'],body['answer'],verdict=='correct',revision)
        if not needs:
            async with con.transaction():
                attempt=await insert_attempt()
                if attempt:
                    await con.execute('''INSERT INTO activity_events(user_id,type,payload) VALUES($1,'GRAMMAR_PRACTICE_SUBMITTED',$2::jsonb)''',u['id'],json.dumps({'exerciseId':str(eid),'activity':body['activity'],'verdict':verdict}))
        else:attempt=await insert_attempt()
    if not attempt:return core.j({'error':'attempt_write_failed'},500)
    attempt_id=attempt['id']
    issues=[];checked_by=None
    if needs:
        source=(exercise.get('translate_prompt_uz') or exercise['prompt_text']) if body['activity']=='translate_it' else (exercise.get('activation_prompt') or exercise['prompt_text'])
        result=await coach.evaluate(u['id'],'grammar','grammar_attempt',attempt_id,{'promptText':source,'studentAnswer':body['answer'],'targetStructure':topic['title'] if topic else None,'sampleAnswer':exercise['correct_option']},_language(req))
        if not result['ok']:
            await _remove_attempt(attempt_id)
            return core.j({'error':result['error']},502)
        verdict=result['evaluation']['verdict'];checked_by='RIWI'
        issues=[issue['message'] for issue in result['evaluation']['issues']]
        async with db.acquire() as con:
            await con.execute('UPDATE grammar_attempts SET is_correct=$2 WHERE id=$1',attempt_id,verdict=='correct')
            await con.execute('''INSERT INTO activity_events(user_id,type,payload) VALUES($1,'GRAMMAR_PRACTICE_SUBMITTED',$2::jsonb)''',u['id'],json.dumps({'exerciseId':str(eid),'activity':body['activity'],'verdict':verdict}))
    return core.j({'ok':True,'attemptId':str(attempt_id),'activity':body['activity'],'verdict':verdict,'checkedBy':checked_by,'structures':check,'sampleAnswer':exercise['correct_option'],'explanation':exercise['explanation'],'issues':issues})

def install():core.app.include_router(router)
