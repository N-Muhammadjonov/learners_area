"""Live Partner state, presence, invites and signaling (Next.js data/live-partner.ts).

All state transitions lock rows inside a PostgreSQL transaction; user identity
always comes from the authenticated session. No browser-supplied identity is trusted.
"""
from __future__ import annotations
import base64,hashlib,hmac,json,os,re,time
from datetime import datetime,timezone,timedelta
from urllib.parse import urlsplit,urlunsplit
import httpx
from fastapi import APIRouter,Request
from . import main as core
from . import live_partner_features as features
from .step23_typing import b64

router=APIRouter()
H={'Cache-Control':'private, no-store'}
FRESH=timedelta(seconds=45)
GRACE=timedelta(seconds=60)
CONNECT=timedelta(seconds=45)
INVITE=timedelta(seconds=30)
ERR={'rules_outdated':409,'rules_required':409,'not_eligible':403,'profile_incomplete':409,'in_call':409,'not_available':409,'partner_busy':409,'invalid_target':400,'invite_not_found':404,'invite_closed':409,'session_not_found':404,'session_ended':409}
ERR.update(activity_changed=409,activity_in_progress=409,activity_question_missing=404,session_not_finished=409)
RULES_VERSION=1
class PartnerError(Exception):
    def __init__(self,code):self.code=code

def iso(dt):return dt.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z') if dt else None

def fresh(at,now):return at is not None and now-at<FRESH

def valid_input(b):
    if not isinstance(b,dict) or not isinstance(b.get('action'),str):return False
    action=b['action'];plain={'go_online','go_offline','heartbeat','practice_started'}
    if action in plain:return True
    if action in features.ACTIONS:return features.valid(b)
    spec={'accept_rules':('version',),'invite':('toUserId',),'accept':('inviteId',),'decline':('inviteId',),'cancel':('inviteId',),'connection':('sessionId','status'),'hangup':('sessionId',),'block':('userId',),'signal_token':('sessionId',)}
    if action not in spec or not {'action',*spec[action]}.issubset(b):return False
    if action=='accept_rules':return type(b['version']) is int
    if action=='connection' and b.get('status') not in ('connected','reconnecting'):return False
    return all(core.uuid_value(b[k]) is not None for k in spec[action] if k not in ('status','version'))

async def lock_presence(con,ids,now):
    ids=sorted(set(ids))
    for uid in ids:
        await con.execute('INSERT INTO live_partner_presence (user_id,state,updated_at) VALUES ($1,\'offline\',$2) ON CONFLICT DO NOTHING',uid,now)
    rows=await con.fetch('SELECT * FROM live_partner_presence WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR UPDATE',ids)
    return {str(r['user_id']):dict(r) for r in rows}

async def change_state(con,uid,state,now,session=None):
    await con.execute('UPDATE live_partner_presence SET state=$2,session_id=$3,updated_at=$4 WHERE user_id=$1',uid,state,session,now)

async def release(con,uid,at,now):await change_state(con,uid,'available' if fresh(at,now) else 'offline',now)

async def end_session(con,sid,now,reason):
    session=await con.fetchrow('SELECT * FROM live_partner_sessions WHERE id=$1 FOR UPDATE',sid)
    if not session or session['ended_at']:return session
    pair=await lock_presence(con,[str(session['user_a']),str(session['user_b'])],now)
    await con.execute('UPDATE live_partner_sessions SET ended_at=$2,end_reason=$3,connection_outcome=$4 WHERE id=$1',sid,now,reason,'connected' if session['connected_at'] else 'never_connected')
    for uid in (str(session['user_a']),str(session['user_b'])):
        p=pair[uid]
        if p['session_id'] and str(p['session_id'])==str(sid):await release(con,uid,p['heartbeat_at'],now)
    return session

async def sweep(con,now):
    expired=await con.fetch('''UPDATE live_partner_invites SET status='expired',responded_at=$1 WHERE status='pending' AND expires_at<$1 RETURNING from_user_id,to_user_id''',now)
    for inv in expired:
        a,b=str(inv['from_user_id']),str(inv['to_user_id'])
        rows=await lock_presence(con,[a,b],now)
        for uid in (a,b):
            if rows[uid]['state'] in ('outgoing_invite','incoming_invite'):await release(con,uid,rows[uid]['heartbeat_at'],now)
    stale=await con.fetch('''SELECT s.id FROM live_partner_sessions s JOIN live_partner_presence pa ON pa.user_id=s.user_a JOIN live_partner_presence pb ON pb.user_id=s.user_b WHERE s.ended_at IS NULL AND (pa.heartbeat_at<$1 OR pb.heartbeat_at<$1 OR pa.heartbeat_at IS NULL OR pb.heartbeat_at IS NULL)''',now-GRACE)
    for row in stale:await end_session(con,row['id'],now,'reconnect_timeout')
    stuck=await con.fetch('''SELECT s.id, CASE WHEN s.connected_at IS NULL THEN 'connect_timeout' ELSE 'reconnect_timeout' END AS reason FROM live_partner_sessions s WHERE s.ended_at IS NULL AND ((s.connected_at IS NULL AND s.started_at<$1) OR EXISTS (SELECT 1 FROM live_partner_presence p WHERE p.session_id=s.id AND p.state='reconnecting' AND p.updated_at<$2))''',now-CONNECT,now-GRACE)
    for row in stuck:await end_session(con,row['id'],now,row['reason'])

