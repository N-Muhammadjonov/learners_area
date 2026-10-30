"""Central content publication state transitions, including Writing readiness
and the dedicated five-question MCQ-day publishing gate.
"""
from __future__ import annotations
import json,re
from datetime import datetime,timezone
from fastapi import APIRouter,Request
from . import main as core
from .writing_admin_content_port import words

router=APIRouter()
STATES={'draft','scheduled','published','archived'}
TRANSITIONS={'draft':{'scheduled','published','archived'},'scheduled':{'draft','published','archived'},
             'published':{'draft','scheduled','archived'},'archived':{'draft','published'}}
TYPES={
 'reading':('reading_passages','reading_passage'), 'listening':('listening_tests','listening_test'),
 'writing':('writing_prompts','writing_prompt'), 'speaking':('speaking_materials','speaking_material'),
 'speaking-prompt':('speaking_prompts','speaking_prompt'), 'video':('video_lessons','video_lesson'),
 'course':('courses','course'),
 'writing-lesson':('writing_lessons','writing_lesson'),
 'writing-translation':('writing_translation_sets','writing_translation'),
 'writing-model-text':('writing_model_texts','writing_model_text'),
 'writing-pattern':('writing_language_patterns','writing_pattern')}
WRITING={'writing':'prompt','writing-lesson':'lesson','writing-translation':'translation','writing-model-text':'model-text','writing-pattern':'pattern'}


def valid_date(v):
    if v is None:return True,None
    if not isinstance(v,str) or not re.search(r'(?:Z|[+-]\d{2}:\d{2})$',v):return False,None
    try:
        parsed=datetime.fromisoformat(v.replace('Z','+00:00'))
        if not parsed.tzinfo:return False,None
        return True,parsed.astimezone(timezone.utc)
    except ValueError:return False,None


def iso(v):return v.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z') if v else None

async def deleted(con,id):
    return bool(await con.fetchval('''SELECT EXISTS(SELECT 1 FROM activity_events
               WHERE id=md5('deleted-content:'||$1::text)::uuid AND type='CONTENT_DELETED')''',core.uuid_value(id)))

async def writing_issues(con,kind,id,row):
    blank=lambda v:not isinstance(v,str) or not v.strip()
    issues=[]
    if kind=='lesson':
        if blank(row['body']):issues.append('empty_body')
    elif kind=='prompt':
        if row['task_type']=='task1':
            visual=await con.fetchval('''SELECT id FROM resource_blocks
                  WHERE owner_type='writing' AND owner_id=$1 AND type='image' LIMIT 1''',core.uuid_value(id))
            if not visual:issues.append('task1_visual_missing')
    elif kind=='translation':
        sentences=await con.fetch('''SELECT position,uzbek_source,model_english FROM writing_translation_sentences
                        WHERE set_id=$1 ORDER BY position''',core.uuid_value(id))
        if not sentences:issues.append('no_sentences')
        if len({s['position'] for s in sentences})!=len(sentences):issues.append('duplicate_position')
        if any(blank(s['uzbek_source']) for s in sentences):issues.append('missing_uzbek')
        if any(blank(s['model_english']) for s in sentences):issues.append('missing_model')
        if blank(row['provenance']):issues.append('missing_provenance')
    elif kind=='model-text':
        if blank(row['body']):issues.append('empty_body')
        elif words(row['body'])<{'task1':150,'task2':250}.get(row['task_type'],250):issues.append('model_too_short')
        if blank(row['provenance']):issues.append('missing_provenance')
    else:
        if blank(row['example']):issues.append('missing_example')
        if blank(row['provenance']):issues.append('missing_provenance')
        if row['source_ref']:
            if not await con.fetchval('SELECT id FROM writing_model_texts WHERE id=$1',row['source_ref']):issues.append('unknown_source')
    return issues


def key_options(key,options,multi):
    import re
    if multi and key.strip().startswith('['):
        try:keys=json.loads(key)
        except ValueError:return None
    else:keys=re.split(r'\s*[,;|]\s*',key) if multi else [key]
    if not isinstance(keys,list) or any(not isinstance(x,str) for x in keys) or multi and len(keys)<2:return None
    found=[]
    for value in keys:
        match=[x for x in options if x==value.strip() or re.sub(r'^[A-Z][).\s]+','',x)==value.strip() or
          (re.match(r'^([A-Z])[).\s]',x) and x[0]==value.strip())]
        if len(match)!=1 or match[0] in found:return None
        found.append(match[0])
    return found or None

