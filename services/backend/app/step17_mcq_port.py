"""Listening MCQ Mastery: server-locked stages, session ownership, source version binding."""
from __future__ import annotations
import json,re
from fastapi import APIRouter,Request
from . import main as core
router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}
FLOW=[('listen','notes','notes',3),('notes','committed','own_answer',1),('committed','revealed',None,0),('revealed','chosen','chosen_answer',1),('chosen','reasoned','reasoning',10)]
STAGES=['listen','notes','committed','revealed','chosen','reasoned']
def staff(user):return user['role'] in ('teacher','admin','owner')
def live(row):
    from datetime import datetime,timezone
    if row['publication_state']=='published':return True
    at=row['publish_at']
    return row['publication_state']=='scheduled' and at is not None and at<=datetime.now(timezone.utc)
def correct_options(key,options,multi):
    try: values=json.loads(key) if multi and key.strip().startswith('[') else re.split(r'\s*[,;|]\s*',key) if multi else [key]
    except ValueError:return None
    if not isinstance(values,list) or any(not isinstance(x,str) for x in values) or multi and len(values)<2:return None
    result=[]
    for value in values:
        candidates=[x for x in options if x==value.strip() or re.sub(r'^[A-Z][).\s]+','',x)==value.strip() or (re.match(r'^([A-Z])[).\s]',x) and re.match(r'^([A-Z])[).\s]',x).group(1)==value.strip())]
        if len(candidates)!=1 or candidates[0] in result:return None
        result.append(candidates[0])
    return result or None
def selected(text,options,multi):
    try:value=json.loads(text) if multi else [text]
    except ValueError:return None
    if not isinstance(value,list) or not value or any(not isinstance(x,str) or x not in options for x in value) or len(set(value))!=len(value):return None
    return value
def correct(text,key,opts,multi):
    expected=correct_options(key,opts,multi)
    chosen=selected(text,opts,multi) or (correct_options(text,opts,False) if not multi else None)
    return bool(expected and chosen and len(expected)==len(chosen) and all(x in chosen for x in expected))
def view(session,question):
    stage=session['stage']; at=STAGES.index(stage); visible=at>=3; graded=at>=4
    step=next(({'to':v,'field': {'own_answer':'ownAnswer','chosen_answer':'chosenAnswer'}.get(field,field),'minLength':n} for start,v,field,n in FLOW if start==stage),None)
    options=question['options'] or [];options=json.loads(options) if isinstance(options,str) else options;multi=question['type_code']=='mcq_multi'
    return {'session':{'id':str(session['id']),'stage':stage,'notes':session['notes'],'ownAnswer':session['own_answer'],'chosenAnswer':session['chosen_answer'],'reasoning':session['reasoning']},
        'question':{'id':str(question['id']),'order':question['order'],'questionText':question['question_text']},
        'multiple':multi if visible else None,'options':options if visible else None,
        'correctAnswer':question['correct_answer'] if graded else None,
        'explanation':question['explanation'] if graded else None,
        'outcome':('correct' if correct(session['chosen_answer'] or '',question['correct_answer'],options,multi) else 'incorrect') if graded else None,'next':step}
async def available_set(con,test):
    version=await con.fetchrow("""SELECT id FROM content_versions WHERE target_type='listening_test' AND target_id=$1 AND status='published' ORDER BY version_no DESC LIMIT 1""",test)
    if version:
        rows=await con.fetch('SELECT id FROM listening_questions WHERE test_id=$1 AND content_version_id=$2 ORDER BY "order"',test,version['id'])
        if rows:return {str(r['id']) for r in rows}
    rows=await con.fetch('SELECT id FROM listening_questions WHERE test_id=$1 AND content_version_id IS NULL ORDER BY "order"',test)
    if not rows:rows=await con.fetch('SELECT id FROM listening_questions WHERE test_id=$1 ORDER BY "order"',test)
    return {str(r['id']) for r in rows}
async def sequence(con,user,test):
    if staff(user):return True
    if test['program_ref']=='listening-mcq-program':
        rows=await con.fetch("""SELECT id,program_ordinal FROM listening_tests WHERE program_ref='listening-mcq-program' AND (publication_state='published' OR (publication_state='scheduled' AND publish_at<=now())) AND NOT EXISTS (SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:' || listening_tests.id::text)::uuid AND d.type='CONTENT_DELETED') ORDER BY program_ordinal""")
        for x in rows:
            if x['id']==test['id']:return True
            live_ids=await available_set(con,x['id'])
            complete=await con.fetch('SELECT question_id FROM listening_mcq_sessions WHERE user_id=$1 AND test_id=$2 AND stage=$3',user['id'],x['id'],'reasoned')
            if not live_ids or len({str(r['question_id']) for r in complete}&live_ids)<len(live_ids):return False
        return False
    # The original course sequence is ordered by authored batch numbers and
    # persisted per-user checkpoints, never by the displayed title.
    from .step17_listening_course_port import CATALOGUE,SPEC,COURSE_KEY,read_work,course_status,runtime_source,state_key
    cases=' '.join('WHEN p.source_id=$'+str(i+2)+' THEN '+str(value.get('number',9999)) for i,(key,value) in enumerate(CATALOGUE.items()))
    arguments=[user['id'],*CATALOGUE.keys()]
    rows=await con.fetch(f"""SELECT t.id,p.source_id,c.values,
      EXISTS(SELECT 1 FROM listening_attempts a WHERE a.test_id=t.id AND a.user_id=$1 AND a.status='completed') AS original_exam_submitted
      FROM listening_packages p JOIN listening_tests t ON t.id=p.test_id
      LEFT JOIN listening_authored_checkpoints c ON c.test_id=t.id AND c.user_id=$1
      WHERE (t.publication_state='published' OR (t.publication_state='scheduled' AND t.publish_at<=now()))
      AND NOT EXISTS(SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:' || t.id::text)::uuid AND d.type='CONTENT_DELETED')
      ORDER BY t.created_at,CASE {cases} ELSE NULL END,t.source_ref,t.id""",*arguments)
    previous_complete=True
    for row in rows:
        if not runtime_source(str(row['id']),row['source_id']):continue
        source=row['source_id'];spec=SPEC.get(source)
        if not spec:continue
        values=row['values'] or {}
        if isinstance(values,str):values=json.loads(values)
        work=read_work(values,spec)
        if not work['exam'] and row['original_exam_submitted']:
            try:state=json.loads(values.get(state_key(source),'{}'))
            except (ValueError,TypeError):state={}
            results=state.get('lastResults')
            if state.get('attemptStatus')=='submitted' and isinstance(results,list) and len(results)==40:
                work={**work,'exam':True,'retry':[str(r.get('q')) for r in results if r.get('ok') is False]}
        complete=course_status(spec,work)['complete']
        if row['id']==test['id']:return previous_complete
        previous_complete=previous_complete and complete
    return True
