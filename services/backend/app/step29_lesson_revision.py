"""POST lesson revision: immutable, idempotent authoring from published snapshot.

Source: api/admin/content/lessons/[id]/revision/route.ts,
lib/content/lesson-edit.ts, content/lessons.ts, and authoring.ts.
"""
from __future__ import annotations
import json,re
from pathlib import Path
from datetime import datetime,timezone
from fastapi import APIRouter, Request
from . import main as core
from .step20_lesson_editor_port import from_row,from_snapshot,revision_ref,area
from .step25_content_version import pin
from .step25_content_version import encoded

router=APIRouter()
QUESTION_TYPES={m['id']:m for m in json.loads((Path(__file__).parent/'lesson_question_models.json').read_text())}
BLOCK_TYPES={'text','link','image','audio','video','file','quiz','content_reference'}
SOURCE_RE=re.compile(r'^[a-z0-9._-]+$')
HTTPS=re.compile(r'^https://[^\s]+$',re.I)

# The source `lesson-edit-shape.ts` transform is deliberately explicit. Unused fields
# cannot enter persisted snapshots as they never enter the TypeScript payload.
def payload_block(b):
    kind=b.get('type'); quiz=b.get('quiz') or {}; ref=b.get('ref')
    if kind=='text':return {'type':'text','text':b.get('text') or ''}
    if kind=='link':return {'type':'link','text':b.get('text'),'url':b.get('url') or ''}
    if kind in ('image','audio','video','file'):
        return {**{'type':kind},**{k:b.get(k) for k in ('objectKey','originalName','mimeType','size')}}
    if kind=='quiz':return {'type':'quiz','quiz':{'questionType':quiz.get('questionType') or 'mcq_single','prompt':quiz.get('prompt') or '',
               'options':quiz.get('options'),'answer':quiz.get('answer') if isinstance(quiz.get('answer'),str) else '',
               'explanation':quiz.get('explanation')}}
    if kind=='content_reference':return {'type':'content_reference','ref':ref if ref else None}
    return {'type':kind}

def issue(code,message,field=None,position=None):
    v={'code':code,'message':message}
    if field is not None:v['field']=field
    if position is not None:v['position']=position
    return v

def validate_blocks(blocks):
    problems=[]
    for idx,b in enumerate(blocks):
        pos=idx+1;typ=b['type']
        if typ not in BLOCK_TYPES:
            problems.append(issue('unknown_block_type',f'Unknown block type "{typ}".','type',pos));continue
        if typ=='text':
            val=b.get('text') or ''
            if not val.strip():problems.append(issue('missing_text','A text block needs text.','text',pos))
            elif len(val)>20000:problems.append(issue('text_too_long','Text blocks are limited to 20000 characters.','text',pos))
        elif typ=='link':
            url=(b.get('url') or '').strip()
            if not url:problems.append(issue('missing_url','A link block needs a URL.','url',pos))
            elif not HTTPS.fullmatch(url):problems.append(issue('insecure_url','Links must be absolute https URLs (no javascript:, data: or relative targets).','url',pos))
        elif typ in ('image','audio','video','file'):
            if not (b.get('objectKey') or '').strip():problems.append(issue('missing_object_key',f'A {typ} block needs an uploaded object; media is served from private storage, not from a URL.','objectKey',pos))
        elif typ=='quiz':
            quiz=b.get('quiz');qt=(quiz or {}).get('questionType') or ''
            if not quiz or not (quiz.get('prompt') or '').strip():problems.append(issue('missing_prompt','A quiz block needs a prompt.','quiz.prompt',pos))
            if not qt.strip():problems.append(issue('missing_question_type','A quiz block must name a canonical question type.','quiz.questionType',pos));continue
            descriptor=QUESTION_TYPES.get(qt)
            if not descriptor:problems.append(issue('unknown_question_type',f'Unknown question type "{qt}".','quiz.questionType',pos));continue
            if len(quiz.get('prompt') or '')>2000:problems.append(issue('prompt_too_long','Prompts are limited to 2000 characters.','quiz.prompt',pos))
            model=descriptor['answerModel'];label=descriptor['label'];kind=model['kind']; key=(quiz.get('answer') or '').strip();options=quiz.get('options') or []
            if kind=='ternary':
                if key.upper() not in model['choices']:problems.append(issue('invalid_key',f'{label}: the key must be one of {", ".join(model["choices"])}.','quiz.answer',pos))
                if options:problems.append(issue('options_not_allowed',f'{label} draws its choices from the type, not from the row.','quiz.answer',pos))
            elif kind=='choice':
                if not model['min']<=len(options)<=model['max']:
                    problems.append(issue('option_count',f'{label} needs between {model["min"]} and {model["max"]} options (found {len(options)}).','quiz.answer',pos))
                if options and key and not (key.lower() in {str(x).lower() for x in options} or re.fullmatch('[a-h]',key,re.I)):
                    problems.append(issue('key_not_an_option',f'{label}: the key "{key}" is not one of the options.','quiz.answer',pos))
            elif kind=='choice_multi':
                if len(options)<model['count']*2:problems.append(issue('option_count',f'{label} needs more options than answers (found {len(options)}).','quiz.answer',pos))
            elif kind=='labels':
                if model['poolRequired'] and not options:problems.append(issue('pool_required',f'{label} needs a shared option pool on its question group.','quiz.answer',pos))
                if not key:problems.append(issue('missing_key',f'{label}: the key is empty.','quiz.answer',pos))
            elif kind=='text':
                if not key:problems.append(issue('missing_key',f'{label}: the key is empty.','quiz.answer',pos))
                lim=model['wordLimit']
                if lim is not None and key and len(key.split())>lim:problems.append(issue('key_over_word_limit',f'{label}: the key "{key}" exceeds {lim} word(s).','quiz.answer',pos))
                if options:problems.append(issue('options_not_allowed',f'{label} does not present options.','quiz.answer',pos))
        elif typ=='content_reference':
            ref=b.get('ref')
            if not ref:problems.append(issue('missing_reference','A content reference needs a target.','ref',pos))
            elif not SOURCE_RE.fullmatch(ref.get('sourceRef') or ''):problems.append(issue('unstable_source_ref','A referenced source ref must be a stable slug.',f'blocks.{idx}.ref.sourceRef',pos))
    return problems

