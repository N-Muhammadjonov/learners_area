"""Bounded centre/staff APIs translated from original route and underlying services.

No background jobs, schema changes or externally-visible endpoints beyond the source.
"""
from __future__ import annotations
import asyncio
import json
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from . import main as core
from .lesson_writing_port import is_js_uuid, js_length

router=APIRouter()
MATERIAL_TABLES={
 'reading':'reading_passages','reading-set':'general_reading_sets',
 'listening':'listening_tests','writing':'writing_prompts','speaking':'speaking_materials',
 'speaking-prompt':'speaking_prompts','video':'video_lessons','writing-lesson':'writing_lessons',
 'writing-translation':'writing_translation_sets','writing-model-text':'writing_model_texts',
 'writing-pattern':'writing_language_patterns',
}

def staff(u):return u and u['role'] in ('owner','admin','teacher')
def administrator(u):return u and u['role'] in ('owner','admin')
def valid_url(v):
    try:
        p=urlsplit(v)
        return bool(isinstance(v,str) and p.scheme and p.netloc and not re.search(r'\s',v))
    except (ValueError,TypeError):return False

@router.post('/api/teacher/live-classes')
async def create_live_class(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    if not staff(u):return core.j({'error':'forbidden'},403)
    b=await core.payload(req)
    if not isinstance(b,dict):return core.j({'error':'Required'},400)
    title=b.get('title');topic=b.get('topic');scheduled=b.get('scheduledAt');duration=b.get('durationMinutes');url=b.get('meetingUrl')
    # Zod object's .passthrough is false by default: unknown fields are ignored.
    if not isinstance(title,str) or not 3<=js_length(title)<=200:return core.j({'error':'String must contain at least 3 character(s)' if isinstance(title,str) and len(title)<3 else 'Required' if title is None else 'String must contain at most 200 character(s)'},400)
    if topic is not None and (not isinstance(topic,str) or js_length(topic)>500):return core.j({'error':'String must contain at most 500 character(s)'},400)
    if not isinstance(scheduled,str) or not scheduled:return core.j({'error':'Required' if scheduled is None else 'String must contain at least 1 character(s)'},400)
    if url is not None and url!='' and not valid_url(url):return core.j({'error':'Invalid url'},400)
    try:
        n=float(duration) if duration not in (None,'') else 0.0
    except (ValueError,TypeError,OverflowError):n=float('nan')
    if not isinstance(n,float) or not n.is_integer() or not 15<=n<=240:return core.j({'error':'Expected number, received nan' if n!=n else 'Number must be greater than or equal to 15' if n<15 else 'Number must be less than or equal to 240'},400)
    # JS new Date() accepts ISO datetime-local without timezone (local OS timezone).
    try: dt=datetime.fromisoformat(scheduled.replace('Z','+00:00'))
    except ValueError:return core.j({'error':'internal_server_error'},500)
    db=await core.pool()
    async with db.acquire() as conn:
        course=await conn.fetchrow('SELECT id FROM courses WHERE slug=$1 LIMIT 1','ielts')
        if not course:return core.j({'error':'no_course'},500)
        inserted=await conn.fetchrow('''INSERT INTO live_classes(course_id,teacher_user_id,title,topic,scheduled_at,duration_minutes,meeting_url)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id''',course['id'],u['id'],title,topic,dt,int(n),url or None)
    return core.j({'ok':True,'id':str(inserted['id'])})

@router.patch('/api/teacher/live-classes/{id}')
async def update_live_class(req:Request,id:str):
    if not is_js_uuid(id):return core.j({'error':'not_found'},404)
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    if not staff(u):return core.j({'error':'forbidden'},403)
    b=await core.payload(req)
    if not isinstance(b,dict):return core.j({'error':'invalid_input'},400)
    values={}
    for key,col in [('status','status'),('recordingUrl','recording_url'),('meetingUrl','meeting_url')]:
        if key not in b:continue
        v=b[key]
        if key=='status':
            if v not in ('upcoming','live','completed','recorded','cancelled'):return core.j({'error':'invalid_input'},400)
        elif not isinstance(v,str) or (v and not valid_url(v)):return core.j({'error':'invalid_input'},400)
        if v:values[col]=v
    if not values:return core.j({'error':'invalid_input'},400)
    fields=list(values)
    clause=', '.join(f'{k}=${i+3}' for i,k in enumerate(fields))
    args=[id,u['id']]+[values[k] for k in fields]
    scope='' if administrator(u) else ' AND teacher_user_id=$2'
    db=await core.pool()
    async with db.acquire() as conn:
        found=await conn.fetchrow(f'UPDATE live_classes SET {clause} WHERE id=$1{scope} RETURNING id',*args)
    return core.j({'ok':True}) if found else core.j({'error':'not_found'},404)

@router.post('/api/admin/roster')
async def roster(req:Request):
    u=await core.current_user(req,active=True)
    if not administrator(u):return core.j({'error':'forbidden'},403)
    try: f=await req.form()
    except Exception:f={}
    teacher=str(f.get('teacherId') or '');student=str(f.get('studentId') or '');action=str(f.get('action') or '')
    if action not in ('assign','unassign'):return core.j({'error':'invalid_input'},400)
    changed=False;ok=False
    if is_js_uuid(teacher) and is_js_uuid(student) and teacher.lower()!=student.lower():
        db=await core.pool()
        async with db.acquire() as conn:
            t=await conn.fetchval('SELECT role FROM users WHERE id=$1 LIMIT 1',teacher)
            s=await conn.fetchval('SELECT role FROM users WHERE id=$1 LIMIT 1',student)
            if t=='teacher' and s=='student':
                ok=True
                if action=='assign':
                    row=await conn.fetchrow('''INSERT INTO teacher_student_links(teacher_user_id,student_user_id,assigned_by_user_id)
                       VALUES($1,$2,$3) ON CONFLICT(teacher_user_id,student_user_id) DO NOTHING RETURNING id''',teacher,student,u['id'])
                else:
                    row=await conn.fetchrow('DELETE FROM teacher_student_links WHERE teacher_user_id=$1 AND student_user_id=$2 RETURNING id',teacher,student)
                changed=bool(row)
                if changed:
                    await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
                    VALUES($1,$2,'user',$3,$4::jsonb)''',u['id'],f'roster.{"assigned" if action=="assign" else "unassigned"}',student,json.dumps({'teacherId':teacher,'studentId':student}))
    from urllib.parse import urlencode
    params={}
    if re.fullmatch(r'[0-9a-f-]{36}',teacher,re.I):params['teacher']=teacher
    params['status']='failed' if not ok else 'saved' if changed else 'unchanged'
    return RedirectResponse('/app/admin/roster?'+urlencode(params),status_code=303)

async def _delete_material(conn,u,typ,id):
    # Called under the caller's transaction for atomic tombstones and audit.
    table=MATERIAL_TABLES[typ]
    row=await conn.fetchrow(f'SELECT id,created_by_user_id FROM {table} WHERE id=$1 FOR UPDATE',id)
    if not row:return 'not_found'
    creator=row.get('created_by_user_id') if isinstance(row,dict) else row['created_by_user_id']
    if creator and u['role'] not in ('owner','admin') and str(creator)!=str(u['id']):return 'forbidden'
    if typ=='reading-set':
        members=await conn.fetch('SELECT passage_id AS id FROM general_reading_passages WHERE set_id=$1 ORDER BY passage_id',id)
        for member in members:
            outcome=await _delete_material(conn,u,'reading',str(member['id']))
            if outcome!='deleted':return outcome
    await conn.execute('''INSERT INTO activity_events(id,user_id,type,payload)
         VALUES(md5('deleted-content:' || $1)::uuid,$2,'CONTENT_DELETED',$3::jsonb) ON CONFLICT(id) DO NOTHING''',id,u['id'],json.dumps({'contentType':typ,'contentId':id,'resultsPreserved':True}))
    col_active=',is_active=false' if typ in ('video','speaking','speaking-prompt') else ''
    await conn.execute(f"UPDATE {table} SET publication_state='draft',publish_at=NULL{col_active} WHERE id=$1",id)
    versions=await conn.fetch('SELECT id FROM content_versions WHERE target_id=$1',id)
    if versions:
        await conn.execute("UPDATE content_versions SET publication_state='draft' WHERE target_id=$1",id)
        for v in versions:
            vid=str(v['id'])
            await conn.execute('''INSERT INTO activity_events(id,user_id,type,payload)
              VALUES(md5('deleted-content:' || $1)::uuid,$2,'CONTENT_DELETED',$3::jsonb) ON CONFLICT(id) DO NOTHING''',vid,u['id'],json.dumps({'contentType':'content-version','contentId':vid,'resultsPreserved':True}))
    await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
      VALUES($1,'content.updated',$2,$3,$4::jsonb)''',u['id'],typ,id,json.dumps({'operation':'delete','resultsPreserved':True}))
    return 'deleted'

