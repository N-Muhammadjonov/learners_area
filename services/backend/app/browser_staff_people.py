"""Administration and teacher reads. Teacher scopes come only from explicit rosters."""
import math
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, identifier, number
from .browser_activity import mocks
from .browser_writing import evaluation
from .browser_reading import re_escape_like


async def student(con, user, id):
    if user.get('role') not in ('teacher','owner'): raise HTTPException(403,'forbidden')
    row = await con.fetchrow("SELECT id,name,email FROM users WHERE id=$1 AND role='student'",id)
    if not row or user['role']=='teacher' and not await con.fetchval('SELECT 1 FROM teacher_student_links WHERE teacher_user_id=$1 AND student_user_id=$2',user['id'],id):
        raise HTTPException(404,'not_found')
    return camel(row)


async def results(con, id):
    data = await mocks(con,id)
    practice = {}
    for key,table in (('reading','reading_attempts'),('listening','listening_attempts'),('speaking','speaking_attempts'),('writing','writing_submissions')):
        practice[key] = await con.fetchval(f'SELECT count(*)::int FROM {table} WHERE user_id=$1',id)
    return {'unavailable':False,'testIds':[r['id'] for r in data['tests']],'attempts':data['attempts'],
      'attemptsTruncated':data.get('attemptsTruncated',False),'practice':practice}


async def students(con, user, query='', reporter=False):
    args = []
    conds = ["u.role='student'"]
    if user['role']=='teacher':
        args.append(user['id']);conds.append('EXISTS(SELECT 1 FROM teacher_student_links t WHERE t.student_user_id=u.id AND t.teacher_user_id=$1)')
    elif query:
        args.append('%'+re_escape_like(query)+'%');conds.append(f'u.name ILIKE ${len(args)}')
    cap = 500 if user['role']=='teacher' and reporter else 1000 if reporter else 5000
    return [camel(r) for r in await con.fetch('SELECT u.id,u.name,u.email,u.onboarding_completed_at FROM users u WHERE '+' AND '.join(conds)+f' ORDER BY u.name,u.id LIMIT {cap}',*args)]


async def reporter(con, user, q):
    query = q.get('q','').strip()[:60]
    scopes = {'owner':['owner','teacher','student','operations'],'admin':['operations'],'teacher':['teacher','student'],'student':['student']}[user['role']]
    can_choose_student = user['role'] in ('owner','teacher')
    return {'reporter':{'query':query,'scopes':scopes,'students':[{k:r[k] for k in ('id','name')} for r in await students(con,user,query,True)] if can_choose_student else []}}


async def teacher_student_detail(con,req,user,id,q=None):
    from .browser_common import number
    from .browser_writing import evaluation_result,read as writing_read
    q=q or {}
    person=await student(con,user,id)
    result=await results(con,id)
    total=await con.fetchval('SELECT count(*)::int FROM writing_submissions WHERE user_id=$1',id)
    pages=max(1,math.ceil((total or 0)/25))
    target=identifier(q['submission']) if q.get('submission') else None
    page=1 if target else min(number(q.get('writingPage')),pages)
    if target and not await con.fetchval('SELECT EXISTS(SELECT 1 FROM writing_submissions WHERE id=$1 AND user_id=$2)',target,id):
        raise HTTPException(404,'not_found')
    offset=(page-1)*25
    rows=await con.fetch('''SELECT s.id,s.status,s.content,p.category,s.updated_at FROM writing_submissions s
      JOIN writing_prompts p ON p.id=s.prompt_id WHERE s.user_id=$1
      ORDER BY CASE WHEN $2::uuid IS NOT NULL AND s.id=$2::uuid THEN 0 ELSE 1 END,s.updated_at DESC,s.id DESC
      LIMIT 25 OFFSET $3''',id,target,offset)
    submission_ids=[r['id'] for r in rows]
    evaluations={};feedback_by_submission={}
    if submission_ids:
        eval_rows=await con.fetch('''SELECT * FROM evaluations WHERE source_type='writing_submission' AND user_id=$1
          AND source_id=ANY($2::uuid[]) ORDER BY created_at DESC,id DESC''',id,submission_ids)
        for evrow in eval_rows:
            key=str(evrow['source_id'])
            if key in evaluations:continue
            ev=evaluation_result(evrow)
            if ev:
                provider=evrow['provider_display_name'] or ev['checkedByName']
                ev['provenanceLabel']=provider+(' (fallback)' if evrow['fallback_used'] else '')
            evaluations[key]=ev
        feedback_rows=await con.fetch('''SELECT id,submission_id,source,overall_band,comment FROM writing_feedback
          WHERE submission_id=ANY($1::uuid[]) ORDER BY created_at DESC,id DESC''',submission_ids)
        for feedback in feedback_rows:
            feedback_by_submission.setdefault(str(feedback['submission_id']),[]).append(camel(feedback))
    submissions=[{**camel(row),'evaluation':evaluations.get(str(row['id'])),'feedback':feedback_by_submission.get(str(row['id']),[])} for row in rows]
    activation=await writing_read(req,{**user,'id':id},'/app/writing',{'tab':'activation'},None)
    overview=activation['overview']
    if overview['lastSession']: overview['lastSession']=overview['lastSession']['stats']
    prompts=[camel(r) for r in await con.fetch("SELECT id,left(prompt,280) label FROM writing_prompts WHERE publication_state='published' ORDER BY created_at DESC LIMIT 1000")]
    return {'student':person,'results':result,'activation':overview,'submissions':submissions,'submissionsPage':page,
      'submissionsPages':pages,'submissionsTotal':int(total or 0),'prompts':prompts}