async def scores(con,ids):
    if not ids:return {}
    rows=await con.fetch('''SELECT DISTINCT ON (user_id) user_id,overall_estimate FROM evaluations WHERE user_id=ANY($1::uuid[]) AND source_type='speaking_attempt' AND overall_estimate IS NOT NULL ORDER BY user_id,created_at DESC''',ids)
    return {str(r['user_id']):float(r['overall_estimate']) for r in rows}

async def photos(con,ids):
    if not ids or not await con.fetchval("SELECT to_regclass('public.user_profile_photos')"):return set()
    rows=await con.fetch('''SELECT p.user_id FROM user_profile_photos p JOIN users u ON u.id=p.user_id WHERE u.account_status='active' AND p.user_id=ANY($1::uuid[])''',ids)
    return {str(r['user_id']) for r in rows}

async def online(con,viewer,now,extended=False):
    rows=await con.fetch('''SELECT u.id,u.name,u.gender,op.current_level FROM live_partner_presence p
      JOIN users u ON u.id=p.user_id LEFT JOIN onboarding_profiles op ON op.user_id=u.id
      WHERE p.state='available' AND p.heartbeat_at>=$1 AND u.account_status='active' AND u.id<>$2
      AND NOT EXISTS(SELECT 1 FROM live_partner_blocks b WHERE (b.blocker_id=$2 AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=$2))
      ORDER BY u.name,u.id LIMIT 100''',now-FRESH,viewer)
    ids=[str(r['id']) for r in rows]
    sc=await scores(con,ids);ph=await photos(con,ids)
    ratings={}
    if extended and ids:
        ratings={str(r['peer']):float(r['rating']) for r in await con.fetch('''SELECT
          CASE WHEN s.user_a=f.user_id THEN s.user_b ELSE s.user_a END AS peer, round(avg(f.rating),1) AS rating
          FROM live_partner_feedback f JOIN live_partner_sessions s ON s.id=f.session_id
          WHERE f.kind='rating' AND
            ((s.user_a=ANY($1::uuid[]) AND f.user_id=s.user_b) OR (s.user_b=ANY($1::uuid[]) AND f.user_id=s.user_a))
          GROUP BY 1''',ids)}
    return [{'userId':str(r['id']),'name':r['name'],'gender':r['gender'],'level':r.get('current_level'),
             'avatar':'b' if r['gender']=='female' else 'a','speakingScore':sc.get(str(r['id'])),
             'rating':ratings.get(str(r['id'])),'hasPhoto':str(r['id']) in ph} for r in rows]

async def ringing(con,uid,now):
    row=await con.fetchrow('''SELECT i.id,u.id AS sender,u.name,i.expires_at
      FROM live_partner_invites i JOIN users u ON u.id=i.from_user_id
      WHERE i.to_user_id=$1 AND i.status='pending' AND i.expires_at>$2 AND u.account_status='active'
      ORDER BY i.expires_at LIMIT 1''',uid,now)
    return {'id':str(row['id']),'from':{'userId':str(row['sender']),'name':row['name']},'expiresAt':iso(row['expires_at'])} if row else None

