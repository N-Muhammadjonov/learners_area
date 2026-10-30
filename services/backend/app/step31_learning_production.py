"""Produced grammar, speaking transcripts and vocabulary active use.
Ports the three learner handlers and their service-side SQL write units, retaining
RIWI's actual Python evaluator and the configured provider/owner policy.
"""
from __future__ import annotations
import hashlib,json,re
from fastapi import APIRouter,Request
from . import main as core
from . import step31_coach as coach

from .rate_limit import evaluation_limit
router=APIRouter()

async def _query(sql,*params):
    db=await core.pool()
    async with db.acquire() as con:
        return await con.fetchrow(sql,*params)

async def _revision(con,topic):
    if not topic:return None
    row=await con.fetchrow("""SELECT id FROM content_versions WHERE target_type='grammar_topic' AND target_id=$1
                 AND status='published' ORDER BY version_no DESC LIMIT 1""",topic['id'])
    if row:return row['id']
    if topic['source_ref']:
        row=await con.fetchrow("""SELECT id FROM content_versions WHERE module='grammar' AND content_type='topic'
                  AND source_ref=$1 AND status='published' ORDER BY version_no DESC LIMIT 1""",topic['source_ref'])
    return row['id'] if row else None

async def _exercise_and_topic(id,uid):
    db=await core.pool()
    async with db.acquire() as con:
        ex=await con.fetchrow('''SELECT * FROM grammar_exercises WHERE id=$1 AND
                   (source_owner_user_id=$2 OR (source_owner_user_id IS NULL AND source_submission_id IS NULL)) LIMIT 1''',id,uid)
        if not ex:return None,None
        topic=await con.fetchrow('SELECT * FROM grammar_topics WHERE id=$1',ex['topic_id'])
        # The source retrieves the topic revision here but does not attach it to
        # produce attempts; preserve that exact historical behavior.
        if topic:await _revision(con,topic)
        return dict(ex),dict(topic) if topic else None

async def _remove_attempt(id):
    for _ in range(2):
        try:
            db=await core.pool()
            async with db.acquire() as con:await con.execute('DELETE FROM grammar_attempts WHERE id=$1',id)
            return True
        except Exception:
            pass
    return False

def _language(req):
    # The web app's language resolution uses the locale cookie, falling back to en.
    cookie=req.cookies.get('la_locale')
    return cookie if cookie in ('uz','en') else 'uz'

@router.post('/api/grammar/exercises/{id}/produce')
async def grammar_produce(req:Request,id:str):
    eid=core.uuid_value(id)
    if not eid:return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401)
    limited=await evaluation_limit(user['id'],lightweight=True)
    if limited is not None:return limited
    ex,topic=await _exercise_and_topic(eid,user['id'])
    if not ex:return core.j({'error':'not_found'},404)
    body=await core.payload(req)
    answer=body.get('answer') if isinstance(body,dict) else None
    if not isinstance(answer,str) or not 1<=len(answer)<=2000:return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as con:
        attempt=await con.fetchrow('''INSERT INTO grammar_attempts(user_id,exercise_id,selected_option,is_correct)
                       VALUES($1,$2,$3,false) RETURNING id''',user['id'],ex['id'],answer)
    if not attempt:return core.j({'error':'attempt_write_failed'},500)
    attempt_id=attempt['id']
    outcome=await coach.evaluate(user['id'],'grammar','grammar_attempt',attempt_id,
              {'promptText':ex['prompt_text'],'studentAnswer':answer,'targetStructure':topic['title'] if topic else None,
               'sampleAnswer':ex['correct_option']},_language(req))
    if not outcome['ok']:
        removed=await _remove_attempt(attempt_id)
        return core.j({'error':outcome['error'],**({} if removed else {'compensation':'attempt_row_retained'})},502)
    ev=outcome['evaluation'];verdict=ev['verdict']
    try:
        async with db.acquire() as con:
            async with con.transaction():
                await con.execute('UPDATE grammar_attempts SET is_correct=$2 WHERE id=$1',attempt_id,verdict=='correct')
                await con.execute("""INSERT INTO activity_events(user_id,type,payload)
                         VALUES($1,'GRAMMAR_PRODUCTION_SUBMITTED',$2::jsonb)""",user['id'],json.dumps({'exerciseId':str(ex['id']),'verdict':verdict}))
    except Exception:
        removed=await _remove_attempt(attempt_id)
        return core.j({'error':'result_write_failed',**({} if removed else {'compensation':'attempt_row_retained'})},500)
    return core.j({'ok':True,'attemptId':str(attempt_id),'verdict':verdict,'checkedBy':'RIWI',
                  'sampleAnswer':ex['correct_option'],'explanation':ex['explanation'],
                  'issues':[x['message'] for x in ev['issues']]})

