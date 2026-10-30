"""Standalone admin authoring, topic scoring and dictionary action translated
from the matching route.ts and grammar/store service implementations.
"""
from __future__ import annotations
import json
import math
from fastapi import APIRouter, Request
from . import main as core

router=APIRouter()

async def active(req):
    u=await core.current_user(req,active=True)
    return (u,None) if u else (None,core.j({'error':'unauthenticated'},401))

def js_number(x):
    try:
        if x is None:return 0
        if isinstance(x,(dict,list)):return None
        n=float(x) if x!='' else 0
        return int(n) if math.isfinite(n) and int(n)==n else None
    except (ValueError,TypeError,OverflowError):return None

@router.post('/api/grammar/topics/{id}/submit')
async def submit_grammar_topic(req:Request,id:str):
    uid=core.uuid_value(id)
    if not uid:return core.j({'error':'not_found'},404)
    u,e=await active(req)
    if e:return e
    b=await core.payload(req)
    if (not isinstance(b,dict) or not isinstance(b.get('answers'),list) or any(not isinstance(x,dict)
      or not core.uuid_value(x.get('exerciseId')) or not isinstance(x.get('selectedOption'),str)
      or not x['selectedOption'] for x in b['answers'])):
        return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as con:
        exercises=await con.fetch('''SELECT id,correct_option,explanation FROM grammar_exercises
           WHERE topic_id=$1 AND (source_owner_user_id=$2 OR (source_owner_user_id IS NULL AND source_submission_id IS NULL))''',uid,u['id'])
        lookup={str(x['id']):x for x in exercises}
        if any(str(core.uuid_value(x['exerciseId'])) not in lookup for x in b['answers']):return core.j({'error':'not_found'},404)
        results=[]
        rows=[]
        for x in b['answers']:
            ex=lookup[str(core.uuid_value(x['exerciseId']))]
            good=x['selectedOption']==ex['correct_option']
            results.append({'exerciseId':str(ex['id']),'isCorrect':good,'correctOption':ex['correct_option'],'explanation':ex['explanation']})
            rows.append((u['id'],ex['id'],x['selectedOption'],good))
        if rows:
            async with con.transaction():
                await con.executemany('''INSERT INTO grammar_attempts (user_id,exercise_id,selected_option,is_correct)
                VALUES ($1,$2,$3,$4)''',rows)
                await con.execute('''INSERT INTO activity_events(user_id,type,payload) VALUES($1,'GRAMMAR_TOPIC_ATTEMPTED',$2::jsonb)''',u['id'],json.dumps({'topicId':id,'correct':sum(x['isCorrect'] for x in results),'total':len(results)}))
    return core.j({'ok':True,'results':results})

def install():core.app.include_router(router)
