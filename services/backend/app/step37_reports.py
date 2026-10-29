"""RIWI Reporter GET with role-scoped provenance SQL, exact half-open windows,
read+render+two required audit records. Source: lib/reporter/{service,access,
roster,period,snapshot,exports}.ts and /api/reports/route.ts.
"""
from __future__ import annotations
import json,re,math,uuid
from datetime import datetime,date,timedelta,timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.parse import quote
from fastapi import APIRouter,Request
from fastapi.responses import Response,RedirectResponse
from . import main as core
from .step37_report_exports import CONTENT_TYPES,render,sha,snap_hash,metric_value

router=APIRouter(); TZ=ZoneInfo('Asia/Tashkent')
UUID=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',re.I)
SPECS=json.loads((Path(__file__).parent/'report_metric_specs.json').read_text())
LEARNERS={'student':'user_id = :subject','teacher':'user_id in (select l.student_user_id from teacher_student_links l join users u on u.id = l.student_user_id where l.teacher_user_id = :teacher and u.role = \'student\')',
          'all':"user_id in (select id from users where role = 'student')"}
def stamp(d):return d.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def input_ok(p):
    required=('scope','period','format')
    if any(p.get(k) is None or p[k] not in {'scope':('owner','teacher','student','operations'),'period':('on_demand','weekly','monthly','yearly','custom'),'format':tuple(CONTENT_TYPES)}.get(k,()) for k in required):return False
    if p.get('lang','uz') not in ('en','uz'):return False
    for k,n in (('subject',64),('from',10),('to',10)):
        if k in p and len(p[k].strip())>n:return False
    return True
def period_window(kind,now,frm=None,to=None):
    today=now.astimezone(TZ).date()
    if kind=='on_demand':start=today-timedelta(days=29);end=today; instant=now
    elif kind=='weekly':start=today-timedelta(days=today.weekday()+7);end=start+timedelta(days=6);instant=None
    elif kind=='monthly':
        end=today.replace(day=1)-timedelta(days=1);start=end.replace(day=1);instant=None
    elif kind=='yearly':start=date(today.year-1,1,1);end=date(today.year-1,12,31);instant=None
    else:
        try:
            if not frm or not to or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',frm) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',to):return 'invalid_date'
            start=date.fromisoformat(frm);end=date.fromisoformat(to)
        except ValueError:return 'invalid_date'
        if start>end:return 'range_reversed'
        if end>today:return 'range_in_future'
        if (end-start).days+1>366:return 'range_too_long'
        instant=None
    first=datetime(start.year,start.month,start.day,tzinfo=TZ)
    following=end+timedelta(days=1)
    last=datetime(following.year,following.month,following.day,tzinfo=TZ)
    return {'kind':kind,'timezone':'Asia/Tashkent','from':stamp(first),'to':stamp(instant or last),'fromDate':start.isoformat(),'toDate':end.isoformat()}
async def authorize(con,user,p):
    role=user['role'];kind=p['scope'];sid=p.get('subject')
    if kind=='owner':return {'kind':'owner'} if role=='owner' else 403
    if kind=='operations':return {'kind':'operations'} if role in ('admin','owner') else 403
    if kind=='teacher':
        if role=='owner':return {'kind':'teacher','teacherId':None}
        if role=='teacher':return {'kind':'teacher','teacherId':str(user['id'])}
        return 403
    if role=='student':
        if sid and sid!=str(user['id']):return 404
        return {'kind':'student','subjectId':str(user['id']),'subjectName':user['name']}
    if role not in ('owner','teacher'):return 403
    if not sid or not UUID.fullmatch(sid):return 404
    row=await con.fetchrow('SELECT id,role,name FROM users WHERE id=$1',uuid.UUID(sid))
    if not row or row['role']!='student':return 404
    if role=='teacher':
        try:visible=await con.fetchrow("select 1 as v from teacher_student_links l join users u on u.id = l.student_user_id where l.teacher_user_id = $1::uuid and l.student_user_id = $2::uuid and u.role = 'student' limit 1",user['id'],uuid.UUID(sid))
        except Exception:visible=None
        if not visible:return 404
    return {'kind':'student','subjectId':str(row['id']),'subjectName':row['name']}