async def access(con,user,q):
    test=await con.fetchrow('SELECT * FROM listening_tests WHERE id=$1',q['test_id'])
    if not test or (not staff(user) and not live(test)):return 'not_found'
    if not await sequence(con,user,test):return 'sequence_locked'
    in_progress=await con.fetchval("SELECT EXISTS(SELECT 1 FROM listening_attempts WHERE user_id=$1 AND test_id=$2 AND status='in_progress')",user['id'],q['test_id'])
    if in_progress:return 'exam_in_progress'
    if str(q['id']) not in await available_set(con,q['test_id']):return 'not_found'
    return 'ok'
def err(error):return core.j({'error':error},404 if error=='not_found' else 403 if error=='sequence_locked' else 409)
@router.post('/api/listening/mcq')
async def start(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    body=await core.payload(req)
    if not isinstance(body,dict) or not core.uuid_value(body.get('questionId')):return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as con:
        question=await con.fetchrow('SELECT * FROM listening_questions WHERE id=$1',core.uuid_value(body['questionId']))
        if not question or question['type']!='multiple_choice':return err('not_found')
        status=await access(con,user,question)
        if status!='ok':return err(status)
        session=await con.fetchrow('SELECT * FROM listening_mcq_sessions WHERE user_id=$1 AND question_id=$2',user['id'],question['id'])
        if not session:
            session=await con.fetchrow('''INSERT INTO listening_mcq_sessions(user_id,test_id,question_id) VALUES($1,$2,$3) ON CONFLICT(user_id,question_id) DO NOTHING RETURNING *''',user['id'],question['test_id'],question['id'])
            if not session:session=await con.fetchrow('SELECT * FROM listening_mcq_sessions WHERE user_id=$1 AND question_id=$2',user['id'],question['id'])
    return core.j(view(session,question),headers=PRIVATE)
async def owned(con,user,id):
    return await con.fetchrow('SELECT * FROM listening_mcq_sessions WHERE user_id=$1 AND id=$2',user['id'],core.uuid_value(id))
@router.get('/api/listening/mcq/{id}')
async def get(req:Request,id:str):
    if not core.uuid_value(id):return err('not_found')
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    db=await core.pool()
    async with db.acquire() as con:
        session=await owned(con,user,id)
        if not session:return err('not_found')
        q=await con.fetchrow('SELECT * FROM listening_questions WHERE id=$1',session['question_id'])
        if not q:return err('not_found')
        status=await access(con,user,q)
        if status!='ok':return err(status)
    return core.j(view(session,q),headers=PRIVATE)
@router.patch('/api/listening/mcq/{id}')
async def advance(req:Request,id:str):
    if not core.uuid_value(id):return err('not_found')
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    db=await core.pool()
    async with db.acquire() as con:
        session=await owned(con,user,id)
        if not session:return err('not_found')
        body=await core.payload(req)
        if not isinstance(body,dict) or not isinstance(body.get('step'),str) or not 1<=len(body['step'])<=20 or 'text' in body and (not isinstance(body['text'],str) or len(body['text'])>2000):return core.j({'error':'invalid_input'},400)
        q=await con.fetchrow('SELECT * FROM listening_questions WHERE id=$1',session['question_id'])
        if not q:return err('not_found')
        status=await access(con,user,q)
        if status!='ok':return err(status)
        action=next((row for row in FLOW if row[0]==session['stage']),None)
        if not action or body['step']!=action[1]:return core.j({'error':'out_of_order','stage':session['stage']},409)
        text=(body.get('text') or '').strip()
        if action[2] and len(text)<action[3]:return core.j({'error':'missing_text','stage':session['stage']},409)
        if action[2]=='chosen_answer' and not selected(text,json.loads(q['options']) if isinstance(q['options'],str) else q['options'] or [],q['type_code']=='mcq_multi'):
            return core.j({'error':'not_in_options','stage':session['stage']},400)
        field=action[2]
        statement=f'UPDATE listening_mcq_sessions SET stage=$1,updated_at=now()'+(f',{field}=$2 WHERE id=$3 AND user_id=$4 AND stage=$5 RETURNING *' if field else ' WHERE id=$2 AND user_id=$3 AND stage=$4 RETURNING *')
        args=(action[1],text,session['id'],user['id'],session['stage']) if field else (action[1],session['id'],user['id'],session['stage'])
        updated=await con.fetchrow(statement,*args)
        if not updated:return err('not_found')
    return core.j(view(updated,q),headers=PRIVATE)
def install():core.app.include_router(router)