async def read(req, user, kind, q):
    db = await core.pool()
    async with db.acquire() as con:
        if kind == 'admissions':
            pending = await con.fetch("""SELECT COALESCE(r.id,u.id) id,u.name applicant_name,u.email applicant_email,r.message,COALESCE(r.created_at,u.created_at) created_at
              FROM users u LEFT JOIN access_requests r ON r.user_id=u.id AND r.status='pending'
              WHERE u.account_status='pending' AND r.decided_at IS NULL ORDER BY u.created_at LIMIT 1000""")
            recent = await con.fetch("SELECT r.id,u.name applicant_name,r.decided_at FROM access_requests r JOIN users u ON u.id=r.user_id WHERE r.decided_at IS NOT NULL ORDER BY r.decided_at DESC LIMIT 10")
            return {'pending':[camel(r) for r in pending],'recent':[camel(r) for r in recent]}
        if kind == 'people':
            args,conds = [],[]
            query = q.get('q','').strip()[:100]
            role,status = q.get('role'),q.get('status')
            online_only = q.get('online')=='1'
            if role and role not in ('student','teacher','admin','owner'): raise HTTPException(400,'invalid_filter')
            if status and status not in ('pending','active','rejected','suspended'): raise HTTPException(400,'invalid_filter')
            if online_only and user['role']!='owner': raise HTTPException(403,'forbidden')
            online = "coalesce(a.created_at>now()-interval '90 seconds' AND u.account_status='active',false)"
            source = " FROM users u LEFT JOIN telegram_contacts tc ON tc.telegram_user_id=u.telegram_id AND (tc.linked_user_id IS NULL OR tc.linked_user_id=u.id)"
            if user['role']=='owner': source += " LEFT JOIN activity_events a ON a.id=md5('site-presence:'||u.id::text)::uuid AND a.type='SITE_PRESENCE'"
            if query:
                args.append('%'+re_escape_like(query.lstrip('@'))+'%')
                conds.append('(u.name ILIKE $1 OR u.email ILIKE $1 OR tc.username ILIKE $1)')
            for value,column in ((role,'u.role'),(status,'u.account_status')):
                if value: args.append(value);conds.append(f'{column}=${len(args)}')
            if not status:conds.append("u.account_status<>'rejected'")
            if online_only:conds.append(online)
            where = ' WHERE '+' AND '.join(conds) if conds else ''
            total = await con.fetchval('SELECT count(*)::int'+source+where,*args)
            online_count = await con.fetchval('SELECT count(*)::int'+source+' WHERE '+online) if user['role']=='owner' else None
            pages = max(1,math.ceil(total/25));page = min(pages,number(q.get('page'),maximum=100000))
            # Verified phone numbers and presence are visible to the owner only.
            phone = "CASE WHEN tc.phone_verified_at IS NOT NULL THEN tc.phone_number END" if user['role']=='owner' else 'NULL::text'
            if user['role']=='owner':
                last_active='u.last_active_at';presence=f"{online} AS online,a.created_at AS seen_at,(a.payload->>'visitSeconds')::int AS visit_seconds,(a.payload->>'totalSeconds')::bigint AS total_seconds";ordering=f"{online} DESC,coalesce(a.created_at,u.last_active_at) DESC,"
            else:
                last_active='NULL::timestamptz AS last_active_at';presence='NULL::boolean AS online,NULL::timestamptz AS seen_at,NULL::int AS visit_seconds,NULL::bigint AS total_seconds';ordering=''
            rows = await con.fetch(f"""SELECT u.id,u.name,u.email,u.role,u.account_status,u.status_reason,u.created_at,{last_active},
              u.telegram_id IS NOT NULL AS telegram_linked,tc.username,{phone} AS phone_number,{presence}"""+source+where+f" ORDER BY CASE u.role WHEN 'owner' THEN 0 WHEN 'teacher' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END,{ordering}u.id DESC LIMIT 25 OFFSET {(page-1)*25}",*args)
            return {'people':[camel(r) for r in rows],'filters':{'q':query,'role':role or None,'status':status or None,'online':online_only},'page':page,'pageSize':25,'total':total,'totalPages':pages,'onlineCount':online_count,'actorId':str(user['id']),'actorRole':user['role'],'grantableRoles':['student','teacher','admin','owner'] if user['role']=='owner' else ['student','teacher']}
        if kind == 'roster':
            teachers = [camel(r) for r in await con.fetch("SELECT id,name FROM users WHERE role='teacher' ORDER BY name,id LIMIT 1000")]
            selected = next((t for t in teachers if t['id']==q.get('teacher')),teachers[0] if teachers else None)
            query = q.get('q','').strip()[:60]
            roster = [camel(r) for r in await con.fetch('SELECT u.id,u.name FROM teacher_student_links t JOIN users u ON u.id=t.student_user_id WHERE t.teacher_user_id=$1 ORDER BY u.name,u.id LIMIT 500',selected['id'])] if selected else []
            candidates = [camel(r) for r in await con.fetch("SELECT id,name FROM users WHERE role='student' AND name ILIKE $1 ORDER BY name,id LIMIT 1000",'%'+re_escape_like(query)+'%')]
            return {'teachers':teachers,'selected':selected,'query':query,'roster':roster,'candidates':candidates,'listCap':1000,'rosterCap':500}
        if kind == 'teacher-students': return {'students':await students(con,user)}
        if kind=='student-results':
            id=identifier(q.get('id'));person=await student(con,user,id)
            return {'student':person,**await results(con,id)}
        if kind=='teacher-student':
            id=identifier(q.get('id'))
            return await teacher_student_detail(con,req,user,id,q)
        if kind == 'support-inbox':
            rows = await con.fetch('SELECT p.id,p.route,p.module,p.status,p.message,u.name reporter_name,p.created_at,p.viewport,p.last_error_code FROM problem_reports p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 50')
            return {'reports':[camel(r) for r in rows]}
        if kind == 'teacher-live-classes':
            scope = 'WHERE l.teacher_user_id=$1' if user['role']=='teacher' else ''
            rows = await con.fetch(f'''SELECT l.id,l.title,l.status,l.scheduled_at,l.duration_minutes,
              (SELECT count(*)::int FROM live_class_attendance a WHERE a.live_class_id=l.id) attendees
              FROM live_classes l {scope} ORDER BY l.scheduled_at DESC LIMIT 2000''',*([user['id']] if scope else []))
            return {'classes':[camel(r) for r in rows]}
        if kind == 'teacher-live-class':
            id = identifier(q.get('id'));row = await con.fetchrow('SELECT * FROM live_classes WHERE id=$1',id)
            if not row or user['role']=='teacher' and str(row['teacher_user_id'])!=str(user['id']): raise HTTPException(404,'not_found')
            now = datetime.now(timezone.utc);opens = row['scheduled_at']-timedelta(minutes=15)
            state = 'cancelled' if row['status']=='cancelled' else 'open' if row['status']=='live' else 'too_early' if now<opens else 'closed' if now>row['scheduled_at']+timedelta(minutes=row['duration_minutes']+30) else 'open'
            roster = [camel(r) for r in await con.fetch('SELECT u.name,u.email,a.joined_at FROM live_class_attendance a JOIN users u ON u.id=a.user_id WHERE a.live_class_id=$1 ORDER BY a.joined_at',id)]
            return {'liveClass':{**camel({k:row[k] for k in ('id','title','topic','status','scheduled_at','duration_minutes')}),'hasMeetingUrl':bool(row['meeting_url']),'hasRecordingUrl':bool(row['recording_url'])},'joinState':state,'opensAt':opens,'roster':roster}
    raise HTTPException(404,'not_found')
