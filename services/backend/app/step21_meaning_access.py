"""Vocabulary meaning, source-bound lexical authorization, no spelling-only inference."""
from __future__ import annotations
from datetime import datetime,timezone
from fastapi import APIRouter,Request
from . import main as core
from .db import PooledReads
from .rate_limit import async_counter as counter,RULES
from .step17_mcq_port import live,staff
from .step20_retention_transitions_port import phase
router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}
RULES.setdefault('vocabulary_search',(300,60))

async def reading_access(con,u,id):
    attempt=await con.fetchrow('SELECT id,passage_id,status FROM reading_attempts WHERE id=$1 AND user_id=$2',id,u['id'])
    passageid=attempt['passage_id'] if attempt else id
    passage=await con.fetchrow('SELECT id,publication_state,publish_at FROM reading_passages WHERE id=$1',passageid)
    if not passage:return 'not_found'
    if attempt:
        if attempt['status']!='completed':return 'locked'
        member=(passageid==attempt['passage_id']) or await con.fetchval('''SELECT EXISTS(SELECT 1 FROM reading_assessment_passages WHERE attempt_id=$1 AND passage_id=$2)''',attempt['id'],passageid)
        active=await con.fetchval('''SELECT EXISTS(SELECT 1 FROM reading_attempts a
          WHERE a.user_id=$1 AND a.status='in_progress' AND (a.passage_id=$2 OR EXISTS
            (SELECT 1 FROM reading_assessment_passages m WHERE m.attempt_id=a.id AND m.passage_id=$2)))''',u['id'],passageid)
        return 'allowed' if not active and member else 'locked'
    general=await con.fetchrow('''SELECT s.publication_state,s.publish_at FROM general_reading_passages g
      JOIN general_reading_sets s ON s.id=g.set_id WHERE g.passage_id=$1 AND g.reading_mode='general_practice'
      AND NOT EXISTS(SELECT 1 FROM activity_events a WHERE a.id=md5('deleted-content:' || s.id::text)::uuid AND a.type='CONTENT_DELETED') LIMIT 1''',passageid)
    if general:
        if not live(passage) and not staff(u):return 'not_found'
        return 'allowed' if live(general) or staff(u) else 'locked'
    if not live(passage):return 'not_found'
    active=await con.fetchval('''SELECT EXISTS(SELECT 1 FROM reading_attempts a
        WHERE a.user_id=$1 AND a.status='in_progress' AND (a.passage_id=$2 OR EXISTS
          (SELECT 1 FROM reading_assessment_passages m WHERE m.attempt_id=a.id AND m.passage_id=$2)))''',u['id'],passageid)
    if active:return 'locked'
    submitted=await con.fetchval('''SELECT EXISTS(SELECT 1 FROM reading_attempts a
        WHERE a.user_id=$1 AND a.passage_id=$2 AND a.status='completed')''',u['id'],passageid)
    return 'allowed' if submitted else 'locked'

async def listening_access(con,u,id):
    test=await con.fetchrow('''SELECT t.id,t.publication_state,t.publish_at,t.program_ref,p.payload,p.source_id
     FROM listening_tests t JOIN listening_packages p ON p.test_id=t.id WHERE t.id=$1''',id)
    if not test or not (staff(u) or live(test)):return 'not_found'
    # General Listening is independent practice; all other products close lookup during an exam.
    p=test['payload'] or {}
    if isinstance(p,str):
        import json
        p=json.loads(p)
    collection=p.get('collection')
    programme=bool(p.get('programme') or test['program_ref'])
    general=collection=='general' and not programme
    if general:return 'allowed'
    active=await con.fetchval('''SELECT EXISTS(SELECT 1 FROM listening_attempts
        WHERE user_id=$1 AND test_id=$2 AND status='in_progress')''',u['id'],id)
    return 'locked' if active else 'allowed'

async def text_access(con,u,type,id):
    if type=='reading':return await reading_access(con,u,id)
    if type=='listening':return await listening_access(con,u,id)
    if type=='retention':
        r=await con.fetchrow('SELECT * FROM retention_attempts WHERE id=$1 AND user_id=$2',id,u['id'])
        if not r or not r['retention_text_version_id']:return 'not_found'
        return 'allowed' if phase(r,datetime.now(timezone.utc))=='reading' else 'locked'
    return 'not_found'

@router.get('/api/vocabulary/meaning')
async def meaning(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401,PRIVATE)
    source=req.query_params.get('sourceType','listening'); id=req.query_params.get('sourceId','')
    term=req.query_params.get('q','').strip()
    if not core.uuid_value(id) or source not in ('reading','listening','retention') or not term or len(term)>80:
        return core.j({'error':'invalid_input'},400,PRIVATE)
    delay=await counter('vocabulary_search','text-dictionary:'+str(user['id']),consume=True)
    if delay:return core.j({'error':'rate_limited'},429,{**PRIVATE,'Retry-After':str(delay)})
    try:
        db=await core.pool()
        async with db.acquire() as con:access=await text_access(con,user,source,core.uuid_value(id))
        if access!='allowed':return core.j({'error':'lexical_assistance_locked' if access=='locked' else 'source_not_found'},403 if access=='locked' else 404,PRIVATE)
        if source=='retention':
            try:start=int(req.query_params['startChar']);end=int(req.query_params['endChar'])
            except (KeyError,ValueError):return core.j({'error':'invalid_input'},400,PRIVATE)
            from .retention_meaning import lookup
            result=await lookup(PooledReads(db),user,core.uuid_value(id),term,start,end)
            async with db.acquire() as con:access=await text_access(con,user,source,core.uuid_value(id))
            if access!='allowed':return core.j({'error':'lexical_assistance_locked'},403,PRIVATE)
            if result is None:return core.j({'error':'source_not_found'},404,PRIVATE)
            return core.j({'status':'resolved' if result.get('contextual') else 'unresolved','known':None,**result},headers=PRIVATE)
        try:
            start=int(req.query_params['startChar'])
            end=int(req.query_params['endChar'])
        except (KeyError,ValueError):
            return core.j({'error':'invalid_input'},400,PRIVATE)
        section=req.query_params.get('section')
        async with db.acquire() as con:
            if source=='reading':
                passage=await con.fetchrow('SELECT body_text FROM reading_passages WHERE id=$1',core.uuid_value(id))
                body=passage['body_text'] if passage else None
            else:
                import json
                record=await con.fetchrow('SELECT payload FROM listening_packages WHERE test_id=$1',core.uuid_value(id))
                package=record['payload'] if record else {}
                if isinstance(package,str):package=json.loads(package)
                parts=package.get('sections',[]) if isinstance(package,dict) else []
                try:part=int(section or '0')
                except ValueError:part=0
                body=parts[part-1].get('transcript') if 1<=part<=len(parts) and isinstance(parts[part-1],dict) else None
            if not isinstance(body,str):
                return core.j({'status':'unresolved','contextual':None,'known':None},headers=PRIVATE)
            from .retention_meaning import lookup_source_text
            result=await lookup_source_text(con,user,body,term,start,end)
            if result is None:return core.j({'status':'unresolved','contextual':None,'known':None},headers=PRIVATE)
            return core.j({'status':'resolved' if result.get('contextual') else 'unresolved',
                           'known':None,**result},headers=PRIVATE)
    except Exception:return core.j({'error':'temporarily_unavailable'},503,PRIVATE)

def install():core.app.include_router(router)
