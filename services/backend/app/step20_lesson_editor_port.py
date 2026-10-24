"""Staff-only editable lesson projection from the canonical revision snapshot.

Mirrors lib/content/lesson-edit.ts read semantics. Does not write to the source.
"""
from __future__ import annotations
from datetime import datetime, timezone
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict

router=APIRouter()
LEARNING_AREAS={'listening','reading','writing','speaking','grammar','vocabulary','general'}

def area(value):return value if value in LEARNING_AREAS else None

def from_snapshot(block):
    quiz=block.get('quiz') if isinstance(block.get('quiz'),dict) else None
    ref=block.get('ref') if isinstance(block.get('ref'),dict) else None
    return {'type':str(block.get('type') or ''), 'text':block.get('text'), 'url':block.get('url'),
        'objectKey':block.get('objectKey'), 'originalName':block.get('originalName'),
        'mimeType':block.get('mimeType'), 'size':block.get('size'),
        'ref':{'module':ref.get('module'),'contentType':ref.get('contentType'),'sourceRef':ref.get('sourceRef'),'versionId':ref.get('versionId')}
            if ref is not None else None,
        'quiz':{'questionType':quiz.get('questionType') or 'mcq_single','prompt':quiz.get('prompt') or '',
                'options':quiz.get('options'),'answer':quiz.get('answer') if isinstance(quiz.get('answer'),str) else '',
                'explanation':quiz.get('explanation')} if quiz is not None else None}

def from_row(row):
    q=row['quiz_payload'] or {}
    if not isinstance(q,dict):q={}
    r={'module':row['ref_module'],'contentType':row['ref_content_type'],'sourceRef':row['ref_source_ref'],
       'versionId':str(row['ref_content_version_id']) if row['ref_content_version_id'] else None} if all(row[k] for k in ('ref_module','ref_content_type','ref_source_ref')) else None
    return {'type':row['type'],'text':row['text_content'],'url':row['link_url'],'objectKey':row['object_key'],
            'originalName':row['original_name'],'mimeType':row['mime_type'],'size':row['size'],'ref':r,
            'quiz':{'questionType':row['quiz_question_type'],'prompt':q.get('prompt') if isinstance(q.get('prompt'),str) else '',
                    'options':q.get('options') if isinstance(q.get('options'),list) else None,
                    'answer':q.get('answer') if isinstance(q.get('answer'),str) else '',
                    'explanation':q.get('explanation') if isinstance(q.get('explanation'),str) else None}
              if row['quiz_question_type'] else None}

def revision_ref(r):
    return {'versionId':str(r['id']),'versionNo':r['version_no']} if r else None

@router.get('/api/admin/content/lessons/{id}/edit')
async def lesson_editor(req:Request,id:str):
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    if u['role'] not in ('teacher','admin','owner'):return core.j({'error':'forbidden'},403)
    ident=core.uuid_value(id)
    if not ident:return core.j({'error':'not_found'},404)
    database=await core.pool()
    async with database.acquire() as con:
        lesson=await con.fetchrow('''SELECT id,title,slug,unit_id,source_ref,learning_area,summary,teacher_notes,estimated_minutes,
            publication_state,publish_at FROM lessons WHERE id=$1''', ident)
        if not lesson:return core.j({'error':'not_found'},404)
        revisions=await con.fetch('''SELECT id,title,version_no,status,publication_state,content_snapshot
            FROM content_versions WHERE module='lesson' AND content_type='lesson' AND source_ref=$1 ORDER BY version_no DESC''',lesson['source_ref']) if lesson['source_ref'] else []
        row_blocks=await con.fetch('SELECT * FROM lesson_blocks WHERE lesson_id=$1 ORDER BY position',ident)
    draft=next((r for r in revisions if r['status']=='draft' and r['publication_state']=='draft'),None)
    published=next((r for r in revisions if r['status']=='published' and r['publication_state']=='published'),None)
    scheduled=next((r for r in revisions if r['publication_state']=='scheduled'),None)
    data={'lessonId':str(lesson['id']),'sourceRef':lesson['source_ref'] or '',
          'title':lesson['title'],'slug':lesson['slug'],'unitId':str(lesson['unit_id']),
          'learningArea':area(lesson['learning_area']),'summary':lesson['summary'],'teacherNotes':lesson['teacher_notes'],
          'estimatedMinutes':lesson['estimated_minutes'],'lessonState':lesson['publication_state'],
          'live':lesson['publication_state']=='published' or (lesson['publication_state']=='scheduled' and lesson['publish_at'] is not None and lesson['publish_at']<=datetime.now(timezone.utc)),
          'draft':revision_ref(draft),'published':{**revision_ref(published),'title':published['title']} if published else None,
          'scheduled':revision_ref(scheduled),'pastRevisions':len(revisions),
          'blocks':[from_row(b) for b in row_blocks],'contentSource':'lesson'}
    snapshot=draft['content_snapshot'] if draft else None
    if isinstance(snapshot,dict):
        data['contentSource']='draft'
        if isinstance(snapshot.get('blocks'),list):data['blocks']=[from_snapshot(b) for b in snapshot['blocks'] if isinstance(b,dict)]
        for key in ('unitId','slug'):
            if isinstance(snapshot.get(key),str) and snapshot[key]:data[key]=snapshot[key]
        if area(snapshot.get('learningArea')):data['learningArea']=snapshot['learningArea']
        for key in ('summary','teacherNotes'):
            if key in snapshot and (snapshot[key] is None or isinstance(snapshot[key],str)):data[key]=snapshot[key]
        if 'estimatedMinutes' in snapshot and (snapshot['estimatedMinutes'] is None or type(snapshot['estimatedMinutes']) in (int,float)):
            data['estimatedMinutes']=snapshot['estimatedMinutes']
        data['title']=draft['title']
    return core.j({'lesson':data})

def install():core.app.include_router(router)