async def state(con,uid,now):
    row=await con.fetchrow('SELECT * FROM live_partner_presence WHERE user_id=$1',uid)
    incoming=await con.fetchrow('''SELECT i.id,i.from_user_id,u.name,u.gender,i.expires_at FROM live_partner_invites i JOIN users u ON u.id=i.from_user_id WHERE i.to_user_id=$1 AND i.status='pending' LIMIT 1''',uid)
    outgoing=await con.fetchrow('SELECT id,to_user_id,expires_at FROM live_partner_invites WHERE from_user_id=$1 AND status=\'pending\' LIMIT 1',uid)
    partner=None
    if row and row['session_id']:
        sess=await con.fetchrow('SELECT * FROM live_partner_sessions WHERE id=$1',row['session_id'])
        other=str(sess['user_b'] if str(sess['user_a'])==str(uid) else sess['user_a']) if sess else None
        if other:
            u=await con.fetchrow('SELECT name,gender FROM users WHERE id=$1',other)
            sc=await scores(con,[other]);ph=await photos(con,[other])
            partner={'userId':other,'name':u['name'] if u else '', 'avatar':'b' if u and u['gender']=='female' else 'a','speakingScore':sc.get(other),'hasPhoto':other in ph}
    ins=None
    if incoming:
        other=str(incoming['from_user_id']);sc=await scores(con,[other]);ph=await photos(con,[other])
        ins={'id':str(incoming['id']),'from':{'userId':other,'name':incoming['name'],'avatar':'b' if incoming['gender']=='female' else 'a','speakingScore':sc.get(other),'hasPhoto':other in ph},'expiresAt':iso(incoming['expires_at'])}
    out={'id':str(outgoing['id']),'toUserId':str(outgoing['to_user_id']),'expiresAt':iso(outgoing['expires_at'])} if outgoing else None
    st=row['state'] if row else 'offline'
    if st=='available' and not fresh(row['heartbeat_at'],now):st='offline'
    return {'state':st,'rulesAccepted':bool(row and row['rules_version']==RULES_VERSION),'sessionId':str(row['session_id']) if row and row['session_id'] else None,'partner':partner,'incoming':ins,'outgoing':out,'serverNow':iso(now)}

async def cancel_open(con,uid,now):
    old=await con.fetch("UPDATE live_partner_invites SET status='cancelled',responded_at=$2 WHERE status='pending' AND (from_user_id=$1 OR to_user_id=$1) RETURNING from_user_id,to_user_id",uid,now)
    for inv in old:
        other=str(inv['to_user_id'] if str(inv['from_user_id'])==str(uid) else inv['from_user_id'])
        row=(await lock_presence(con,[other],now))[other]
        if row['state'] in ('outgoing_invite','incoming_invite'):await release(con,other,row['heartbeat_at'],now)

async def session(con,uid,sid):
    s=await con.fetchrow('SELECT * FROM live_partner_sessions WHERE id=$1 FOR UPDATE',sid)
    if not s or uid not in (str(s['user_a']),str(s['user_b'])):raise PartnerError('session_not_found')
    return s

async def invite(con,uid,target,now,rows):
    sender,receiver=rows[uid],rows[target]
    if sender['state']!='available' or not fresh(sender['heartbeat_at'],now):raise PartnerError('not_available')
    if receiver['state']!='available' or not fresh(receiver['heartbeat_at'],now):raise PartnerError('partner_busy')
    blocked=await con.fetchval('SELECT 1 FROM live_partner_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1) LIMIT 1',uid,target)
    if blocked:raise PartnerError('partner_busy')
    await con.execute('INSERT INTO live_partner_invites(from_user_id,to_user_id,expires_at,created_at) VALUES($1,$2,$3,$4)',uid,target,now+INVITE,now)
    await change_state(con,uid,'outgoing_invite',now)
    await change_state(con,target,'incoming_invite',now)

