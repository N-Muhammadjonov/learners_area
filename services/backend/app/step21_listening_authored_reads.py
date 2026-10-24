"""Original Listening authored runtime and checkpoint hydration GET endpoints.

External versioned source.html files are NOT supplied in the original backend
archive. The renderer therefore follows the original's error path (503) if a
legacy native runtime is requested without those assets. No HTML is fabricated.
"""
from __future__ import annotations
import json
from pathlib import Path
from fastapi import APIRouter,Request
from . import main as core
from .step17_listening_start_port import test_detail
from .step17_listening_course_port import (CATALOGUE,SPEC,COURSE_KEY,ORIGINAL1,course_status,current_work,read_work,
                                            runtime_source,state_key)
from .step21_vocab_batch import normalize_term,normalize_pos,sense_key
router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}
AUTHOR_HEADERS={**PRIVATE,'X-Content-Type-Options':'nosniff'}

async def get_context(con,user,testid):
    detail=await test_detail(con,user,testid,requires_package=True)
    if detail=='sequence_locked':return None,core.j({'error':'sequence_locked'},403,PRIVATE)
    if not detail:return None,core.j({'error':'not_found'},404,PRIVATE)
    pkg=dict(detail[1]);payload=pkg.get('payload') or {}
    if isinstance(payload,str):payload=json.loads(payload)
    return {**pkg,'payload':payload},None

async def vocabulary_session(con,testid,items):
    # Preserve curated package order; mapping is exact by POS and sense definition.
    result=[]
    for item in items if isinstance(items,list) else []:
        if not isinstance(item,dict):continue
        term=item.get('word','');pos=item.get('pos','');meaning=item.get('def','')
        sense=await con.fetchrow('''SELECT * FROM lexemes WHERE sense_key=$1 OR
             (lower(term)=$2 AND lower(coalesce(part_of_speech,''))=$3 AND lower(definition_en)=$4)
             ORDER BY CASE WHEN sense_key=$1 THEN 0 ELSE 1 END LIMIT 1''',
             sense_key({'term':term,'partOfSpeech':pos,'definitionEn':meaning}),normalize_term(term),normalize_pos(pos),meaning.lower())
        lex=dict(sense) if sense else None
        unit=None;occ=None;ipa=None
        if lex:
            if lex.get('lexical_unit_id'):
                unit=await con.fetchrow('SELECT lexical_type FROM lexical_units WHERE id=$1',lex['lexical_unit_id'])
                p=await con.fetchrow('SELECT ipa FROM lexical_unit_pronunciations WHERE lexical_unit_id=$1 LIMIT 1',lex['lexical_unit_id'])
                ipa=p['ipa'] if p else None
            o=await con.fetchrow('''SELECT id FROM lexical_occurrences WHERE listening_test_id=$1 AND lexeme_id=$2
               AND resolution_status='resolved' ORDER BY section_number,start_char LIMIT 1''',core.uuid_value(testid),lex['id'])
            occ=str(o['id']) if o else None
        result.append({'senseId':str(lex['id']) if lex else None,'occurrenceId':occ,
                       'term':lex['term'] if lex else term,'partOfSpeech':lex['part_of_speech'] if lex else pos or None,
                       'definitionEn':lex['definition_en'] if lex else meaning,
                       'translationUz':lex['translation_uz'] if lex else item.get('uz') or None,
                       'lexicalType':unit['lexical_type'] if unit else None,'ipa':ipa,
                       'example':item.get('ex'), 'also':item.get('also',[]),'quiz':item.get('quiz')})
    return result

