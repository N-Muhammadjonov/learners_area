"""Legacy Listening package review metadata (GET).  Inert: never runs HTML/JS.
POST conversion is intentionally NOT mounted until the canonical importer is ported.
"""
from __future__ import annotations
import json
from fastapi import APIRouter,Request
from . import main as core
router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}

def scan(p):
    runtime=p.get('authoredRuntime') if isinstance(p,dict) else None
    files=runtime.get('files') if isinstance(runtime,dict) else None
    paths=sorted(files.keys()) if isinstance(files,dict) else []
    questions=p.get('questions') if isinstance(p,dict) else []
    sections=p.get('sections') if isinstance(p,dict) else []
    base={'hasAuthoredRuntime':bool(runtime),'questions':len(questions) if isinstance(questions,list) else 0,
      'sections':len(sections) if isinstance(sections,list) else 0,
      'transcripts':sum(bool(isinstance(x,dict) and isinstance(x.get('transcript'),str) and x['transcript'].strip())
                        for x in sections) if isinstance(sections,list) else 0, 'runtimeFiles':paths}
    reasons=[]
    if (not isinstance(p,dict) or p.get('schemaVersion')!=1 or p.get('category')!='full' or
       not isinstance(p.get('testId'),str) or not isinstance(p.get('title'),str) or
       not isinstance(questions,list) or len(questions)>40 or
       not isinstance(sections,list) or not 1<=len(sections)<=4 or
       not isinstance(p.get('audio'),dict) or not isinstance(p.get('keyword1'),list) or
       not isinstance(p.get('keyword2'),list) or not isinstance(p.get('vocabulary'),list)):
        return {**base,'classification':'INVALID','reasons':['Invalid listening package structure.']}
    if runtime is not None and (not isinstance(runtime,dict) or not isinstance(files,dict)):
        return {**base,'classification':'INVALID','reasons':['Invalid authored runtime.']}
    if len(questions)==0 and not runtime:
        return {**base,'classification':'INVALID','reasons':['Canonical package contains no questions.']}
    if not runtime:
        return {**base,'classification':'CANONICAL_NATIVE','reasons':[]}
    reasons=['Package still carries an authored runtime (uploaded HTML/CSS/JS).']
    ep=runtime.get('entryPath')
    if not ep or ep not in files:reasons.append('The runtime entry document is missing from the package.')
    return {**base,'classification':'LEGACY_REQUIRES_REVIEW' if len(reasons)>1 else 'CONVERTIBLE_LEGACY',
      'reasons':reasons}

@router.get('/api/admin/listening/tests/{id}/convert')
async def get_converter(req:Request,id:str):
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    if u['role'] not in ('admin','owner'):return core.j({'error':'forbidden'},403)
    db=await core.pool()
    async with db.acquire() as con:
        ready=await con.fetchval("SELECT to_regclass('public.content_imports') IS NOT NULL")
        if not ready:return core.j({'error':'qa_migration_0040_required'},503)
        if not core.uuid_value(id):return core.j({'error':'not_found'},404)
        row=await con.fetchrow('SELECT payload FROM listening_packages WHERE test_id=$1',core.uuid_value(id))
    if not row:return core.j({'error':'not_found'},404)
    p=row['payload']
    if isinstance(p,str):
        try:p=json.loads(p)
        except ValueError:p=None
    result=scan(p)
    if result['classification']=='INVALID':
        return core.j({'classification':'INVALID','reasons':result['reasons'][:5]},headers=PRIVATE)
    return core.j({**result,'payload':p},headers=PRIVATE)

def install():core.app.include_router(router)
