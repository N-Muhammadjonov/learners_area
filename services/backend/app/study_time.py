"""Server-clock study accounting. Presence and client durations are never inputs."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from uuid import UUID
from fastapi import APIRouter, Request, HTTPException
from . import main as core

router=APIRouter()
MODULES=('reading','listening','writing','speaking','vocabulary','grammar','video','mocks','courses')

async def subject(con,user,raw=None,*,allow_admin=False):
    sid=core.uuid_value(raw) if raw else user['id']
    if not sid: raise HTTPException(400,'invalid_student')
    if user['role']=='student':
        if str(sid)!=str(user['id']):raise HTTPException(404,'not_found')
    elif user['role']=='teacher':
        if not await con.fetchval('SELECT 1 FROM teacher_student_links WHERE teacher_user_id=$1 AND student_user_id=$2',user['id'],sid):raise HTTPException(404,'not_found')
    elif user['role']!='owner' and not (allow_admin and user['role']=='admin'):raise HTTPException(403,'forbidden')
    if not await con.fetchval("SELECT 1 FROM users WHERE id=$1 AND role='student'",sid):raise HTTPException(404,'not_found')
    return sid

async def heartbeat(con,user,body):
    if user['role']!='student':raise HTTPException(403,'forbidden')
    if not isinstance(body,dict) or set(body)-{'action','module','sessionId','sequence','active'}:raise HTTPException(400,'invalid_input')
    action=body.get('action');active=body.get('active',False)
    if action not in ('start','heartbeat','end') or type(active)!=bool:raise HTTPException(400,'invalid_input')
    async with con.transaction():
        await con.execute("SELECT pg_advisory_xact_lock(hashtextextended('active-study:'||$1::text,0))",user['id'])
        now=await con.fetchval('SELECT clock_timestamp()')
        if action=='start':
            if body.get('module') not in MODULES:raise HTTPException(400,'invalid_module')
            # Always anchor with zero credit; first activity only arms the next interval.
            sid=await con.fetchval('INSERT INTO study_sessions(user_id,module,last_at) VALUES($1,$2,$3) RETURNING id',user['id'],body['module'],now)
            return {'sessionId':str(sid),'sequence':0,'creditedSeconds':0}
        sid=core.uuid_value(body.get('sessionId'));seq=body.get('sequence')
        if not sid or type(seq)!=int or not 1<=seq<=10000000:raise HTTPException(400,'invalid_input')
        row=await con.fetchrow('SELECT * FROM study_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE',sid,user['id'])
        if not row:raise HTTPException(404,'not_found')
        if seq<=row['last_sequence']:return {'sessionId':str(sid),'sequence':row['last_sequence'],'creditedSeconds':0}
        if row['closed'] or (now-row['last_at']).total_seconds()>43200:raise HTTPException(410,'session_closed')
        seconds=0
        elapsed=(now-row['last_at']).total_seconds()
        if row['active'] and 0<elapsed<=45:
            last=await con.fetchval('SELECT max(ended_at) FROM study_intervals WHERE user_id=$1',user['id'])
            start=max(row['last_at'],last) if last else row['last_at']
            seconds=round(max(0,(now-start).total_seconds()),3)
            if seconds>0:
                await con.execute('INSERT INTO study_intervals(user_id,session_id,sequence,started_at,ended_at,seconds) VALUES($1,$2,$3,$4,$5,$6)',user['id'],sid,seq,start,now,seconds)
        await con.execute('UPDATE study_sessions SET last_at=$3,last_sequence=$4,active=$5,closed=$6 WHERE id=$1 AND user_id=$2',sid,user['id'],now,seq,active and action!='end',action=='end')
        return {'sessionId':str(sid),'sequence':seq,'creditedSeconds':seconds}

async def weekly(con,user,q):
    sid=await subject(con,user,q.get('student'),allow_admin=True)
    today=datetime.now(ZoneInfo('Asia/Tashkent')).date();current=today-timedelta(days=(today.weekday()+1)%7)
    try:start=date.fromisoformat(q['week']) if q.get('week') else current
    except (ValueError,TypeError):raise HTTPException(400,'invalid_week')
    if start.weekday()!=6 or start>current or start<current-timedelta(days=3660):raise HTTPException(400,'invalid_week')
    rows=await con.fetch("""WITH days AS (SELECT d::date AS day FROM generate_series($2::date,($2::date+6)::date,interval '1 day') d)
      SELECT day,COALESCE(sum(CASE WHEN i.id IS NULL THEN 0 ELSE GREATEST(0,extract(epoch FROM LEAST(i.ended_at,((day+1)::timestamp AT TIME ZONE 'Asia/Tashkent'))-
        GREATEST(i.started_at,(day::timestamp AT TIME ZONE 'Asia/Tashkent')))) END),0)::float8 AS seconds
      FROM days LEFT JOIN study_intervals i ON i.user_id=$1
       AND i.started_at<((day+1)::timestamp AT TIME ZONE 'Asia/Tashkent') AND i.ended_at>(day::timestamp AT TIME ZONE 'Asia/Tashkent')
      GROUP BY day ORDER BY day""",sid,start)
    days=[{'date':r['day'].isoformat(),'seconds':int(r['seconds'])} for r in rows]
    return {'studentId':str(sid),'timezone':'Asia/Tashkent','week':start.isoformat(),'currentWeek':current.isoformat(),'days':days,'totalSeconds':sum(x['seconds'] for x in days)}

@router.post('/api/study-time')
async def post(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    try:
        db=await core.pool()
        async with db.acquire() as con:result=await heartbeat(con,user,await core.payload(req))
        return core.j(result,headers=core.PRIVATE)
    except HTTPException as e:return core.j({'error':e.detail},e.status_code,core.PRIVATE)

def install():core.app.include_router(router)
