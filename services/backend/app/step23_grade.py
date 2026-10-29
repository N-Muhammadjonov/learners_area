"""Writing Grade My Work create/retry. Save question/essay before any external call.
One claim per request, strict external result, deterministic IELTS-four-criteria bands.
"""
from __future__ import annotations
import asyncio,json,math,re,time
from uuid import UUID
from fastapi import APIRouter,Request
from . import main as core
from . import step23_writing_provider as ai
from .rate_limit import evaluation_limit
router=APIRouter()
LABELS={'task_achievement':'Task Achievement','task_response':'Task Response','coherence_cohesion':'Coherence & Cohesion','lexical_resource':'Lexical Resource','grammatical_range_accuracy':'Grammatical Range & Accuracy'}

def error(code,message,field=None):return {'error':{'code':code,'message':message,**({'field':field} if field is not None else {})}}
def valid_uuid(s):return isinstance(s,str) and core.uuid_value(s) is not None
def word_count(s):return len(s.strip().split()) if s.strip() else 0

def criteria(task,items):
    slots={};names=['task','coherence_cohesion','lexical_resource','grammatical_range_accuracy']
    if not isinstance(items,list):return None
    for c in items:
        k=re.sub(r'[^a-z]','',str(c.get('key','')).lower())
        name=re.sub(r'[^a-z]','',str(c.get('label','')).lower())
        x=k if k.startswith('task') or k in ('ta','tr') else name if name.startswith('task') or name in ('ta','tr') else k
        slot='task' if x.startswith('task') or x in ('ta','tr') else ('coherence_cohesion' if x.startswith('coherence') or x=='cc' else 'lexical_resource' if x.startswith('lexical') or x=='lr' else 'grammatical_range_accuracy' if x.startswith(('grammatical','grammar')) or x=='gra' else None)
        if slot is None:continue
        v=c.get('band')
        if slot in slots or c.get('limited') or type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=9:return None
        band=math.floor(v*2+0.5)/2;key=('task_achievement' if task=='task1' else 'task_response') if slot=='task' else slot
        slots[slot]={'key':key,'label':LABELS[key],'band':band,'note':str(c['note']).strip()[:500] if isinstance(c.get('note'),str) and c['note'].strip() else None}
    if any(x not in slots for x in names):return None
    rows=[slots[x] for x in names]
    overall=math.floor(sum(x['band'] for x in rows)/4*2+0.5)/2
    return overall,rows

async def run_grade(con,req_id,user_id,language):
    row=await con.fetchrow('''UPDATE writing_grade_requests SET claimed_at=NOW() WHERE id=$1 AND user_id=$2
       AND status<>'evaluated' AND (claimed_at IS NULL OR claimed_at<NOW()-interval '3 minutes') RETURNING *''',req_id,user_id)
    if not row:
        old=await con.fetchrow('SELECT status FROM writing_grade_requests WHERE id=$1 AND user_id=$2',req_id,user_id)
        return {'ok':True} if old and old['status']=='evaluated' else {'ok':False,'error':'in_progress' if old else 'not_found'}
    try:
        existing=await con.fetchrow('''SELECT id,provider_type,fallback_used FROM evaluations WHERE source_type='writing_grade' AND source_id=$1''',req_id)
        if existing:
            if existing['provider_type']=='external' and not existing['fallback_used']:
                await con.execute('''UPDATE writing_grade_requests SET status='evaluated',claimed_at=NULL,evaluated_at=NOW() WHERE id=$1''',req_id)
                return {'ok':True}
            raise ValueError('invalid_evaluation')
        task=row['task_type'];p,err=await ai.evaluate(language,'writing',{'taskType':task,'question':row['question_text'],'essay':row['essay_text'],'wordCount':row['word_count']},ai.grade_system(task),5000)
        if err:return await failure(con,req_id,'external_required' if err=='unavailable' else 'evaluation_unavailable')
        norm=criteria(task,p['data']['criteria'])
        if not norm:return await failure(con,req_id,'invalid_evaluation')
        overall,criterion=norm;meta=p['provider'];data=p['data']
        async with con.transaction():
            await con.execute('''INSERT INTO evaluations(user_id,evaluation_type,source_type,source_id,provider_id,
                provider_display_name,provider_type,provider_version,model,prompt_version,rubric_version,fallback_used,checked_by_name,
                overall_estimate,confidence,verdict,criteria,strengths,weaknesses,issues,next_actions,recommended_exercises,processed_in_ms)
                VALUES($1,'writing','writing_grade',$2,$3,$4,'external','1',$5,'writing-ielts-v2','ielts-writing-four-criteria-v1',FALSE,'RIWI',
                $6,$7,NULL,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,'[]'::jsonb,0)
                ON CONFLICT (source_type,source_id) DO NOTHING''',user_id,req_id,meta['id'],meta['id'].capitalize(),meta['model'],overall,data['confidence'],json.dumps(criterion),json.dumps(data['strengths']),json.dumps(data['weaknesses']),json.dumps(data['issues']),json.dumps(data['nextActions']))
            await con.execute('''UPDATE writing_grade_requests SET status='evaluated',claimed_at=NULL,evaluated_at=NOW(),last_error=NULL,analysis=$2::jsonb WHERE id=$1''',req_id,json.dumps(data['writingAnalysis']) if isinstance(data.get('writingAnalysis'),dict) else None)
            await con.execute('''INSERT INTO activity_events(user_id,type,payload) VALUES($1,'EVALUATION_COMPLETED',$2::jsonb)''',user_id,json.dumps({'sourceId':str(req_id),'providerId':meta['id'],'overallEstimate':overall,'evaluationType':'writing'}))
        return {'ok':True}
    except Exception:return await failure(con,req_id,'evaluation_unavailable')