async def perform(con,uid,b,now):
    action=b['action']
    if action=='accept_rules':
        if b['version']!=RULES_VERSION:raise PartnerError('rules_outdated')
        await lock_presence(con,[uid],now)
        await con.execute('UPDATE live_partner_presence SET rules_version=$2,rules_accepted_at=$3,updated_at=$3 WHERE user_id=$1',uid,RULES_VERSION,now)
    elif action=='go_online':
        await sweep(con,now)
        u=await con.fetchrow('SELECT account_status,gender FROM users WHERE id=$1',uid)
        if not u or u['account_status']!='active':raise PartnerError('not_eligible')
        if not u['gender']:raise PartnerError('profile_incomplete')
        row=(await lock_presence(con,[uid],now))[uid]
        if row['rules_version']!=RULES_VERSION:raise PartnerError('rules_required')
        if row['state'] in ('connecting','in_call','reconnecting'):raise PartnerError('in_call')
        if row['state']=='offline':await change_state(con,uid,'available',now)
        await con.execute('UPDATE live_partner_presence SET heartbeat_at=$2 WHERE user_id=$1',uid,now)
    elif action in ('go_offline','practice_started'):
        row=(await lock_presence(con,[uid],now))[uid]
        if row['state'] in ('connecting','in_call','reconnecting'):raise PartnerError('in_call')
        await cancel_open(con,uid,now)
        await change_state(con,uid,'offline',now)
    elif action=='heartbeat':
        await lock_presence(con,[uid],now)
        await con.execute("UPDATE live_partner_presence SET heartbeat_at=$2 WHERE user_id=$1 AND state<>'offline'",uid,now)
        await sweep(con,now)
    elif action=='invite':
        target=str(b['toUserId'])
        if target==uid:raise PartnerError('invalid_target')
        await sweep(con,now)
        rows=await lock_presence(con,[uid,target],now)
        await invite(con,uid,target,now,rows)
    elif action in ('accept','decline','cancel'):
        await sweep(con,now) if action=='accept' else None
        inv=await con.fetchrow('SELECT * FROM live_partner_invites WHERE id=$1 FOR UPDATE',str(b['inviteId']))
        owner=str(inv['to_user_id'] if action!='cancel' else inv['from_user_id']) if inv else None
        if not inv or owner!=uid:raise PartnerError('invite_not_found')
        if action=='accept':
            if inv['status']=='accepted':return
            if inv['status']!='pending':raise PartnerError('invite_closed')
            a,z=str(inv['from_user_id']),str(inv['to_user_id']);rows=await lock_presence(con,[a,z],now)
            if rows[a]['state']!='outgoing_invite' or rows[z]['state']!='incoming_invite' or not fresh(rows[a]['heartbeat_at'],now):
                await con.execute("UPDATE live_partner_invites SET status='cancelled',responded_at=$2 WHERE id=$1",inv['id'],now)
                if rows[z]['state']=='incoming_invite':await release(con,z,rows[z]['heartbeat_at'],now)
                raise PartnerError('partner_busy')
            await con.execute("UPDATE live_partner_invites SET status='accepted',responded_at=$2 WHERE id=$1",inv['id'],now)
            sid=await con.fetchval('INSERT INTO live_partner_sessions(invite_id,user_a,user_b,started_at) VALUES($1,$2,$3,$4) RETURNING id',inv['id'],a,z,now)
            await change_state(con,a,'connecting',now,sid);await change_state(con,z,'connecting',now,sid)
        elif inv['status']=='pending':
            a,z=str(inv['from_user_id']),str(inv['to_user_id']);rows=await lock_presence(con,[a,z],now)
            await con.execute('UPDATE live_partner_invites SET status=$2,responded_at=$3 WHERE id=$1',inv['id'],'declined' if action=='decline' else 'cancelled',now)
            for target in (a,z):
                if rows[target]['state'] in ('outgoing_invite','incoming_invite'):await release(con,target,rows[target]['heartbeat_at'],now)
    elif action=='connection':
        s=await session(con,uid,str(b['sessionId']))
        if s['ended_at']:raise PartnerError('session_ended')
        rows=await lock_presence(con,[str(s['user_a']),str(s['user_b'])],now)
        target='in_call' if b['status']=='connected' else 'reconnecting'
        if rows[uid]['state']==target:return
        if b['status']=='connected' and not s['connected_at']:await con.execute('UPDATE live_partner_sessions SET connected_at=$2 WHERE id=$1',s['id'],now)
        await change_state(con,uid,target,now,s['id'])
    elif action=='hangup':
        s=await session(con,uid,str(b['sessionId']))
        await end_session(con,s['id'],now,'hangup')
    elif action=='block':
        target=str(b['userId'])
        if target==uid:raise PartnerError('invalid_target')
        await con.execute('INSERT INTO live_partner_blocks(blocker_id,blocked_id,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',uid,target,now)
        await cancel_open(con,uid,now)

def turn_credentials(uid):
    urls=[x.strip() for x in os.getenv('LIVE_PARTNER_TURN_URLS','').split(',') if re.match(r'^turns?:[^\s]+$',x.strip())]
    sec=os.getenv('LIVE_PARTNER_TURN_SECRET','')
    if not urls or len(sec)<16:return None
    username=f'{int(time.time())+600}:{uid}'
    return {'iceServers':[{'urls':urls,'username':username,'credential':base64.b64encode(hmac.new(sec.encode(),username.encode(),'sha1').digest()).decode()}], 'iceTransportPolicy':'relay','expiresInSeconds':600}

async def readiness():
    url=os.getenv('LIVE_PARTNER_SIGNAL_URL','');sec=os.getenv('LIVE_PARTNER_SIGNAL_SECRET','')
    if len(sec)<32 or not url.startswith('wss://') or not turn_credentials('probe'):return {'ready':False,'reason':'not_configured'}
    p=urlsplit(url);health=urlunsplit(('https',p.netloc,'/healthz','',''))
    try:
        async with httpx.AsyncClient(timeout=2) as client:
            r=await client.get(health,headers={'Cache-Control':'no-store'});v=r.json() if r.is_success else None
        return {'ready':True} if isinstance(v,dict) and v.get('ok') is True and v.get('service')=='learners-area-live-signal' else {'ready':False,'reason':'service_unreachable'}
    except Exception:return {'ready':False,'reason':'service_unreachable'}