@router.post('/api/speaking/attempts/{id}/transcript')
async def speaking_transcript(req:Request,id:str):
    aid=core.uuid_value(id)
    if not aid:return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401)
    limited=await evaluation_limit(user['id'],lightweight=False)
    if limited is not None:return limited
    attempt=await _query('SELECT * FROM speaking_attempts WHERE id=$1',aid)
    if not attempt:return core.j({'error':'not_found'},404)
    if attempt['user_id']!=user['id']:return core.j({'error':'forbidden'},403)
    body=await core.payload(req)
    transcript=body.get('manualTranscript') if isinstance(body,dict) else None
    if not isinstance(transcript,str) or not 10<=len(transcript)<=8000:return core.j({'error':'invalid_input'},400)
    prompt=await _query('SELECT prompt_text FROM speaking_prompts WHERE id=$1',attempt['prompt_id']) if attempt['prompt_id'] else None
    outcome=await coach.evaluate(user['id'],'speaking','speaking_attempt',aid,
       {'part':attempt['part'],'promptText':prompt['prompt_text'] if prompt else None,
        'transcript':transcript,'transcriptOrigin':'manual','durationMs':attempt['recording_duration_ms'],
        'pronunciationAvailable':False},_language(req))
    if not outcome['ok']:return core.j({'error':outcome['error']},502)
    db=await core.pool()
    async with db.acquire() as con:
        await con.execute('''UPDATE speaking_attempts SET transcript=$2,transcript_origin='manual',
                             transcript_provider=NULL WHERE id=$1''',aid,transcript)
    return core.j({'ok':True,'evaluationId':outcome['evaluation']['id'],'checkedBy':'RIWI','reused':outcome['reused']})


def _sentence_hash(sentence):
    norm=sentence.lower().translate(str.maketrans({'\u2018':"'",'\u2019':"'",'\u02bb':"'",'`':"'"}))
    norm=re.sub(r"[^a-z0-9' ]+",' ',norm)
    return hashlib.sha256(' '.join(norm.split()).encode()).hexdigest()[:32]

def _mastery(entry,extra):
    used=(entry['active_use_count']+extra)>0
    if used:return 'mastered' if entry['srs_stage']>=4 else 'active'
    if entry['srs_stage']<=-1:return 'new'
    if entry['srs_stage']>=2 and entry['correct_count']>entry['incorrect_count']:return 'known'
    return 'learning'

