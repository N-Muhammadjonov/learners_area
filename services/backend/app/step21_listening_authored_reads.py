"""Main-compatible Listening runtimes and checkpoint hydration GET endpoints."""
from __future__ import annotations
import json
from pathlib import Path
from fastapi import APIRouter,Request
from . import main as core
from .step17_listening_start_port import test_detail
from .step17_listening_course_port import (CATALOGUE,SPEC,COURSE_KEY,ORIGINAL1,course_status,current_work,read_work,
                                            runtime_source,state_key)
from .step21_vocab_batch import normalize_term,normalize_pos,sense_key,legacy_sense_key
from .step30_video_lexical import is_function
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
    # One indexed candidate read resolves all curated entries; preserve authored
    # order and duplicate indexes. No user-specific cache crosses requests.
    items=items if isinstance(items,list) else []
    candidates=[];keys=set();terms=set()
    for item in items:
        data={'term':item['word'],'partOfSpeech':item['pos'],'definitionEn':item['def']}
        key=sense_key(data);legacy=legacy_sense_key(data)
        candidates.append((item,key))
        if not is_function(item['word']):
            keys.update((key,legacy));terms.update((item['word'].strip(),item['word'].strip().lower()))
    rows=await con.fetch("""SELECT l.*,u.lexical_type AS unit_type,p.ipa AS unit_ipa,o.id AS occurrence_id
        FROM lexemes l LEFT JOIN lexical_units u ON u.id=l.lexical_unit_id
        LEFT JOIN LATERAL (SELECT ipa FROM lexical_unit_pronunciations WHERE lexical_unit_id=u.id LIMIT 1) p ON true
        LEFT JOIN LATERAL (SELECT id FROM lexical_occurrences WHERE listening_test_id=$3 AND lexeme_id=l.id
            AND resolution_status='resolved' ORDER BY section_number,start_char LIMIT 1) o ON true
        WHERE l.sense_key=ANY($1::text[]) OR l.term=ANY($2::text[]) ORDER BY l.ctid""",list(keys),list(terms),core.uuid_value(testid)) if keys else []
    result=[]
    for item,key in candidates:
        lex=None
        if not is_function(item['word']):
            legacy=legacy_sense_key({'term':item['word'],'partOfSpeech':item['pos'],'definitionEn':item['def']})
            allowed={key,legacy};names={item['word'].strip(),item['word'].strip().lower()}
            lex=next((row for row in rows if (row['sense_key'] in allowed or row['term'] in names) and
                (row['sense_key']==key or sense_key({'term':row['term'],'partOfSpeech':row['part_of_speech'],'definitionEn':row['definition_en']})==key)),None)
        presentation={target:item[source] for source,target in [('ex','example'),('also','also'),('quiz','quiz')] if source in item}
        result.append({'senseId':str(lex['id']) if lex else None,'occurrenceId':str(lex['occurrence_id']) if lex and lex['occurrence_id'] else None,
            'term':lex['term'] if lex else item['word'],'partOfSpeech':lex['part_of_speech'] if lex else item['pos'] or None,
            'definitionEn':lex['definition_en'] if lex else item['def'],'translationUz':lex['translation_uz'] if lex else item['uz'] or None,
            'lexicalType':lex['unit_type'] if lex else None,'ipa':lex['unit_ipa'] if lex else None,**presentation})
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
            # Lightweight, read-only metadata for bounded listing-page media warmup.
            # get_context already enforces active identity, published test and sequence lock.
            # Never return media metadata for locked tests or expose R2 public URLs.
            if req.query_params.get('warmup')=='1':
                key=pkg.get('audio_object_key')
                if not isinstance(key,str) or not key.startswith('listening/') or not key.lower().endswith(('.mp3','.m4a','.wav','.aac','.ogg','.opus')):
                    return core.j({'error':'not_found'},404,AUTHOR_HEADERS)
                out={'audioUrl':f'/api/resources/{key}?download=1'}
                from .step20_media_port import media_conf,create_capability,media_url
                secret=media_conf()
                if secret:
                    authority=await core.current_authority(req)
                    if not authority:return core.j({'error':'unauthenticated'},401,AUTHOR_HEADERS)
                    token,claims=create_capability(secret,user['id'],authority['authVersion'],authority['sessionKey'],authority['expiresAt'],key)
                    out.update(downloadUrl=media_url(key,token),expiresAt=claims['exp']*1000)
                return core.j(out,headers=AUTHOR_HEADERS)
            if req.query_params.get('vocabulary')=='1':
                from .listening_review_access import exam_gate
                required,active_attempt=await exam_gate(con,user,core.uuid_value(id))
                if active_attempt:return core.j({'error':'exam_in_progress'},409,AUTHOR_HEADERS)
                return core.j({'vocabulary':await vocabulary_session(con,id,content.get('vocabulary',[]))},headers=AUTHOR_HEADERS)
            from .listening_review_access import exam_gate
            required,active_attempt=await exam_gate(con,user,core.uuid_value(id))
            if required:
                # Static presentation only: original cards may render before the
                # answer-bearing source document or any review data is released.
                activities=SPEC.get(source,{}).get('activities',{})
                from .listening_exam_visuals import original_entry_layout
                original_layout=original_entry_layout(source)
                return core.j({'kind':'exam_required','testId':id,'title':content.get('title') or 'Listening',
                               'attemptId':active_attempt,'activities':list(activities),
                               **({'originalLayout':original_layout} if original_layout else {})},headers=AUTHOR_HEADERS)
            original=(source in CATALOGUE or source=='listening-test-1' and id==ORIGINAL1)
            definition=CATALOGUE.get(source) if original else None
            if original:
                from .listening_runtime import runtime as native_runtime
                if source=='listening-test-1':
                    definition={'number':1,'storageKey':'la_listening_test_1_v2','media':[{'path':'audio/full.mp3','objectKey':'listening/academic/test-01/full.mp3','contentType':'audio/mpeg'}]}
                runtime=native_runtime(definition['number'])
            else:runtime=content.get('authoredRuntime')
            if not runtime:return core.j({'error':'not_found'},404,AUTHOR_HEADERS)
            audio_key=pkg.get('audio_object_key')
            image_key=pkg.get('image_object_key')
            audio=content.get('audio') or {}
            out={'course':None,'runtime':runtime,'audioUrl':f'/api/resources/{audio_key}?download=1',
                 'nativePersistence':original,'additionalAudio':[{'path':m['path'],'url':f'/api/resources/{m["objectKey"]}?download=1'} for m in definition['media'][1:] if m['contentType'].startswith('audio/')] if definition else [],
                 'imageUrl':f'/api/resources/{image_key}?download=1' if image_key else None,'vocabulary':[]}
            # Test-local meanings are authored into this specific package by
            # migration 0102. Never perform a dictionary lookup at display time.
            from .js_text import slice as js_slice, length as js_length
            import re
            sections=content.get('sections',[])
            entries=content.get('contextualMeanings',[])
            if not isinstance(entries,list):entries=[]
            name_spans={}
            for index, section in enumerate(sections,1):
                transcript=section.get('transcript','') if isinstance(section,dict) else ''
                named_entities=re.finditer(
                    r'\b[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+)+\b',transcript
                )
                speaker_labels=re.finditer(
                    r'(?m)^[ \t]*([A-Za-z][A-Za-z \t]{0,38}):',
                    transcript
                )
                name_spans[index]=[
                    (js_length(transcript[:m.start()]),js_length(transcript[:m.end()]))
                    for m in named_entities
                ]+[
                    (js_length(transcript[:m.start(1)]),js_length(transcript[:m.end(1)]))
                    for m in speaker_labels
                ]
            spans=[]
            for row in entries:
                if not isinstance(row,dict):continue
                part=row.get('part');start=row.get('start');end=row.get('end')
                surface=row.get('surface');occurrence=row.get('occurrenceId')
                sense_definition=row.get('definitionEn');translation=row.get('translationUz')
                if (type(part) is not int or not 1<=part<=len(sections) or
                    type(start) is not int or type(end) is not int or
                    not isinstance(surface,str) or not isinstance(occurrence,str) or
                    not isinstance(sense_definition,str) or not sense_definition.strip() or
                    not isinstance(translation,str) or not translation.strip()):
                    continue
                transcript=sections[part-1].get('transcript','')
                if (not isinstance(transcript,str) or not 0<=start<end<=js_length(transcript)
                    or js_slice(transcript,start,end)!=surface):
                    continue
                if any(start<name_end and end>name_start
                       for name_start,name_end in name_spans.get(part,())):
                    continue
                spans.append({'part':part,'start':start,'end':end,
                    'surface':surface,'occurrenceId':occurrence,
                    'definitionEn':sense_definition,'translationUz':translation,
                    'partOfSpeech':row.get('partOfSpeech')})
            out['contextualOccurrences']=spans
            suffix=source.rsplit('-',1)[-1]
            out['testTitle']='Listening Test '+str(int(suffix)) if suffix.isdigit() else 'Listening Test'
            if definition:out['storageKey']=definition['storageKey']
            if definition and definition['media']:out['audioPath']=definition['media'][0]['path']
            elif 'path' in audio:out['audioPath']=audio['path']
            if 'imagePath' in content:out['imagePath']=content['imagePath']
            return core.j(out,headers=AUTHOR_HEADERS)
    except Exception:return core.j({'error':'temporarily_unavailable'},503,AUTHOR_HEADERS)

