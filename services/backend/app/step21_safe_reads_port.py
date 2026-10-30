"""Read-only assignment and resource surfaces, retaining source-owned authorization."""
from __future__ import annotations
from fastapi import APIRouter, Request
from . import main as core
from .db import row_to_dict
from .step17_mcq_port import staff,live

router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}
OWNER={'lesson':('lessons','title',None), 'reading':('reading_passages','title',None),
       'listening':('listening_tests','title','created_by_user_id'),
       'writing':('writing_prompts','prompt',None), 'speaking':('speaking_materials','title','created_by_user_id'),
       'grammar':('grammar_topics','title',None), 'assignment':('assignments','title','created_by_user_id'),
       'live_class':('live_classes','title','teacher_user_id')}

async def get_owner(con, kind, id):
    if kind not in OWNER:return None
    table,title,creator=OWNER[kind]
    # Whitelisted table mapping, never client-controlled SQL identifiers.
    sql=f'''SELECT * FROM {table} x WHERE x.id=$1'''
    if kind in ('reading','listening','writing','speaking'):
        sql+=" AND NOT EXISTS(SELECT 1 FROM activity_events a WHERE a.id=md5('deleted-content:' || x.id::text)::uuid AND a.type='CONTENT_DELETED')"
    record=await con.fetchrow(sql,core.uuid_value(id))
    if not record:return None
    if kind=='speaking':student=bool(record['is_active']) and live(record)
    elif kind in ('reading','listening','writing'):student=live(record)
    else:student=True
    return {'id':id,'creatorId':record[creator] if creator else None,'studentVisible':student,
            'label':{'lesson':'lesson','reading':'reading_passage','listening':'listening_test','writing':'writing_prompt',
                     'speaking':'speaking_material','grammar':'grammar_topic','assignment':'assignment','live_class':'live_class'}[kind],
            'title':str(record[title] or {'lesson':'Lesson','reading':'Reading','listening':'Listening','writing':'Writing',
             'speaking':'Speaking','grammar':'Grammar','assignment':'Assignment','live_class':'Live class'}[kind]).strip()[:120]}

@router.get('/api/materials/{type}/{id}')
async def get_materials(req:Request,type:str,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if type not in OWNER or not core.uuid_value(id):return core.j({'error':'not_found'},404)
    db=await core.pool()
    async with db.acquire() as con:
        owner=await get_owner(con,type,id)
        if not owner:return core.j({'error':'not_found'},404)
        if not staff(user) and not owner['studentVisible']:return core.j({'error':'forbidden'},403)
        rows=await con.fetch('''SELECT id,type,position,text_content AS "textContent",link_url AS "linkUrl",
           object_key AS "objectKey",original_name AS "originalName",mime_type AS "mimeType",size
           FROM resource_blocks WHERE owner_type=$1 AND owner_id=$2 ORDER BY position''',type,core.uuid_value(id))
    return core.j({'ok':True,'blocks':[row_to_dict(row) for row in rows]})

@router.get('/api/assignments')
async def get_assignments(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    db=await core.pool()
    async with db.acquire() as con:
        if user['role'] in ('teacher','owner'):
            if user['role']=='teacher':
                rows=await con.fetch('''SELECT a.id,a.title,a.module,a.content_type AS "contentType",
                  a.source_ref AS "sourceRef",a.content_version_id AS "contentVersionId",a.due_at AS "dueAt",
                  COALESCE(t.student_user_id,a.target_user_id) AS "studentUserId",COALESCE(t.status,a.status) AS status,
                  CASE WHEN t.assignment_id IS NULL THEN CASE WHEN a.status='completed' THEN a.updated_at END WHEN t.status='completed' THEN COALESCE(t.completed_at,a.updated_at) END AS "completedAt"
                  FROM assignments a LEFT JOIN assignment_targets t ON t.assignment_id=a.id
                  WHERE a.created_by_user_id=$1 AND EXISTS(SELECT 1 FROM users u
                    JOIN teacher_student_links l ON l.student_user_id=u.id
                    WHERE u.role='student' AND u.id=COALESCE(t.student_user_id,a.target_user_id)
                      AND l.teacher_user_id=$1)
                  ORDER BY a.created_at DESC''',user['id'])
            else:
                rows=await con.fetch('''SELECT a.id,a.title,a.module,a.content_type AS "contentType",
                  a.source_ref AS "sourceRef",a.content_version_id AS "contentVersionId",a.due_at AS "dueAt",
                  COALESCE(t.student_user_id,a.target_user_id) AS "studentUserId",COALESCE(t.status,a.status) AS status,
                  CASE WHEN t.assignment_id IS NULL THEN CASE WHEN a.status='completed' THEN a.updated_at END WHEN t.status='completed' THEN COALESCE(t.completed_at,a.updated_at) END AS "completedAt"
                  FROM assignments a LEFT JOIN assignment_targets t ON t.assignment_id=a.id ORDER BY a.created_at DESC''')
            result={}
            for r in rows:
                obj=result.setdefault(str(r['id']),{'id':str(r['id']),'title':r['title'],'module':r['module'],
                    'contentType':r['contentType'],'sourceRef':r['sourceRef'],
                    'contentVersionId':str(r['contentVersionId']) if r['contentVersionId'] else None,
                    'dueAt':row_to_dict({'dueAt':r['dueAt']})['dueAt'],'targets':[]})
                if r['studentUserId']:obj['targets'].append({'studentUserId':str(r['studentUserId']),
                   'status':r['status'] or 'not_started','completedAt':row_to_dict({'completedAt':r['completedAt']})['completedAt']})
            return core.j({'ok':True,'assignments':list(result.values())},headers=PRIVATE)
        if user['role']!='student':return core.j({'error':'forbidden'},403)
        rows=await con.fetch('''SELECT a.id,a.title,a.description,a.instructions,COALESCE(t.due_at,a.due_at) AS "dueAt",
           a.module,a.content_type AS "contentType",a.source_ref AS "sourceRef",a.content_version_id AS "contentVersionId",
           COALESCE(t.status,a.status)::text AS status,v.version_no AS "versionNo",v.status AS "versionStatus"
           FROM assignments a LEFT JOIN assignment_targets t ON t.assignment_id=a.id AND t.student_user_id=$1
           LEFT JOIN content_versions v ON v.id=a.content_version_id
           WHERE t.assignment_id IS NOT NULL OR (a.target_user_id=$1 AND NOT EXISTS(
             SELECT 1 FROM assignment_targets tx WHERE tx.assignment_id=a.id))
           ORDER BY a.created_at DESC''',user['id'])
        result=[]
        for r in rows:
            d=row_to_dict(r)
            result.append({'id':d['id'],'title':d['title'],'description':d['description'],
                'instructions':d['instructions'],'status':d['status'],'dueAt':d['dueAt'],
                'content':{'module':d['module'] or '', 'contentType':d['contentType'] or '',
                  'sourceRef':d['sourceRef'] or '','versionId':d['contentVersionId'] or '',
                  'versionNo':d['versionNo'],'versionStatus':d['versionStatus']}})
    return core.j({'ok':True,'assignments':result},headers=PRIVATE)

def install():core.app.include_router(router)