def signal_token(uid,peer,sid,role):
    sec=os.getenv('LIVE_PARTNER_SIGNAL_SECRET','')
    if len(sec)<32:return None
    at=int(time.time());head=b64(json.dumps({'alg':'HS256','typ':'JWT'},separators=(',',':')).encode())
    body=b64(json.dumps({'sid':str(sid),'peer':str(peer),'role':role,'sub':str(uid),'aud':'learners-area-live-signal','iss':'learners-area','iat':at,'exp':at+120},separators=(',',':')).encode())
    signed=f'{head}.{body}'
    return signed+'.'+b64(hmac.new(sec.encode(),signed.encode(),'sha256').digest())

@router.get('/api/live-partner')
async def get_partner(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':'unauthenticated'},401)
    now=datetime.now(timezone.utc);db=await core.pool()
    view=req.query_params.get('view')
    async with db.acquire() as con:
        if view=='ring':
            return core.j({'incoming':await ringing(con,u['id'],now)},headers=H)
        enabled=await features.available(con)
        if view=='history':
            return core.j(await features.history(con,u['id']),headers=H) if enabled else core.j({'error':'partner_upgrade_pending'},503,H)
        async with con.transaction():await sweep(con,now);s=await state(con,u['id'],now)
        on=[] if s['sessionId'] else await online(con,u['id'],now,enabled)
        extra=await features.details(con,u['id'],s,now) if enabled else {'enabled':False}
    ready=await readiness()
    return core.j({**s,'online':on,'realtime':ready,'features':extra},headers=H)

@router.post('/api/live-partner')
async def post_partner(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':'unauthenticated'},401)
    b=await core.payload(req)
    if not valid_input(b):return core.j({'error':'invalid_input'},400)
    # The source imposes three distinct rate limits; use the existing limiter.
    from .rate_limit import RULES,async_counter as counter,too_many
    RULES.update({'live_partner_action':(120,60),'live_partner_invite':(20,600),'live_partner_token':(30,600)})
    checks=['live_partner_action']
    if b['action'] in ('invite','search'):checks.append('live_partner_invite')
    if b['action']=='signal_token':checks.append('live_partner_token')
    for key in checks:
        delay=await counter(key,str(u['id']),consume=True)
        if delay:return too_many(delay)
    if b['action'] in ('go_online','invite','accept','search'):
        ready=await readiness()
        if not ready['ready']:return core.j({'error':'realtime_not_configured','reason':ready['reason']},503,H)
    db=await core.pool();now=datetime.now(timezone.utc)
    try:
        async with db.acquire() as con:
            async with con.transaction():
                if b['action']=='signal_token':
                    s=await session(con,u['id'],str(b['sessionId']))
                    if s['ended_at']:raise PartnerError('session_ended')
                    peer=str(s['user_b'] if str(s['user_a'])==str(u['id']) else s['user_a']);role='offerer' if str(s['user_a'])==str(u['id']) else 'answerer'
                    token=signal_token(str(u['id']),peer,str(s['id']),role);turn=turn_credentials(str(u['id']))
                    if not token or not turn:return core.j({'error':'realtime_not_configured'},503,H)
                    return core.j({'token':token,'url':os.getenv('LIVE_PARTNER_SIGNAL_URL'),'role':role,**turn},headers=H)
                enabled=await features.available(con)
                if b['action'] in features.ACTIONS:
                    if not enabled:return core.j({'error':'partner_upgrade_pending'},503,H)
                    await features.perform(con,str(u['id']),b,now)
                else:
                    await perform(con,str(u['id']),b,now)
                    if b['action']=='heartbeat' and b.get('ringOnly') is True:return core.j({'ok':True},headers=H)
                    if enabled and b['action'] in ('invite','accept','go_offline','practice_started'):
                        await features.clear_search(con,str(u['id']))
                        if b['action']=='invite':await features.clear_search(con,str(b['toUserId']))
                s=await state(con,str(u['id']),now)
            on=[] if s['sessionId'] else await online(con,str(u['id']),now,enabled)
            extra=await features.details(con,str(u['id']),s,now) if enabled else {'enabled':False}
        ready=await readiness()
        return core.j({'ok':True,**s,'online':on,'realtime':ready,'features':extra},headers=H)
    except PartnerError as e:return core.j({'error':e.code},ERR[e.code],H)

def install():core.app.include_router(router)