def specs_for(scope):
    kind=scope['kind']
    if kind=='operations':return [{**s,'compiledText':s['sql']} for s in SPECS['operations']]
    roster=kind=='teacher' and scope['teacherId'] is not None
    learner=LEARNERS['student' if kind=='student' else 'teacher' if roster else 'all']
    base=[{**s,'compiledText':s['sql'].replace('{{LEARNERS}}',learner)} for s in SPECS['learner']]
    if kind=='student':return base
    if roster:return [{**s,'compiledText':s['sql']} for s in SPECS['roster']]+base
    other=SPECS['cohort']+(SPECS['owner']+SPECS['operations'] if kind=='owner' else [])
    return [{**s,'compiledText':s['sql']} for s in other]+base
def scope_label(s):
    if s['kind']=='student':return 'student:'+s['subjectId']
    if s['kind']=='teacher':return ('teacher:'+s['teacherId']+':assigned') if s['teacherId'] else 'teacher:all-students'
    if s['kind']=='operations':return 'operations:centre'
    return 'owner:centre'
def compile_sql(sql,period,scope):
    # :from :to are bound as timestamptz; :subject :teacher are bound as uuid.
    args=[];values={'from':period['from'],'to':period['to'],'subject':scope.get('subjectId'),'teacher':scope.get('teacherId')}
    def repl(m):
        key=m.group()[1:]
        if key not in ('from','to') and not values[key]:raise ValueError('missing UUID parameter')
        args.append(values[key]);return f'${len(args)}::'+('timestamptz' if key in ('from','to') else 'uuid')
    query=re.sub(r':(?:from|to|subject|teacher)\b',repl,sql)
    return query,args
async def snapshot(con,scope,period,actor,now):
    generated=stamp(now);label=scope_label(scope);metrics=[]
    for spec in specs_for(scope):
        sql=spec['compiledText'];query,args=compile_sql(sql,period,scope)
        row=await con.fetchrow(query,*args)
        raw=row['v'] if row else None
        try:value=float(raw) if raw is not None else None
        except (TypeError,ValueError):value=None
        if value is not None and not math.isfinite(value):value=None
        if value is not None and value.is_integer():value=int(value)
        params={'from':period['from'],'to':period['to']}
        if scope.get('subjectId') and ':subject' in sql:params['subject']=scope['subjectId']
        if scope.get('teacherId') and ':teacher' in sql:params['teacher']=scope['teacherId']
        metrics.append({'key':spec['key'],'section':spec['section'],'label':spec['label'],'unit':spec['unit'],'value':value,
         'source':{'queryId':'riwi.'+spec['key'],'sql':sql,'parameters':params},
         'window':{'from':period['from'],'to':period['to'],'basis':spec.get('basis','window')},'scope':label,'generatedAt':generated})
    result={'schemaVersion':'riwi-report/1','reportId':str(uuid.uuid4()),'generatedAt':generated,'generatedBy':{'userId':str(actor['id']),'role':actor['role']},
       'timezone':period['timezone'],'period':period,'scope':scope,'metrics':metrics,'narrative':{'source':'deterministic','en':[],'uz':[]}}
    lines=[('learners.active','{v} learner(s) were active in this period.',"Bu davrda {v} ta o'quvchi faol bo'ldi."),
       ('reading.completed','{v} Reading attempt(s) were completed.','{v} ta Reading urinishi yakunlandi.'),
       ('listening.completed','{v} Listening attempt(s) were completed.','{v} ta Listening urinishi yakunlandi.'),
       ('writing.submitted','{v} Writing essay(s) were submitted.','{v} ta Writing inshosi topshirildi.'),
       ('speaking.submitted','{v} Speaking recording(s) were submitted.','{v} ta Speaking yozuvi topshirildi.'),
       ('retention.completed','{v} Retention text(s) were completed.','{v} ta Retention matni yakunlandi.')]
    by_key={m['key']:m for m in metrics}
    for key,en,uz in lines:
        m=by_key.get(key)
        if m and m['value'] is not None:
            v=metric_value(m);result['narrative']['en'].append(en.format(v=v));result['narrative']['uz'].append(uz.format(v=v))
    if scope['kind']=='operations':
        result['narrative']['en'].append('This report contains centre-operation metrics only; it does not include learner-level academic records.')
        result['narrative']['uz'].append("Bu hisobotda faqat markaz operatsiyalari ko'rsatkichlari bor; talaba darajasidagi o'quv yozuvlari kiritilmagan.")
    elif not result['narrative']['en']:
        result['narrative']['en'].append('No recorded activity in this period.')
        result['narrative']['uz'].append("Bu davrda qayd etilgan faollik yo'q.")
    return result
