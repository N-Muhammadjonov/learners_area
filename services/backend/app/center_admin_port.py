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
    from .live_classes_port import ACCESS_SCOPES, extract_youtube_video_id, has_extended_live_schema
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    if not staff(u):return core.j({'error':'forbidden'},403)
    b=await core.payload(req)
    if not isinstance(b,dict):return core.j({'error':'Required'},400)
    title=b.get('title');topic=b.get('topic');description=b.get('description')
    scheduled=b.get('scheduledAt');duration=b.get('durationMinutes');url=b.get('meetingUrl')
    yt_input=b.get('youtubeUrl') if 'youtubeUrl' in b else b.get('youtubeVideoId')
    access_scope=b.get('accessScope','course')
    student_ids=b.get('studentIds')
    req_teacher_id=b.get('teacherUserId') if 'teacherUserId' in b else b.get('teacher_user_id')
    if req_teacher_id is not None:
        if not is_js_uuid(str(req_teacher_id)):
            return core.j({'error':'invalid_input'},400)
        if u['role']!='owner' and str(req_teacher_id).lower()!=str(u['id']).lower():
            return core.j({'error':'forbidden'},403)

    if not isinstance(title,str) or not 3<=js_length(title)<=200:
        return core.j({'error':'String must contain at least 3 character(s)' if isinstance(title,str) and len(title)<3 else 'Required' if title is None else 'String must contain at most 200 character(s)'},400)
    if topic is not None and (not isinstance(topic,str) or js_length(topic)>500):
        return core.j({'error':'String must contain at most 500 character(s)'},400)
    if description is not None and (not isinstance(description,str) or js_length(description)>2000):
        return core.j({'error':'String must contain at most 2000 character(s)'},400)
    if not isinstance(scheduled,str) or not scheduled:
        return core.j({'error':'Required' if scheduled is None else 'String must contain at least 1 character(s)'},400)
    if url is not None and url!='' and not valid_url(url):
        return core.j({'error':'Invalid url'},400)

    youtube_video_id=None
    if yt_input not in (None,''):
        youtube_video_id,yt_err=extract_youtube_video_id(yt_input)
        if yt_err:return core.j({'error':yt_err},400)
    elif url:
        extracted,_=extract_youtube_video_id(url)
        if extracted:youtube_video_id=extracted

    if access_scope not in ACCESS_SCOPES:
        return core.j({'error':'invalid_input'},400)
    clean_student_ids=[]
    if student_ids is not None:
        if not isinstance(student_ids,list) or len(student_ids)>500 or any(not is_js_uuid(str(x)) for x in student_ids):
            return core.j({'error':'invalid_input'},400)
        clean_student_ids=list(dict.fromkeys(str(x).lower() for x in student_ids))
        if clean_student_ids and access_scope=='course' and 'accessScope' not in b:
            access_scope='assigned'

    try:
        n=float(duration) if duration not in (None,'') else 0.0
    except (ValueError,TypeError,OverflowError):n=float('nan')
    if not isinstance(n,float) or not n.is_integer() or not 15<=n<=240:
        return core.j({'error':'Expected number, received nan' if n!=n else 'Number must be greater than or equal to 15' if n<15 else 'Number must be less than or equal to 240'},400)
    try: dt=datetime.fromisoformat(scheduled.replace('Z','+00:00'))
    except ValueError:return core.j({'error':'internal_server_error'},500)

    eff_topic=topic if topic is not None else (description[:500] if isinstance(description,str) else None)
    eff_desc=description if description is not None else topic

    db=await core.pool()
    async with db.acquire() as conn:
        course=await conn.fetchrow('SELECT id FROM courses WHERE slug=$1 LIMIT 1','ielts')
        if not course:return core.j({'error':'no_course'},500)
        if await has_extended_live_schema(conn):
            if clean_student_ids:
                import uuid as _uuid
                if u['role']!='owner':
                    valid_rows=await conn.fetch(
                        '''SELECT u.id FROM users u
                           JOIN teacher_student_links l ON l.student_user_id=u.id
                           WHERE l.teacher_user_id=$1 AND u.role='student' AND u.id=ANY($2::uuid[])''',
                        u['id'],[_uuid.UUID(s) for s in clean_student_ids])
                else:
                    valid_rows=await conn.fetch(
                        "SELECT id FROM users WHERE role='student' AND id=ANY($1::uuid[])",
                        [_uuid.UUID(s) for s in clean_student_ids])
                if len(valid_rows)!=len(clean_student_ids):
                    return core.j({'error':'invalid_student_assignment'},400)
            inserted=await conn.fetchrow(
                '''INSERT INTO live_classes(
                     course_id,teacher_user_id,title,topic,description,scheduled_at,duration_minutes,
                     meeting_url,youtube_video_id,access_scope,recording_status
                   ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'none') RETURNING id''',
                course['id'],u['id'],title,eff_topic,eff_desc,dt,int(n),url or None,youtube_video_id,access_scope)
            if clean_student_ids and inserted:
                import uuid as _uuid
                for sid in clean_student_ids:
                    await conn.execute(
                        '''INSERT INTO live_class_enrollments(live_class_id,user_id,assigned_by_user_id)
                           VALUES($1,$2,$3) ON CONFLICT(live_class_id,user_id) DO NOTHING''',
                        inserted['id'],_uuid.UUID(sid),u['id'])
        else:
            inserted=await conn.fetchrow('''INSERT INTO live_classes(course_id,teacher_user_id,title,topic,scheduled_at,duration_minutes,meeting_url)
              VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id''',course['id'],u['id'],title,eff_topic,dt,int(n),url or None)
    return core.j({'ok':True,'id':str(inserted['id']),'youtubeVideoId':youtube_video_id})