async def load(con,id):
    row=await con.fetchrow('''SELECT id,title,slug,unit_id,source_ref,learning_area,summary,teacher_notes,estimated_minutes,
        publication_state,publish_at FROM lessons WHERE id=$1''',id)
    if not row:return None,None,None
    revisions=await con.fetch('''SELECT id,title,version_no,status,publication_state,content_snapshot FROM content_versions
        WHERE module='lesson' AND content_type='lesson' AND source_ref=$1 ORDER BY version_no DESC''',row['source_ref']) if row['source_ref'] else []
    rows=await con.fetch('SELECT * FROM lesson_blocks WHERE lesson_id=$1 ORDER BY position',id)
    draft=next((r for r in revisions if r['status']=='draft' and r['publication_state']=='draft'),None)
    published=next((r for r in revisions if r['status']=='published' and r['publication_state']=='published'),None)
    scheduled=next((r for r in revisions if r['publication_state']=='scheduled'),None)
    live=row['publication_state']=='published' or row['publication_state']=='scheduled' and row['publish_at'] is not None and row['publish_at']<=datetime.now(timezone.utc)
    model={'lessonId':str(row['id']),'sourceRef':row['source_ref'] or '', 'title':row['title'], 'slug':row['slug'],
        'unitId':str(row['unit_id']), 'learningArea':area(row['learning_area']),'summary':row['summary'],
        'teacherNotes':row['teacher_notes'],'estimatedMinutes':row['estimated_minutes'],'lessonState':row['publication_state'],
        'live':live,'draft':revision_ref(draft),
        'published':{**revision_ref(published),'title':published['title']} if published else None,
        'scheduled':revision_ref(scheduled),'pastRevisions':len(revisions),
        'blocks':[from_row(x) for x in rows],'contentSource':'lesson'}
    snapshot=draft['content_snapshot'] if draft else None
    if isinstance(snapshot,str):snapshot=json.loads(snapshot)
    if isinstance(snapshot,dict):
        model['contentSource']='draft'
        if isinstance(snapshot.get('blocks'),list):model['blocks']=[from_snapshot(b) for b in snapshot['blocks']]
        for key in ('unitId','slug'):
            if isinstance(snapshot.get(key),str) and snapshot[key]:model[key]=snapshot[key]
        if area(snapshot.get('learningArea')):model['learningArea']=snapshot['learningArea']
        for key in ('summary','teacherNotes'):
            if key in snapshot and (snapshot[key] is None or isinstance(snapshot[key],str)):model[key]=snapshot[key]
        if 'estimatedMinutes' in snapshot and (snapshot['estimatedMinutes'] is None or type(snapshot['estimatedMinutes']) in (int,float)):
            model['estimatedMinutes']=snapshot['estimatedMinutes']
        model['title']=draft['title']
    return model,revisions,published

def snapshot_block(b,i):
    return {'position':i,'type':b['type'],'text':b.get('text'),'url':b.get('url'),
            'objectKey':b.get('objectKey'),'originalName':b.get('originalName'),
            'mimeType':b.get('mimeType'),'size':b.get('size'),'ref':b.get('ref'),'quiz':b.get('quiz')}