async def listening_mcq_block(con,id):
    # This gate is active only for a programme day when the required schema is present.
    ready=await con.fetchval("SELECT to_regclass('public.listening_packages') IS NOT NULL AND to_regclass('public.listening_activity_runs') IS NOT NULL AND to_regclass('public.listening_drafts') IS NOT NULL")
    if not ready:return None
    row=await con.fetchrow('''SELECT program_ref,program_ordinal,audio_url FROM listening_tests WHERE id=$1''',core.uuid_value(id))
    if not row or row['program_ref']!='listening-mcq-program' or not isinstance(row['program_ordinal'],int) or row['program_ordinal']<1:return None
    version=await con.fetchrow('''SELECT id FROM content_versions WHERE target_type='listening_test'
            AND target_id=$1 AND status='published' ORDER BY version_no DESC LIMIT 1''',core.uuid_value(id))
    questions=[]
    if version:questions=await con.fetch('SELECT * FROM listening_questions WHERE test_id=$1 AND content_version_id=$2 ORDER BY "order"',core.uuid_value(id),version['id'])
    if not questions:questions=await con.fetch('SELECT * FROM listening_questions WHERE test_id=$1 AND content_version_id IS NULL ORDER BY "order"',core.uuid_value(id))
    if not questions:questions=await con.fetch('SELECT * FROM listening_questions WHERE test_id=$1 ORDER BY "order"',core.uuid_value(id))
    issues=[];broken=set();seen=set();seen_content={}
    if len(questions)!=5:issues.append(f'A published day has exactly 5 questions; this one has {len(questions)}.')
    for q in questions:
        n=q['order'];code=q['type_code'];options=q['options'] or []
        if isinstance(options,str):options=json.loads(options)
        if n in seen:issues.append(f'Question {n} appears twice in this day.');broken.add(n)
        seen.add(n)
        if code not in ('mcq_single','mcq_multi'):
            issues.append(f'Question {n} is not a multiple-choice question ({code or "no type stated"}); a day holds genuine MCQ only.');broken.add(n)
        usable=[v for v in options if isinstance(v,str) and v.strip()]
        if len(usable)<2:issues.append(f'Question {n} has {len(usable)} usable option(s); multiple choice needs at least two.');broken.add(n)
        key=q['correct_answer'] or ''
        if not key.strip():issues.append(f'Question {n} has no correct answer, so it could never be graded.');broken.add(n)
        if key.strip() and not key_options(key,options,code=='mcq_multi'):
            issues.append(f'Question {n} has an answer key that does not identify valid options.');broken.add(n)
        if len(set(options))!=len(options):issues.append(f'Question {n} repeats an option.');broken.add(n)
        prompt=(q['question_text'] or '').strip().lower()
        if prompt:
            sig=prompt+'\x00'+'\x01'.join(options)
            if sig in seen_content:issues.append(f'Question {n} repeats question {seen_content[sig]} in this day.');broken.add(n)
            else:seen_content[sig]=n
    if len(questions)==5 and sorted(seen)!=[1,2,3,4,5]:issues.append(f'A day is ordered 1…5; this one carries {", ".join(map(str,sorted(seen)))}.')
    pkg=await con.fetchrow('SELECT audio_object_key FROM listening_packages WHERE test_id=$1',core.uuid_value(id))
    if not (row['audio_url'] or '').strip() and not (pkg and pkg['audio_object_key']):issues.append('This day has no recording, so a learner would have nothing to listen to.')
    return {'error':'incomplete_mcq_day','required':5,'present':sum(q['order'] not in broken for q in questions),'issues':issues} if issues else None

@router.post('/api/admin/content/{type}/{id}/publication')
async def publication(req:Request,type:str,id:str):
    administrator=await core.current_user(req,active=True)
    if not administrator or administrator['role'] not in ('admin','owner'):return core.j({'error':'forbidden'},403)
    if not core.uuid_value(id) or type not in TYPES:return core.j({'error':'not_found'},404)
    db=await core.pool()
    async with db.acquire() as con:
        if await deleted(con,id):return core.j({'error':'not_found'},404)
        b=await core.payload(req)
        if not isinstance(b,dict) or not {'state'}<=set(b) or set(b)-{'state','publishAt'} or not isinstance(b['state'],str):return core.j({'error':'invalid_input'},400)
        valid,date=valid_date(b.get('publishAt'))
        if not valid:return core.j({'error':'invalid_input'},400)
        state=b['state']
        if state not in STATES:return core.j({'error':'invalid_state'},400)
        if type in WRITING:
            # Writing always runs the date/transition rules first, then its own readiness gate.
            if state=='scheduled' and not date:return core.j({'error':'missing_publish_at'},400)
            if state!='scheduled' and date:return core.j({'error':'unexpected_publish_at'},400)
        else:
            if state=='scheduled' and not date:return core.j({'error':'missing_publish_at'},400)
            if state!='scheduled' and date:return core.j({'error':'unexpected_publish_at'},400)
        if type=='listening' and state in ('published','scheduled'):
            guard=await listening_mcq_block(con,id)
            if guard:return core.j(guard,409)
            pkg=await con.fetchrow('SELECT payload FROM listening_packages WHERE test_id=$1',core.uuid_value(id))
            # The source publicationBlockers returns []: transcript completeness is a review
            # decision and never a publication blocker.
        table,label=TYPES[type]
        row=await con.fetchrow(f'SELECT * FROM {table} WHERE id=$1',core.uuid_value(id))
        if not row:return core.j({'error':'not_found'},404)
        from_state=row['publication_state'] if row['publication_state'] in STATES else 'published'
        if from_state==state:return core.j({'ok':True,'state':state,'publishAt':iso(row['publish_at']),'changed':False})
        if state not in TRANSITIONS[from_state]:
            return core.j({'error':'invalid_transition','from':from_state,'to':state},409) if type not in WRITING else core.j({'error':'invalid_transition'},409)
        if type in WRITING and state in ('published','scheduled'):
            issues=await writing_issues(con,WRITING[type],id,row)
            if issues:return core.j({'error':'not_ready','issues':issues},409)
        async with con.transaction():
            await con.execute(f'UPDATE {table} SET publication_state=$2,publish_at=$3 WHERE id=$1',core.uuid_value(id),state,date)
            await con.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
                  VALUES($1,'content.updated',$2,$3,$4::jsonb)''',administrator['id'],label,id,
                  json.dumps({'from':from_state,'to':state,'publishAt':iso(date),'live':state=='published' or state=='scheduled' and date<=datetime.now(timezone.utc)}))
        return core.j({'ok':True,'state':state,'publishAt':iso(date),'changed':True})

def install():core.app.include_router(router)