@router.get('/api/listening/full/{id}/authored')
async def authored(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401,AUTHOR_HEADERS)
    if not core.uuid_value(id):return core.j({'error':'not_found'},404,AUTHOR_HEADERS)
    try:
        db=await core.pool()
        async with db.acquire() as con:
            pkg,err=await get_context(con,user,id)
            if err:return err
            content=pkg['payload'];source=pkg['source_id']
            from .preview_contract import current_preview
            if current_preview.get():
                runtime=content.get('authoredRuntime')
                if not runtime:return core.j({'error':'not_found'},404,AUTHOR_HEADERS)
                vocabulary=[]
                try:vocabulary=await vocabulary_session(con,id,content.get('vocabulary',[]))
                except Exception:pass
                audio=content.get('audio') or {}
                audio_key=pkg.get('audio_object_key')
                image_key=pkg.get('image_object_key')
                return core.j({'runtime':runtime,'audioUrl':f'/api/resources/{audio_key}' if audio_key else None,
                    'audioPath':audio.get('path'),'imageUrl':f'/api/resources/{image_key}' if image_key else None,
                    'imagePath':content.get('imagePath'),'vocabulary':vocabulary},headers=AUTHOR_HEADERS)
            if req.query_params.get('vocabulary')=='1':
                return core.j({'vocabulary':await vocabulary_session(con,id,content.get('vocabulary',[]))},headers=AUTHOR_HEADERS)
            original=(source in CATALOGUE or source=='listening-test-1' and id==ORIGINAL1)
            if original:
                # Source snapshots are external to the user-provided archive, so this
                # route must refuse rather than substitute a different HTML runtime.
                return core.j({'error':'temporarily_unavailable'},503,AUTHOR_HEADERS)
            runtime=content.get('authoredRuntime')
            if not runtime:return core.j({'error':'not_found'},404,AUTHOR_HEADERS)
            audio_key=pkg.get('audio_object_key')
            image_key=pkg.get('image_object_key')
            audio=content.get('audio') or {}
            out={'course':None,'runtime':runtime,'audioUrl':f'/api/resources/{audio_key}?download=1',
                 'nativePersistence':False,'additionalAudio':[],
                 'audioPath':audio.get('path'),'imageUrl':f'/api/resources/{image_key}?download=1' if image_key else None,
                 'imagePath':content.get('imagePath'),'vocabulary':[]}
            return core.j(out,headers=AUTHOR_HEADERS)
    except Exception:return core.j({'error':'temporarily_unavailable'},503,AUTHOR_HEADERS)

async def loaded_values(con,user,testid,source):
    row=await con.fetchrow('''SELECT values FROM listening_authored_checkpoints WHERE user_id=$1 AND test_id=$2''',user['id'],core.uuid_value(testid))
    if row:
        values=row['values']
        return json.loads(values) if isinstance(values,str) else dict(values)
    # Original state getter hydrates from an existing canonical native attempt.
    attempt=await con.fetchrow('''SELECT * FROM listening_attempts WHERE user_id=$1 AND test_id=$2 ORDER BY started_at DESC LIMIT 1''',user['id'],core.uuid_value(testid))
    if not attempt:return {}
    questions=await con.fetch('''SELECT id,"order" FROM listening_questions WHERE test_id=$1 ORDER BY "order"''',core.uuid_value(testid))
    draft=await con.fetchrow('SELECT answers,audio_position FROM listening_drafts WHERE attempt_id=$1',attempt['id'])
    saved=await con.fetch('SELECT question_id,user_answer,is_correct FROM listening_answers WHERE attempt_id=$1',attempt['id'])
    d=(json.loads(draft['answers']) if isinstance(draft['answers'],str) else draft['answers']) if draft else {}
    answer_index={str(r['question_id']):dict(r) for r in saved}
    answers={str(q['order']): (d.get(str(q['id']),d.get(q['id'],'')) if attempt['status']=='in_progress' else (answer_index.get(str(q['id']),{}).get('user_answer') or '')) for q in questions}
    complete=attempt['status']=='completed'
    state={'answers':answers,'attemptStatus':'in_progress' if attempt['status']=='in_progress' else 'submitted',
         'submitted':complete,'attemptKey':str(attempt['id']),
         'audioPosition':draft['audio_position'] if draft else 0,
         'lastResults':[{'q':q['order'],'user':answer_index.get(str(q['id']),{}).get('user_answer') or '',
                         'ok':bool(answer_index.get(str(q['id']),{}).get('is_correct'))} for q in questions] if complete else []}
    values={state_key(source):json.dumps(state,separators=(',',':'))}
    await con.execute('''INSERT INTO listening_authored_checkpoints(user_id,test_id,values,attempt_id)
      VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(user_id,test_id) DO NOTHING''',user['id'],core.uuid_value(testid),json.dumps(values),attempt['id'])
    refreshed=await con.fetchrow('SELECT values FROM listening_authored_checkpoints WHERE user_id=$1 AND test_id=$2',user['id'],core.uuid_value(testid))
    return (json.loads(refreshed['values']) if isinstance(refreshed['values'],str) else dict(refreshed['values'])) if refreshed else values

@router.get('/api/listening/full/{id}/authored-state')
async def authored_state(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401,PRIVATE)
    if not core.uuid_value(id):return core.j({'error':'not_found'},404,PRIVATE)
    db=await core.pool()
    async with db.acquire() as con:
        pkg,err=await get_context(con,user,id)
        if err:return err
        source=pkg['source_id']
        if not runtime_source(id,source):return core.j({'error':'not_found'},404,PRIVATE)
        values=await loaded_values(con,user,id,source)
        work=await current_work(con,user['id'],id,source,values)
        course=course_status(SPEC[source],work) if source in SPEC else None
        return core.j({'values':{k:v for k,v in values.items() if k!=COURSE_KEY},'course':course},headers=PRIVATE)

def install():core.app.include_router(router)
