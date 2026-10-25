"""Grammar bundle dry-run/import. Original rigid schema, advisory lock, audit hash."""
from __future__ import annotations
import hashlib
import json
import re
from fastapi import APIRouter, Request
from . import main as core
from .lesson_writing_port import js_length
router=APIRouter()

def sentence(v,mx=12000):return isinstance(v,str) and 3<=js_length(v.strip())<=mx
def bundle_valid(b):
    if not isinstance(b,dict) or set(b)-{'schemaVersion','provenance','topics'} or b.get('schemaVersion')!=1:return False
    if not isinstance(b.get('provenance'),str) or not 3<=js_length(b['provenance'].strip())<=500:return False
    ts=b.get('topics')
    if not isinstance(ts,list) or not 1<=len(ts)<=20:return False
    seen=set()
    for t in ts:
        if not isinstance(t,dict) or set(t)!={'skillArea','title','explanation','exercises'}:return False
        if t['skillArea'] not in ('writing','speaking') or not sentence(t['title'],200) or not sentence(t['explanation']):return False
        key=t['skillArea']+':'+t['title'].strip().lower()
        if key in seen:return False
        seen.add(key)
        ex=t['exercises']
        if not isinstance(ex,list) or not 1<=len(ex)<=100:return False
        for e in ex:
            if not isinstance(e,dict) or set(e)!={'promptText','options','correctOption','explanation','translatePromptUz','targetStructures','activationPrompt'}:return False
            if any(not sentence(e[k],1000 if k in ('translatePromptUz','activationPrompt') else 600 if k=='correctOption' else 12000) for k in ('promptText','correctOption','explanation','translatePromptUz','activationPrompt')):return False
            options=e['options'];structs=e['targetStructures']
            if not isinstance(options,list) or not 2<=len(options)<=6 or not all(sentence(v,600) for v in options):return False
            if not isinstance(structs,list) or not 1<=len(structs)<=10 or not all(sentence(v,100) for v in structs):return False
            if len(set(options))!=len(options) or e['correctOption'] not in options:return False
    return True

def trimmed(b):
    # Zod `.trim()` applies to authored strings; preserve object key insertion order.
    b=dict(b);b['provenance']=b['provenance'].strip();b['topics']=[dict(t) for t in b['topics']]
    for t in b['topics']:
        t['title']=t['title'].strip();t['explanation']=t['explanation'].strip()
        t['exercises']=[{k:([v.strip() for v in val] if isinstance(val,list) else val.strip() if isinstance(val,str) else val)
                for k,val in ex.items()} for ex in t['exercises']]
    return b

@router.post('/api/admin/grammar/import')
async def grammar_import(req:Request):
    actor=await core.current_user(req,active=True)
    if not actor or actor['role'] not in ('admin','owner'):return core.j({'error':'forbidden'},403)
    raw=await req.body()
    if len(raw)>500000:return core.j({'error':'invalid_input'},413)
    try:body=json.loads(raw or b'null')
    except (ValueError,UnicodeDecodeError):return core.j({'error':'invalid_input'},400)
    if not isinstance(body,dict) or set(body)-{'dryRun','bundle'} or not bundle_valid(body.get('bundle')) or ('dryRun' in body and type(body['dryRun']) is not bool):
        return core.j({'error':'invalid_input'},400)
    dry=body.get('dryRun',True)
    bundle=trimmed(body['bundle'])
    db=await core.pool()
    async with db.acquire() as conn:
        async with conn.transaction():
            await conn.execute('SELECT pg_advisory_xact_lock(73492760)')
            rows=await conn.fetch('SELECT title,skill_area,"order" FROM grammar_topics')
            existing={str(r['skill_area'])+':'+r['title'].lower() for r in rows}
            if any(t['skillArea']+':'+t['title'].lower() in existing for t in bundle['topics']):
                return core.j({'ok':False,'error':'conflict'},409,{'Cache-Control':'private, no-store'})
            total=sum(len(t['exercises']) for t in bundle['topics'])
            if dry:return core.j({'ok':True,'dryRun':True,'topics':len(bundle['topics']),'exercises':total},headers={'Cache-Control':'private, no-store'})
            order=max([0]+[int(r['order']) for r in rows]);
            for t in bundle['topics']:
                order+=1
                created=await conn.fetchrow('''INSERT INTO grammar_topics(skill_area,title,explanation,"order")
                    VALUES($1,$2,$3,$4) RETURNING id''',t['skillArea'],t['title'],t['explanation'],order)
                for i,e in enumerate(t['exercises'],1):
                    await conn.execute('''INSERT INTO grammar_exercises(topic_id,"order",prompt_text,options,
                       correct_option,explanation,translate_prompt_uz,target_structures,activation_prompt)
                       VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9)''',created['id'],i,e['promptText'],json.dumps(e['options']),
                       e['correctOption'],e['explanation'],e['translatePromptUz'],json.dumps(e['targetStructures']),e['activationPrompt'])
            digest=hashlib.sha256(json.dumps(bundle,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
            await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,metadata)
                VALUES($1,'grammar.bundle_imported','grammar',$2::jsonb)''',actor['id'],json.dumps({
                  'provenance':bundle['provenance'],'sha256':digest,'topics':len(bundle['topics']),'exercises':total}))
    return core.j({'ok':True,'dryRun':False,'topics':len(bundle['topics']),'exercises':total},headers={'Cache-Control':'private, no-store'})

def install():core.app.include_router(router)