async def audit(con,user,action,target,meta):
    await con.execute('INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata) VALUES($1,$2,\'report\',$3,$4::jsonb)',user['id'],action,target,json.dumps(meta,ensure_ascii=False,separators=(',',':')))
@router.get('/api/reports')
async def reports(req:Request):
    actor=await core.current_user(req,active=True)
    if not actor:return core.j({'error':{'code':'unauthorized'}},401)
    p={k:req.query_params[k] for k in ('scope','subject','period','from','to','format','lang') if req.query_params.get(k)}
    def failure(code,status):
        if req.query_params.get('ui')=='1':return RedirectResponse('/app/reports?error='+quote(code,safe=''),status_code=303,headers={'Cache-Control':'no-store'})
        return core.j({'error':{'code':code}},status,{'Cache-Control':'no-store'})
    if not input_ok(p):return failure('invalid_input',400)
    db=await core.pool()
    async with db.acquire() as con:
        access=await authorize(con,actor,p)
        if isinstance(access,int):return failure('forbidden' if access==403 else 'not_found',access)
        now=datetime.now(timezone.utc);period=period_window(p['period'],now,p.get('from'),p.get('to'))
        if isinstance(period,str):return failure(period,400)
        try:
            s=await snapshot(con,access,period,actor,now)
        except Exception:return failure('generation_failed',503)
        fmt=p['format'];lang=p.get('lang','uz')
        # The source intentionally handles snapshot construction errors, but rendering
        # is deterministic and should never be replaced by a stub/mock response.
        try:data=await core.run_blocking(render,s,fmt,lang)
        except core.WorkBusy:
            response=failure('generation_failed',503)
            response.headers['Retry-After']='1'
            return response
        except Exception:return failure('generation_failed',503)
        common={'reportId':s['reportId'],'scope':access['kind'],'period':period['kind'],'from':period['from'],'to':period['to'],'timezone':s['timezone']}
        target=access['subjectId'] if access['kind']=='student' else access['kind']
        try:
            await audit(con,actor,'report.generated',target,{**common,'snapshotSha256':snap_hash(s),'metrics':len(s['metrics']),'schemaVersion':s['schemaVersion'],
                'filters':{'subject':access.get('subjectId') if access['kind']=='student' else None,'roster':access.get('teacherId') if access['kind']=='teacher' else None},
                'aiNarrative':{'used':False,'providerId':None,'model':None,'fallbackUsed':False}})
            await audit(con,actor,'report.downloaded',target,{**common,'format':fmt,'lang':lang,'bytes':len(data),'sha256':sha(data)})
        except Exception:return failure('generation_failed',503)
    filename=f'riwi-report-{access["kind"]}-{period["fromDate"]}_{period["toDate"]}.{fmt}'
    return Response(content=data,media_type=CONTENT_TYPES[fmt],headers={
       'Content-Disposition':f'attachment; filename="{filename}"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Report-Id':s['reportId']})
def install():core.app.include_router(router)
