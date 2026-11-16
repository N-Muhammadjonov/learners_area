"""Scoped read models for operational priorities and actionable tuition balances."""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from . import tuition_ledger as ledger

TASHKENT=ZoneInfo('Asia/Tashkent')


async def debtors(conn, *, q: str='', branch: str='', overdue_only: bool=False,
                  offset: int=0,limit: int=20) -> dict:
    """Match student_position, including posted reversals and separate credit notes.

    The result is current accounting truth; asOf is the Tashkent date used for aging,
    not a claim that current balances are a historical snapshot.
    """
    now=datetime.now(timezone.utc);day=ledger.business_date(now)
    rows=await conn.fetch('''WITH allocations AS MATERIALIZED(
        SELECT charge_id,sum(amount_minor) AS applied FROM tuition_payment_allocations GROUP BY charge_id
      ), credits AS MATERIALIZED(
        SELECT charge_id,sum(amount_minor) AS credited FROM tuition_credit_notes WHERE status='posted' GROUP BY charge_id
      ), positions AS (
        SELECT c.student_user_id,
          sum(c.net_amount_minor-coalesce(a.applied,0)-coalesce(n.credited,0)) AS due,
          sum(c.net_amount_minor-coalesce(a.applied,0)-coalesce(n.credited,0)) FILTER(WHERE c.due_date<$1) AS overdue,
          min(c.due_date) FILTER(WHERE c.status='posted' AND NOT c.is_reversal
            AND c.net_amount_minor>coalesce(a.applied,0)+coalesce(n.credited,0)) AS oldest_due
        FROM tuition_charges c LEFT JOIN allocations a ON a.charge_id=c.id LEFT JOIN credits n ON n.charge_id=c.id
        WHERE c.posted_at IS NOT NULL GROUP BY c.student_user_id
      ), balances AS (
      SELECT u.id,u.name,u.account_status,greatest(p.due,0)::bigint AS due,
        greatest(coalesce(p.overdue,0),0)::bigint AS overdue,p.oldest_due
      FROM users u JOIN positions p ON p.student_user_id=u.id
      WHERE u.role='student' AND ($2='' OR u.name ILIKE '%'||$2||'%' OR u.email ILIKE '%'||$2||'%')
        AND ($3='' OR EXISTS(SELECT 1 FROM academy_group_memberships m JOIN academy_groups g ON g.id=m.group_id
             WHERE m.student_user_id=u.id AND m.status IN ('active','paused')
               AND m.starts_on<=$1 AND (m.ends_on IS NULL OR m.ends_on>=$1) AND g.branch=$3))
    ), filtered AS MATERIALIZED(SELECT * FROM balances WHERE due>0 AND (NOT $4 OR overdue>0))
      SELECT b.*,t.total FROM (SELECT count(*) AS total FROM filtered)t LEFT JOIN LATERAL(
        SELECT * FROM filtered ORDER BY oldest_due NULLS LAST,lower(name),id LIMIT $5 OFFSET $6)b ON true''',
      day,q,branch,overdue_only,limit+1,offset)
    total=int(rows[0]['total']);items=[r for r in rows if r['id'] is not None]
    return {'asOf':day.isoformat(),'observedAt':now.isoformat(),'total':total,
        'items':[{'studentId':str(r['id']),'name':r['name'],'accountStatus':r['account_status'],
                  'balanceDueMinor':r['due'],'overdueMinor':r['overdue'],
                  'oldestDueDate':r['oldest_due'].isoformat() if r['oldest_due'] else None} for r in items[:limit]],
        'pagination':{'offset':offset,'limit':limit,'hasMore':len(items)>limit}}


async def today(conn, *, actor_id: UUID, role: str,classes_offset: int=0,followups_offset: int=0) -> dict:
    now=datetime.now(timezone.utc);day=ledger.business_date(now)
    start=datetime.combine(day,time.min,TASHKENT);end=start+timedelta(days=1)
    rows=await conn.fetch('''WITH matches AS MATERIALIZED(
        SELECT s.id,s.group_id,s.starts_at,s.ends_at,s.status,g.name,g.branch
        FROM academy_sessions s JOIN academy_groups g ON g.id=s.group_id
        WHERE s.starts_at>=$1 AND s.starts_at<$2 AND s.status IN ('scheduled','held')
          AND ($3 OR EXISTS(SELECT 1 FROM academy_session_teachers t WHERE t.session_id=s.id AND t.teacher_user_id=$4))
    ) SELECT m.*,t.total FROM (SELECT count(*) AS total FROM matches)t LEFT JOIN LATERAL(
        SELECT * FROM matches ORDER BY starts_at,id LIMIT 10 OFFSET $5)m ON true''',
        start,end,role in ('owner','admin'),actor_id,classes_offset)
    count=int(rows[0]['total']);classes=[r for r in rows if r['id'] is not None]
    data={'date':day.isoformat(),'observedAt':now.isoformat(),'scope':'centre' if role in ('owner','admin') else 'assigned',
          'classes':{'count':count,'pagination':{'offset':classes_offset,'limit':10,'hasMore':classes_offset+len(classes)<count},'items':[
              {'id':str(r['id']),'groupId':str(r['group_id']),'name':r['name'],'branch':r['branch'],
               'startsAt':r['starts_at'].isoformat(),'endsAt':r['ends_at'].isoformat(),'status':r['status'],
               'href':'/app/management/groups?group='+str(r['group_id'])+('&view=sessions' if role=='teacher' else '')} for r in classes]}}
    if role in ('owner','admin'):
        balances=await debtors(conn,limit=1)
        rows=await conn.fetch('''WITH matches AS MATERIALIZED(SELECT id,name,follow_up_at FROM academy_leads
            WHERE stage NOT IN ('enrolled','lost') AND follow_up_at<=$1
        ) SELECT m.*,t.total FROM (SELECT count(*) AS total FROM matches)t LEFT JOIN LATERAL(
            SELECT * FROM matches ORDER BY follow_up_at,id LIMIT 10 OFFSET $2)m ON true''',now,followups_offset)
        count=int(rows[0]['total']);leads=[r for r in rows if r['id'] is not None]
        data['balances']={'count':balances['total'],'href':'/app/management/finance?view=debts'}
        data['followUps']={'count':count,'pagination':{'offset':followups_offset,'limit':10,'hasMore':followups_offset+len(leads)<count},'items':[
            {'id':str(r['id']),'name':r['name'],'dueAt':r['follow_up_at'].isoformat(),
             'href':'/app/management/leads?lead='+str(r['id'])} for r in leads]}
    else:
        count=await conn.fetchval('''SELECT count(*) FROM guardian_links l
            WHERE l.status IN ('awaiting_guardian','awaiting_student','linked')
            AND EXISTS(SELECT 1 FROM teacher_student_links t WHERE t.student_user_id=l.student_id AND t.teacher_user_id=$1)''',actor_id)
        data['parents']={'count':count,'href':'/app/management/guardians'}
    return data