@router.patch('/api/teacher/live-classes/{id}')
async def update_live_class(req:Request,id:str):
    from .live_classes_port import (
        ACCESS_SCOPES, LIFECYCLE_STATUSES, RECORDING_STATUSES, access_bus,
        can_user_manage_class, chat_bus, compute_lifecycle_status,
        extract_youtube_video_id, has_extended_live_schema,
        map_requested_status_transition,
    )
    if not is_js_uuid(id):return core.j({'error':'not_found'},404)
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    if not staff(u):return core.j({'error':'forbidden'},403)
    b=await core.payload(req)
    if not isinstance(b,dict) or not b:return core.j({'error':'invalid_input'},400)

    db=await core.pool()
    async with db.acquire() as conn:
        extended=await has_extended_live_schema(conn)
        if not extended:
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
            scope='' if u['role']=='owner' else ' AND teacher_user_id=$2'
            found=await conn.fetchrow(f'UPDATE live_classes SET {clause} WHERE id=$1{scope} RETURNING id',*args)
            return core.j({'ok':True}) if found else core.j({'error':'not_found'},404)

        import uuid as _uuid
        existing=await conn.fetchrow('SELECT * FROM live_classes WHERE id=$1 LIMIT 1',_uuid.UUID(id))
        if not existing:
            return core.j({'error':'not_found'},404)
        if not can_user_manage_class(u, dict(existing)):
            return core.j({'error':'forbidden'},403)
        if ('teacherUserId' in b or 'teacher_user_id' in b) and u['role']!='owner':
            req_t=b.get('teacherUserId') if 'teacherUserId' in b else b.get('teacher_user_id')
            if str(req_t or '').lower()!=str(u['id']).lower():
                return core.j({'error':'forbidden'},403)

        updates={}
        if 'title' in b:
            t=b['title']
            if not isinstance(t,str) or not 3<=js_length(t.strip())<=200:
                return core.j({'error':'invalid_input'},400)
            updates['title']=t.strip()
        if 'topic' in b:
            tp=b['topic']
            if tp is not None and (not isinstance(tp,str) or js_length(tp)>500):
                return core.j({'error':'invalid_input'},400)
            updates['topic']=tp
        if 'description' in b:
            desc=b['description']
            if desc is not None and (not isinstance(desc,str) or js_length(desc)>2000):
                return core.j({'error':'invalid_input'},400)
            updates['description']=desc
            if 'topic' not in b and isinstance(desc,str):
                updates['topic']=desc[:500]
        if 'scheduledAt' in b:
            sch=b['scheduledAt']
            if not isinstance(sch,str) or not sch:
                return core.j({'error':'invalid_input'},400)
            try:
                updates['scheduled_at']=datetime.fromisoformat(sch.replace('Z','+00:00'))
            except ValueError:
                return core.j({'error':'invalid_input'},400)
        if 'durationMinutes' in b:
            try:
                dur=float(b['durationMinutes'])
            except (ValueError,TypeError,OverflowError):
                return core.j({'error':'invalid_input'},400)
            if not dur.is_integer() or not 15<=int(dur)<=240:
                return core.j({'error':'invalid_input'},400)
            updates['duration_minutes']=int(dur)
        if 'recordingDurationSeconds' in b:
            rds=b['recordingDurationSeconds']
            if rds is not None:
                if type(rds) is not int or not 1<=rds<=86400:
                    return core.j({'error':'invalid_input'},400)
            updates['recording_duration_seconds']=rds
        if 'meetingUrl' in b:
            m_url=b['meetingUrl']
            if m_url is not None and m_url!='' and (not isinstance(m_url,str) or not valid_url(m_url)):
                return core.j({'error':'invalid_input'},400)
            if m_url:
                updates['meeting_url']=m_url
                yt_from_m,_=extract_youtube_video_id(m_url)
                if yt_from_m and 'youtubeUrl' not in b and 'youtubeVideoId' not in b:
                    updates['youtube_video_id']=yt_from_m
        if 'recordingUrl' in b:
            r_url=b['recordingUrl']
            if r_url is not None and r_url!='' and (not isinstance(r_url,str) or not valid_url(r_url)):
                return core.j({'error':'invalid_input'},400)
            if r_url:
                updates['recording_url']=r_url
                yt_from_r,_=extract_youtube_video_id(r_url)
                if yt_from_r and 'youtubeUrl' not in b and 'youtubeVideoId' not in b and not existing.get('youtube_video_id'):
                    updates['youtube_video_id']=yt_from_r
        if 'youtubeUrl' in b or 'youtubeVideoId' in b:
            raw_yt=b.get('youtubeUrl') if 'youtubeUrl' in b else b.get('youtubeVideoId')
            if raw_yt in (None,''):
                updates['youtube_video_id']=None
            else:
                vid,yt_err=extract_youtube_video_id(raw_yt)
                if yt_err:
                    return core.j({'error':yt_err},400)
                updates['youtube_video_id']=vid

        has_yt=bool(updates.get('youtube_video_id',existing.get('youtube_video_id')))
        has_rec_url=bool(updates.get('recording_url',existing.get('recording_url')))

        if 'status' in b or 'recordingStatus' in b:
            req_st=b.get('status')
            req_rec=b.get('recordingStatus')
            if req_st is not None and not isinstance(req_st,str):
                return core.j({'error':'invalid_input'},400)
            if req_rec is not None and not isinstance(req_rec,str):
                return core.j({'error':'invalid_input'},400)
            mapped=map_requested_status_transition(
                req_st,
                req_rec,
                existing['status'],
                existing.get('recording_status') or 'none',
                has_yt,
            )
            if mapped is None:
                return core.j({'error':'invalid_input'},400)
            next_status,next_rec_status=mapped
            if next_rec_status=='ready' and not has_yt and not has_rec_url:
                return core.j({'error':'youtube_video_required'},400)
            updates['status']=next_status
            updates['recording_status']=next_rec_status
            now_utc=datetime.now(timezone.utc)
            if next_status=='live' and not existing.get('started_at'):
                updates['started_at']=now_utc
            if next_status in ('completed','recorded') and existing['status']=='live' and not existing.get('ended_at'):
                updates['ended_at']=now_utc

        if 'accessScope' in b:
            asc=b['accessScope']
            if asc not in ACCESS_SCOPES:
                return core.j({'error':'invalid_input'},400)
            updates['access_scope']=asc

        student_ids=b.get('studentIds') if 'studentIds' in b else None
        clean_student_ids=None
        if student_ids is not None:
            if not isinstance(student_ids,list) or len(student_ids)>500 or any(not is_js_uuid(str(x)) for x in student_ids):
                return core.j({'error':'invalid_input'},400)
            clean_student_ids=list(dict.fromkeys(str(x).lower() for x in student_ids))
            if clean_student_ids:
                if u['role']!='owner':
                    valid_rows=await conn.fetch(
                        '''SELECT u.id FROM users u
                           JOIN teacher_student_links l ON l.student_user_id=u.id
                           WHERE l.teacher_user_id=$1 AND u.role='student' AND u.id=ANY($2::uuid[])''',
                        u['id'],[_uuid.UUID(s) for s in clean_student_ids])
                else:
                    valid_rows=await conn.fetch(
                        "SELECT id FROM users WHERE role='student' AND id=ANY($1::uuid[])",
                        [_uuid.UUID(s) for s in clean_student_ids])
                if len(valid_rows)!=len(clean_student_ids):
                    return core.j({'error':'invalid_student_assignment'},400)

        if not updates and clean_student_ids is None:
            return core.j({'error':'invalid_input'},400)

        updates['updated_at']=datetime.now(timezone.utc)
        fields=list(updates)
        clause=', '.join(f'{k}=${i+2}' for i,k in enumerate(fields))
        args=[_uuid.UUID(id)]+[updates[k] for k in fields]
        updated_row=await conn.fetchrow(f'UPDATE live_classes SET {clause} WHERE id=$1 RETURNING *',*args)
        if clean_student_ids is not None:
            await conn.execute('DELETE FROM live_class_enrollments WHERE live_class_id=$1',_uuid.UUID(id))
            for sid in clean_student_ids:
                await conn.execute(
                    '''INSERT INTO live_class_enrollments(live_class_id,user_id,assigned_by_user_id)
                       VALUES($1,$2,$3) ON CONFLICT(live_class_id,user_id) DO NOTHING''',
                    _uuid.UUID(id),_uuid.UUID(sid),u['id'])
        if clean_student_ids is not None or 'access_scope' in updates:
            await chat_bus.broadcast(conn, id, {'type': '_access_recheck', 'classId': id})
            access_bus.notify()

        if updated_row and ('status' in updates or 'recording_status' in updates):
            st=updated_row['status']
            rec=updated_row.get('recording_status') or 'none'
            await chat_bus.broadcast(conn,id,{
                'type':'class_status',
                'classId':id,
                'status':st,
                'recordingStatus':rec,
                'lifecycleStatus':compute_lifecycle_status(st,rec),
                'chatReadOnly':st!='live',
            })
    return core.j({'ok':True})

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
            result=await _delete_material(conn,user,'listening',id)
    if result=='deleted':return core.j({'ok':True,'action':result,'resultsPreserved':True})
    return core.j({'error':result},403 if result=='forbidden' else 404)

def install():core.app.include_router(router)