@router.delete('/api/admin/content/{type}/{id}')
async def delete_content(req:Request,type:str,id:str):
    u=await core.current_user(req,active=True)
    if not staff(u):return core.j({'error':'forbidden'},403)
    if type not in MATERIAL_TABLES or not is_js_uuid(id):return core.j({'error':'not_found'},404)
    db=await core.pool()
    async with db.acquire() as conn:
        async with conn.transaction():
            outcome=await _delete_material(conn,u,type,id)
            if outcome=='forbidden':return core.j({'error':'forbidden'},403,{'Cache-Control':'private, no-store'})
            if outcome=='not_found':return core.j({'error':'not_found'},404,{'Cache-Control':'private, no-store'})
    return core.j({'ok':True,'action':'deleted','resultsPreserved':True},headers={'Cache-Control':'private, no-store'})



@router.patch('/api/admin/listening/tests/{id}')
async def rename_listening_test(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not administrator(user):return core.j({'error':'forbidden'},403)
    if not is_js_uuid(id):return core.j({'error':'not_found'},404)
    b=await core.payload(req)
    if not isinstance(b,dict) or set(b)!={'title'} or not isinstance(b.get('title'),str):return core.j({'error':'invalid_input'},400)
    title=b['title'].strip()
    if not 1<=js_length(title)<=200:return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as conn:
        async with conn.transaction():
            row=await conn.fetchrow('SELECT id FROM listening_tests WHERE id=$1 FOR UPDATE',id)
            if not row:return core.j({'error':'not_found'},404,{'Cache-Control':'private, no-store'})
            await conn.execute('UPDATE listening_tests SET title=$2 WHERE id=$1',id,title)
            await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
               VALUES($1,'content.updated','listening',$2,$3::jsonb)''',user['id'],id,json.dumps({'operation':'rename'}))
    return core.j({'ok':True},headers={'Cache-Control':'private, no-store'})

@router.delete('/api/admin/listening/tests/{id}')
async def delete_listening_test(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not administrator(user):return core.j({'error':'forbidden'},403)
    if not is_js_uuid(id):return core.j({'error':'not_found'},404)
    db=await core.pool()
    async with db.acquire() as conn:
        async with conn.transaction():
            from .preview_contract import current_preview
            if current_preview.get():
                row=await conn.fetchrow('SELECT id FROM listening_tests WHERE id=$1 FOR UPDATE',core.uuid_value(id))
                if not row:return core.j({'error':'not_found'},404)
                await conn.execute("UPDATE listening_tests SET publication_state='archived',is_active=false,publish_at=NULL WHERE id=$1",core.uuid_value(id))
                await conn.execute("INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata) VALUES($1,'content.updated','listening',$2,$3::jsonb)",user['id'],id,json.dumps({'operation':'archive'}))
                return core.j({'ok':True},headers={'Cache-Control':'private, no-store'})
            result=await _delete_material(conn,user,'listening',id)
    if result=='deleted':return core.j({'ok':True,'action':result,'resultsPreserved':True})
    return core.j({'error':result},403 if result=='forbidden' else 404)

def install():core.app.include_router(router)