async def _recover_linked_completed_attempt(con,user,testid,source,values,attempt_id):
    """Recover a completed native attempt when an older browser checkpoint was
    left in_progress. A read never writes or adopts a different attempt."""
    key=state_key(source)
    try:state=json.loads(values.get(key,'{}'))
    except (ValueError,TypeError):return values
    if not isinstance(state,dict) or state.get('attemptStatus') not in ('in_progress','exited') or not attempt_id:
        return values
    latest=await con.fetchrow('''SELECT * FROM listening_attempts WHERE user_id=$1 AND test_id=$2
        ORDER BY started_at DESC LIMIT 1''',user['id'],core.uuid_value(testid))
    if not latest or str(latest['id'])!=str(attempt_id) or latest['status']!='completed':
        return values
    from .step22_listening_submit import assigned_questions
    questions=await assigned_questions(con,latest)
    if len(questions)!=40:return values
    saved=await con.fetch('''SELECT question_id,user_answer,is_correct FROM listening_answers
        WHERE attempt_id=$1''',latest['id'])
    indexed={str(r['question_id']):r for r in saved}
    if len(saved)!=40 or len(indexed)!=40 or any(str(q['id']) not in indexed or
        not isinstance(indexed[str(q['id'])]['is_correct'],bool) for q in questions):
        return values
    answers={str(q['order']):indexed[str(q['id'])]['user_answer'] or '' for q in questions}
    results=[{'q':q['order'],'user':answers[str(q['order'])],
              'ok':indexed[str(q['id'])]['is_correct']} for q in questions]
    recovered={**state,'answers':answers,'attemptStatus':'submitted',
               'submitted':True,'lastResults':results}
    return {**values,key:json.dumps(recovered,ensure_ascii=False,separators=(',',':'))}

async def loaded_values(con,user,testid,source):
    row=await con.fetchrow('''SELECT values,attempt_id FROM listening_authored_checkpoints WHERE user_id=$1 AND test_id=$2''',user['id'],core.uuid_value(testid))
    if row:
        values=row['values']
        values=json.loads(values) if isinstance(values,str) else dict(values)
        return await _recover_linked_completed_attempt(con,user,testid,source,values,row['attempt_id'])
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
