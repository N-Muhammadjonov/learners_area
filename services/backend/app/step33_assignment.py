"""Assignment orchestrator and RIWI free-form evaluator port."""
from __future__ import annotations
import json,re,math
from fastapi import APIRouter,Request
from . import main as core
from .step31_learning_production import _language
from .step31_riwi_text import analyse,LINK
from . import step31_coach as coach
router=APIRouter()

WRITING_REASON='The assignment is linked to a writing prompt, so the writing rubric applies.'
FREE_REASON='No task type is attached to this assignment, so it is evaluated as a free-form response.'

def aval(title,description,studentResponse):
    a=analyse(studentResponse);w=a['wordCount'];p=[x for x in re.split(r'\n{2,}',studentResponse) if x.strip()]
    links=[x for x in LINK if re.search(r'\b'+re.escape(x)+r'\b',a['lower'])]
    s=[];weak=[];actions=[]
    issues=[{**i,'excerpt':i.get('excerpt') or None} for i in a['issues'][:8]]
    short=w<80
    if short:
        weak.append(f'The response is {w} words; assignments here expect roughly 80+.')
        actions.append('Expand each point with a reason and one concrete example.')
        issues.append({'category':'WRITING_LENGTH','message':f'Short response: {w} words.','severity':'high' if w<30 else 'medium','suggestion':'Aim for a developed answer rather than a list of headings.'})
    else:s.append(f'Developed response ({w} words).')
    if len(p)>1:s.append(f'{len(p)} paragraphs — the response is structured.')
    elif w>120:weak.append('One long block of text — split it into paragraphs.')
    if not links:weak.append('No cohesive devices — the reader has to infer the connection between points.')
    else:s.append(f'Uses {len(links)} distinct cohesive device(s).')
    repeated=next(iter(a['topRepeatedContentWords']),None)
    if repeated and repeated['count']>=6:weak.append(f'"{repeated["word"]}" repeated {repeated["count"]} times.')
    high=sum(x['severity']=='high' for x in a['issues'])
    if high:weak.append(f'{high} grammatical error pattern(s) detected.')
    verdict='needs_correction' if short or any(i['severity']=='high' for i in issues) else 'mostly_correct' if issues else 'correct'
    labels={'correct':'Correct','mostly_correct':'Mostly correct','needs_correction':'Needs correction'}
    criteria=[{'key':'verdict','label':labels[verdict],'band':None,'note':'RIWI reports measured facts for this assignment type, not a band score.'},
       {'key':'development','label':'Development','band':None,'note':f'{w} words in {len(p)} paragraph(s).'},
       {'key':'cohesion','label':'Cohesion','band':None,'note':f'{len(links)} distinct cohesive device(s).'}]
    if description is None:actions.append('This assignment has no description — ask your teacher what the expected output is.')
    return {'overallEstimate':None,'confidence':math.floor(min(.7,.3+w/400)*100+.5)/100,'criteria':criteria,'strengths':s[:5],
       'weaknesses':weak[:5],'issues':issues[:8],'nextActions':actions[:4] if actions else ['Re-read your response once and cut anything that does not answer the assignment.'],
       'recommendedExercises':[{'kind':'writing','label':'Practice task','href':'/app/writing','reason':'Structured writing practice feeds the same weakness tracking as this assignment.'}],
       'verdict':verdict}

async def completed(assignment_id,subject):
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            await con.execute("UPDATE assignments SET status='completed' WHERE id=$1",assignment_id)
            await con.execute("""UPDATE assignment_targets SET status='completed',completed_at=now(),updated_at=now()
                    WHERE assignment_id=$1 AND student_user_id=$2""",assignment_id,subject)

@router.post('/api/assignments/{id}/evaluate')
async def assignment_evaluate(req:Request,id:str):
    aid=core.uuid_value(id)
    if not aid:return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401)
    db=await core.pool()
    async with db.acquire() as con:
        assignment=await con.fetchrow('SELECT * FROM assignments WHERE id=$1',aid)
        if not assignment:return core.j({'error':'not_found'},404)
        targets=await con.fetch('SELECT student_user_id FROM assignment_targets WHERE assignment_id=$1',aid)
    is_target=user['id']==assignment['target_user_id'] or any(x['student_user_id']==user['id'] for x in targets)
    is_manager=user['role'] in ('admin','owner') or (user['role']=='teacher' and user['id']==assignment['created_by_user_id'])
    if not is_target and not is_manager:return core.j({'error':'forbidden'},403)
    subject=user['id'] if is_target else assignment['target_user_id']
    body=await core.payload(req)
    if body is None:body={}
    if not isinstance(body,dict) or set(body)-{'response'} or ('response' in body and (not isinstance(body['response'],str) or not 20<=len(body['response'])<=20000)):
        return core.j({'error':'invalid_input'},400)
    response=body.get('response')
    if is_target and response:
        async with db.acquire() as con:
            await con.execute('''INSERT INTO assignment_responses(assignment_id,user_id,content) VALUES($1,$2,$3)
                ON CONFLICT (assignment_id,user_id) DO UPDATE SET content=EXCLUDED.content,updated_at=NOW()''',aid,user['id'],response)
    if assignment['related_writing_prompt_id']:
        async with db.acquire() as con:
            submission=await con.fetchrow('''SELECT * FROM writing_submissions WHERE user_id=$1 AND prompt_id=$2
                 ORDER BY updated_at DESC LIMIT 1''',subject,assignment['related_writing_prompt_id'])
            if not submission:return core.j({'error':'no_submission','reason':WRITING_REASON},409)
            if submission['status']=='draft' or not (submission['content'] or '').strip():return core.j({'error':'submission_not_written'},409)
            prompt=await con.fetchrow('SELECT * FROM writing_prompts WHERE id=$1',submission['prompt_id'])
            if not prompt:return core.j({'error':'prompt_missing'},500)
        outcome=await coach.evaluate(subject,'writing','writing_submission',submission['id'],
            {'taskType':prompt['task_type'],'prompt':prompt['prompt'],'content':submission['content'],'targetWordCount':prompt['target_word_count']},_language(req))
        if not outcome['ok']:return core.j({'error':outcome['error']},502)
        await completed(aid,subject)
        return core.j({'ok':True,'dispatchedTo':'writing','evaluationId':outcome['evaluation']['id'],'checkedBy':'RIWI','reason':WRITING_REASON})
    if not response:return core.j({'error':'response_required'},400)
    if not is_target:return core.j({'error':'student_response_required'},400)
    outcome=await coach.evaluate(user['id'],'assignment','assignment',aid,
         {'title':assignment['title'],'description':assignment['description'],'studentResponse':response},_language(req))
    if not outcome['ok']:return core.j({'error':outcome['error']},502)
    await completed(aid,subject)
    return core.j({'ok':True,'dispatchedTo':'free_form','evaluationId':outcome['evaluation']['id'],
       'checkedBy':'RIWI','verdict':outcome['evaluation']['verdict'],'reason':FREE_REASON})

def install():core.app.include_router(router)