async def _confirm(con,uid,usage_id,accepted,evaluation_id):
    usage=await con.fetchrow('SELECT * FROM vocabulary_usages WHERE id=$1 AND user_id=$2',usage_id,uid)
    if not usage:return {'ok':False,'error':'not_found'}
    if usage['origin']!='manual':return {'ok':False,'error':'already_evaluated'}
    entry=await con.fetchrow('SELECT * FROM user_vocabulary WHERE id=$1',usage['user_vocabulary_id'])
    if not entry:return {'ok':False,'error':'not_found'}
    dedupe=f'sentence:{uid}:{entry["id"]}:{_sentence_hash(usage["sentence"])}'
    inserted=False
    if accepted:
        point=await con.fetchrow('''INSERT INTO vocab_point_events(user_id,kind,points,dedupe_key,ref_type,ref_id)
                        VALUES($1,'sentence',2,$2,'vocabulary_usage',$3)
                        ON CONFLICT(dedupe_key) DO NOTHING RETURNING id''',uid,dedupe,str(usage_id))
        inserted=bool(point)
    points=2 if inserted else 0
    mastery=_mastery(entry,1 if inserted else 0)
    await con.execute("""UPDATE vocabulary_usages SET origin='riwi',riwi_accepted=$2,evaluation_id=$3,
                           points_awarded=$4 WHERE id=$1""",usage_id,accepted,evaluation_id,points)
    if inserted:
        await con.execute('''UPDATE user_vocabulary SET active_use_count=active_use_count+1,mastery=$2,
                  mastered_at=CASE WHEN $2='mastered' THEN now() ELSE mastered_at END WHERE id=$1''',entry['id'],mastery)
    return {'ok':True,'mastery':mastery,'points':points}

@router.post('/api/vocabulary/{id}/use')
async def vocab_use(req:Request,id:str):
    entry_id=core.uuid_value(id)
    if not entry_id:return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401)
    limited=await evaluation_limit(user['id'],lightweight=True)
    if limited is not None:return limited
    db=await core.pool()
    async with db.acquire() as con:
        entry=await con.fetchrow('SELECT * FROM user_vocabulary WHERE id=$1 AND user_id=$2',entry_id,user['id'])
    if not entry:return core.j({'error':'not_found'},404)
    body=await core.payload(req);sentence=body.get('sentence') if isinstance(body,dict) else None
    if not isinstance(sentence,str) or not 3<=len(sentence)<=1000:return core.j({'error':'invalid_input'},400)
    async with db.acquire() as con:
        lexeme=await con.fetchrow('SELECT * FROM lexemes WHERE id=$1',entry['lexeme_id'])
    if not lexeme:return core.j({'error':'lexeme_missing'},500)
    # recordSentenceUse rechecks row ownership before inserting the manual draft.
    async with db.acquire() as con:
        row=await con.fetchrow('''INSERT INTO vocabulary_usages(user_id,user_vocabulary_id,sentence,origin,riwi_accepted,
                 evaluation_id,points_awarded) SELECT $1,id,$3,'manual',false,NULL,0 FROM user_vocabulary
                 WHERE id=$2 AND user_id=$1 RETURNING id''',user['id'],entry_id,sentence)
    if not row:return core.j({'error':'not_found'},404)
    usage_id=row['id']
    outcome=await coach.evaluate(user['id'],'vocabulary','vocabulary_usage',usage_id,
                 {'targetWord':lexeme['term'],'definition':lexeme['definition_en'],'studentSentence':sentence},_language(req))
    if not outcome['ok']:
        return core.j({'error':outcome['error'],'usageId':str(usage_id),'origin':'manual','accepted':False,'points':0},502)
    ev=outcome['evaluation'];accepted=ev['verdict']=='correct'
    async with db.acquire() as con:
        async with con.transaction():
            confirmed=await _confirm(con,user['id'],usage_id,accepted,core.uuid_value(ev['id']))
            await con.execute("""INSERT INTO activity_events(user_id,type,payload) VALUES($1,'VOCABULARY_USED',$2::jsonb)""",
              user['id'],json.dumps({'lexemeId':str(lexeme['id']),'verdict':ev['verdict'],'accepted':accepted}))
    return core.j({'ok':True,'usageId':str(usage_id),'verdict':ev['verdict'],'accepted':accepted,
        'checkedBy':'RIWI','mastery':confirmed['mastery'] if confirmed['ok'] else None,
        'points':confirmed['points'] if confirmed['ok'] else 0})

def install():core.app.include_router(router)