async def failure(con,req_id,err):
    await con.execute('UPDATE writing_grade_requests SET status=$2,last_error=$3,claimed_at=NULL WHERE id=$1',req_id,'failed',err[:60])
    return {'ok':False,'error':err}

@router.post('/api/writing/grade')
async def new_grade(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j(error('unauthenticated','Sign in again.'),401)
    limited=await evaluation_limit(user['id'],lightweight=False)
    if limited is not None:return limited
    b=await core.payload(req)
    allowed={'taskType','question','essay','idempotencyKey','promptId'}
    issue=next((k for k in ['taskType','question','essay','idempotencyKey','promptId'] if isinstance(b,dict) and k in b and (
        k=='taskType' and b[k] not in ('task1','task2') or k=='question' and (not isinstance(b[k],str) or not 10<=len(b[k].strip())<=4000) or
        k=='essay' and (not isinstance(b[k],str) or len(b[k])>20000) or k=='idempotencyKey' and (not isinstance(b[k],str) or re.fullmatch('[A-Za-z0-9_-]{8,64}',b[k]) is None) or k=='promptId' and b[k] is not None and not valid_uuid(b[k]))),None)
    if not isinstance(b,dict) or set(b)-allowed or not {'taskType','question','essay','idempotencyKey'}<=set(b) or issue:
        return core.j(error('invalid_input','Check the question and essay.',issue or ''),400)
    if word_count(b['essay'])<50:return core.j(error('too_short','The essay is too short to grade.','essay'),400)
    db=await core.pool()
    async with db.acquire() as con:
        prompt_id=core.uuid_value(b.get('promptId')) if b.get('promptId') else None
        question=b['question'].strip()
        if prompt_id:
            p=await con.fetchrow('''SELECT id,prompt FROM writing_prompts WHERE id=$1 AND task_type=$2 AND
                   (publication_state='published' OR (publication_state='scheduled' AND publish_at<=NOW()))''',prompt_id,b['taskType'])
            if not p:return core.j(error('invalid_input','This question is not available.','promptId'),400)
            question=p['prompt']
        row=await con.fetchrow('''INSERT INTO writing_grade_requests(user_id,task_type,question_text,essay_text,word_count,idempotency_key,prompt_id)
           VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id''',user['id'],b['taskType'],question,b['essay'],word_count(b['essay']),b['idempotencyKey'],prompt_id)
        if not row:
            row=await con.fetchrow('SELECT id FROM writing_grade_requests WHERE user_id=$1 AND idempotency_key=$2',user['id'],b['idempotencyKey'])
            if not row:raise RuntimeError('grade_request_write_failed')
        r=await run_grade(con,row['id'],user['id'],user.get('locale','en'))
    return core.j({'ok':True,'id':str(row['id']),'status':'evaluated'} if r['ok'] else {'ok':False,'id':str(row['id']),'status':'pending' if r['error']=='in_progress' else 'failed','error':{'code':r['error'],'message':'AI grading did not complete. Your essay is saved.','retryable':r['error'] not in ('external_required','not_found')}})

@router.post('/api/writing/grade/{id}')
async def retry_grade(req:Request,id:str):
    if not valid_uuid(id):return core.j(error('not_found','Not found.'),404)
    user=await core.current_user(req,active=True)
    if not user:return core.j(error('unauthenticated','Sign in again.'),401)
    limited=await evaluation_limit(user['id'],lightweight=False)
    if limited is not None:return limited
    db=await core.pool()
    async with db.acquire() as con:r=await run_grade(con,core.uuid_value(id),user['id'],user.get('locale','en'))
    if r['ok']:return core.j({'ok':True,'id':id,'status':'evaluated'})
    if r['error']=='not_found':return core.j(error('not_found','Not found.'),404)
    return core.j({'ok':False,'id':id,'status':'pending' if r['error']=='in_progress' else 'failed','error':{'code':r['error'],'message':'AI grading did not complete. Your essay is saved.','retryable':r['error']!='external_required'}})

def install():core.app.include_router(router)
