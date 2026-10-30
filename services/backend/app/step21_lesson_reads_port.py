"""Learner lesson projections/quiz answers. Based on content/lessons.ts.
A response's answer key is disclosed only after the learner has answered.
"""
from __future__ import annotations
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Request
from . import main as core
from .db import row_to_dict

router = APIRouter()


def live(record):
    state = record['publication_state']
    return state == 'published' or (state == 'scheduled' and record['publish_at'] is not None and record['publish_at'] <= datetime.now(timezone.utc))


def normal(value):
    return re.sub(r'\.$','',re.sub(r'\s+',' ',str(value).strip().lower().replace('\u2018',"'").replace('\u2019',"'").replace('\u02bc',"'").replace('\u2013','-').replace('\u2014','-').replace('_',' ')))


def matches(answer, correct):
    a=normal(answer);b=normal(correct)
    if not a:return False
    if a == b:return True
    def letter(s):
        m=re.match(r'^([a-z])\s*-\s*\S',s)
        return m.group(1) if m else None
    la=letter(a);lb=letter(b)
    return (la and lb and la==lb) or (la and a==b) or (lb and a==lb) or (la and b==la)


def grade(kind, answer, payload):
    """Canonical per-kind grader; conservative for unsupported registry members."""
    key=payload.get('answer','')
    options=payload.get('options') or []
    if kind in ('mcq_single','multiple_choice','mcq'):
        return matches(answer,key)
    if kind in ('true_false_not_given','yes_no_not_given'):
        valid=('TRUE','FALSE','NOT GIVEN') if kind.startswith('true') else ('YES','NO','NOT GIVEN')
        return normal(answer).upper() in valid and normal(answer)==normal(key)
    if kind in ('short_answer','sentence_completion','note_completion','summary_completion','table_completion','form_completion','gap_fill','matching_information','matching_headings','matching_features','matching_sentence_endings','map_labeling','plan_labeling','diagram_labeling'):
        return matches(answer,key)
    if kind in ('mcq_multi','multiple_choice_multi'):
        provided=[s.strip() for s in re.split(r'[,;]|\s+and\s+',answer,flags=re.I) if s.strip()]
        keys=key if isinstance(key,list) else [s.strip() for s in re.split(r'[,;]|\s+and\s+',key,flags=re.I) if s.strip()]
        return bool(keys) and len(provided)==len(keys) and all(any(matches(a,k) for k in keys) for a in provided) and len({normal(v) for v in provided})==len(provided)
    return None


@router.get('/api/lessons/{id}')
async def read_lesson(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if not core.uuid_value(id):return core.j({'error':'not_found'},404)
    db=await core.pool()
    async with db.acquire() as con:
        lesson=await con.fetchrow('SELECT * FROM lessons WHERE id=$1',core.uuid_value(id))
        if not lesson or not live(lesson):return core.j({'error':'not_found'},404)
        rows=await con.fetch('SELECT * FROM lesson_blocks WHERE lesson_id=$1 ORDER BY position',lesson['id'])
        answers=await con.fetch('SELECT * FROM lesson_block_responses WHERE lesson_id=$1 AND user_id=$2',lesson['id'],user['id'])
        by_block={str(r['block_id']):r for r in answers}
        blocks=[]
        for row in rows:
            quiz_payload=row['quiz_payload'] if isinstance(row['quiz_payload'],dict) else {}
            ans=by_block.get(str(row['id']))
            quiz=({'questionType':row['quiz_question_type'],'prompt':quiz_payload.get('prompt') or '',
                'options':quiz_payload.get('options')} if row['quiz_question_type'] else None)
            if quiz is not None and ans is not None:quiz.update({'answerKey':quiz_payload.get('answer'), 'explanation':quiz_payload.get('explanation')})
            ref={'module':row['ref_module'] or '', 'contentType':row['ref_content_type'] or '',
                'sourceRef':row['ref_source_ref'],'versionId':str(row['ref_content_version_id']) if row['ref_content_version_id'] else None} if row['ref_source_ref'] else None
            block={'blockId':str(row['id']),'position':row['position'],'type':row['type'], 'text':row['text_content'],
                'url':row['link_url'],'objectKey':row['object_key'],'ref':ref,'quiz':quiz,
                'referenceProblem':None,'response':({'answer':ans['answer'],'correct':ans['correct'],
                 'answeredAt':row_to_dict({'answeredAt':ans['answered_at']})['answeredAt']} if ans else None)}
            if row['type']=='content_reference' and all([row['ref_module'],row['ref_content_type'],row['ref_source_ref']]):
                if row['ref_content_version_id']:
                    version=await con.fetchrow('SELECT id,status,content_snapshot FROM content_versions WHERE id=$1',row['ref_content_version_id'])
                else:
                    version=await con.fetchrow('''SELECT id,status,content_snapshot FROM content_versions
                      WHERE module=$1 AND content_type=$2 AND source_ref=$3 ORDER BY version_no DESC LIMIT 1''',
                      row['ref_module'],row['ref_content_type'],row['ref_source_ref'])
                if not version or version['status']!='published':block['referenceProblem']='The referenced content is not published.'
                else:block['referenced']={'module':row['ref_module'],'contentType':row['ref_content_type'],
                    'sourceRef':row['ref_source_ref'],'versionId':str(version['id']),'content':version['content_snapshot']}
            blocks.append(block)
        progress=await con.fetchrow('''SELECT state,completed_at AS "completedAt" FROM lesson_progress
                         WHERE lesson_id=$1 AND user_id=$2''',lesson['id'],user['id'])
    return core.j({'lesson':{'id':str(lesson['id']),'title':lesson['title'],'summary':lesson['summary'],
            'estimatedMinutes':lesson['estimated_minutes']},'blocks':blocks,'progress':row_to_dict(progress) if progress else None})


@router.post('/api/lessons/blocks/{blockId}/answer')
async def answer_lesson(req:Request,blockId:str):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    body=await core.payload(req)
    answer=body.get('answer') if isinstance(body,dict) else None
    if not isinstance(answer,str) or not 1<=len(answer)<=500:return core.j({'error':'invalid_input'},400)
    if not core.uuid_value(blockId):return core.j({'error':'block_not_found'},404)
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            block=await con.fetchrow('SELECT * FROM lesson_blocks WHERE id=$1 FOR UPDATE',core.uuid_value(blockId))
            if not block:return core.j({'error':'block_not_found'},404)
            if block['type']!='quiz' or not block['quiz_question_type'] or not block['quiz_payload']:
                return core.j({'error':'not_a_quiz'},409)
            lesson=await con.fetchrow('SELECT publication_state,publish_at FROM lessons WHERE id=$1',block['lesson_id'])
            if not lesson or not live(lesson):return core.j({'error':'lesson_not_live'},409)
            question=block['quiz_payload']
            score=grade(block['quiz_question_type'],answer,question)
            if score is None:return core.j({'error':'unknown_question_type'},409)
            await con.execute('''INSERT INTO lesson_block_responses(user_id,lesson_id,block_id,answer,correct,answered_at,updated_at)
             VALUES($1,$2,$3,jsonb_build_object('value',$4::text),$5,NOW(),NOW())
             ON CONFLICT(user_id,block_id) DO UPDATE SET answer=excluded.answer,correct=excluded.correct,
                 answered_at=excluded.answered_at,updated_at=excluded.updated_at''',user['id'],block['lesson_id'],block['id'],answer,score)
    return core.j({'ok':True,'correct':score,'correctAnswer':question.get('answer') if score and isinstance(question.get('answer'),str) else None})


def install():core.app.include_router(router)