@router.post('/api/admin/content/lessons/{id}/revision')
async def revise(req:Request,id:str):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':'unauthenticated'},401)
    if u['role'] not in ('teacher','admin','owner'):return core.j({'error':'forbidden'},403)
    uid=core.uuid_value(id)
    if not uid:return core.j({'error':'not_found'},404)
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            model,revisions,published=await load(con,uid)
            if not model:return core.j({'ok':False,'issues':[issue('lesson_not_found','That lesson does not exist.')]},404)
            if model['draft']:
                latest=revisions[0] if revisions else None
                if latest:return core.j({'ok':True,'versionId':str(latest['id']),'versionNo':latest['version_no'], 'created':False,'lesson':model})
                return core.j({'ok':False,'issues':[issue('draft_missing','The editable revision could not be read.')]},422)
            if not model['sourceRef']:return core.j({'ok':False,'issues':[issue('missing_source_ref','That lesson has no stable reference, so it cannot be revised.')]},422)
            snapshot=published['content_snapshot'] if published else None
            if isinstance(snapshot,str):snapshot=json.loads(snapshot)
            if not isinstance(snapshot,dict):snapshot={}
            fallback={'unitId':model['unitId'],'slug':model['slug'],'learningArea':model['learningArea'] or 'general',
                      'summary':model['summary'],'teacherNotes':model['teacherNotes'],
                      'estimatedMinutes':model['estimatedMinutes'],'blocks':model['blocks']}
            payload={key:(snapshot.get(key) if snapshot.get(key) is not None else fallback[key]) for key in ('unitId','slug','summary','teacherNotes','estimatedMinutes')}
            payload['learningArea']=snapshot.get('learningArea') if area(snapshot.get('learningArea')) else fallback['learningArea']
            original=snapshot.get('blocks') if isinstance(snapshot.get('blocks'),list) else model['blocks']
            payload['blocks']=[payload_block(from_snapshot(b) if isinstance(snapshot.get('blocks'),list) else b) for b in original]
            problems=[]
            if not model['title'].strip():problems.append(issue('missing_title','A title is required.','title'))
            if not payload['unitId']:problems.append(issue('invalid_payload','Required','unitId'))
            if not payload['slug'] or not isinstance(payload['slug'],str):problems.append(issue('invalid_payload','Required','slug'))
            if not area(payload['learningArea']):problems.append(issue('invalid_payload','Choose the learning area this lesson is about.','learningArea'))
            if isinstance(payload['teacherNotes'],str) and len(payload['teacherNotes'])>8000:problems.append(issue('invalid_payload','Teacher notes must stay under 8000 characters.','teacherNotes'))
            if isinstance(payload['summary'],str) and len(payload['summary'])>2000:problems.append(issue('invalid_payload','The description must stay under 2000 characters.','summary'))
            if payload['estimatedMinutes'] is not None and (type(payload['estimatedMinutes']) is not int or not 1<=payload['estimatedMinutes']<=600):
                problems.append(issue('invalid_payload','Estimated minutes must stay under 600.','estimatedMinutes'))
            for b_issue in validate_blocks(payload['blocks']):problems.append(issue('invalid_payload',b_issue['message'],b_issue.get('field')))
            if problems:return core.j({'ok':False,'issues':problems[:8]},422)
            # Persist canonical edit structure. Published/live lesson stays unchanged.
            blocks=[snapshot_block(b,i+1) for i,b in enumerate(payload['blocks'])]
            content={'unitId':payload['unitId'],'slug':payload['slug'],'order':None,'learningArea':payload['learningArea'],
                     'summary':payload['summary'],'teacherNotes':payload['teacherNotes'] if isinstance(payload['teacherNotes'],str) and payload['teacherNotes'].strip() else None,
                     'estimatedMinutes':payload['estimatedMinutes'],'blocks':blocks}
            if not model['live']:
                await con.execute('''UPDATE lessons SET unit_id=$2,slug=$3,title=$4,summary=$5,learning_area=$6,teacher_notes=$7,
                      estimated_minutes=$8,updated_at=NOW() WHERE id=$1''',uid,core.uuid_value(payload['unitId']),payload['slug'],model['title'],
                      content['summary'],content['learningArea'],content['teacherNotes'],content['estimatedMinutes'])
                # SaveLessonStructure preserves block IDs for identical content; this
                # branch must never bulk-delete responses from unchanged blocks.
                from .step29_lesson_revision_blocks import reconcile_blocks
                await reconcile_blocks(con,uid,payload['blocks'])
            version_id,version_no,created=await pin(con,'lesson','lesson',model['sourceRef'],model['title'],content,u['id'],
                                                      target_type='lesson',target_id=uid,provenance={'origin':'authored','blockCount':len(blocks),'learningArea':content['learningArea']},force=model['live'])
            parent=f'lesson:lesson:{model["sourceRef"]}@v{model["published"]["versionNo"]}' if model['published'] else None
            note=f'Revision started from {parent}' if parent else 'Revision started'
            await con.execute('''UPDATE content_versions SET provenance=$2::jsonb,note=$3 WHERE id=$1''',core.uuid_value(version_id),
                              json.dumps({'origin':'revision','from':parent}),note)
            new_model,_,_=await load(con,uid)
            if not new_model:return core.j({'ok':False,'issues':[issue('lesson_not_found','That lesson does not exist.')]},404)
            return core.j({'ok':True,'versionId':version_id,'versionNo':version_no,'created':created,'lesson':new_model},201 if created else 200)

def install():core.app.include_router(router)
