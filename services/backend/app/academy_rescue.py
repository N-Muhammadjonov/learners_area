"""Project dated, role-scoped evidence for staff intervention decisions."""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from asyncpg import Connection, Record
from pydantic import Field, model_validator

from .academy_groups import Command, GroupError, PAGE_SIZE, Revision, today
from .academy_sessions import Reason

Status = Literal['needs_support', 'no_signal', 'insufficient_data']
Workflow = Literal['open','claimed','follow_up','resolved','dismissed']
Action = Literal['claim','assign','note','plan','follow_up','resolve','dismiss','reopen']
CLOSED = ('resolved','dismissed')
STAFF = ('owner','admin')
VERSION_FIELDS = ('windowDays', 'attendancePercent', 'minimumMarkedSessions',
                  'overdueStreak', 'scoreDropPoints')
THRESHOLDS = """SELECT revision, window_days AS "windowDays", attendance_percent AS "attendancePercent",
                       minimum_marked_sessions AS "minimumMarkedSessions",
                       overdue_streak AS "overdueStreak", score_drop_points AS "scoreDropPoints"
                  FROM academy_rescue_thresholds WHERE id=1"""
# Only active students and their current memberships are candidates. A teacher must
# hold both roster authority for the person and group authority for the context.
QUEUE_SQL = """
WITH candidates AS (
  SELECT m.group_id, m.student_user_id, g.name AS group_name, u.name AS student_name,
         m.activated_on
    FROM academy_group_memberships m
    JOIN academy_groups g ON g.id=m.group_id
    JOIN users u ON u.id=m.student_user_id
   WHERE m.status='active' AND m.ends_on IS NULL AND g.status='active'
     AND u.role='student' AND u.account_status='active' AND m.activated_on IS NOT NULL
     AND ($3::uuid IS NULL OR m.group_id=$3)
     AND ($4::boolean OR (
             EXISTS(SELECT 1 FROM academy_group_teachers gt
                     WHERE gt.group_id=m.group_id AND gt.teacher_user_id=$5)
         AND EXISTS(SELECT 1 FROM teacher_student_links l
                     WHERE l.student_user_id=m.student_user_id AND l.teacher_user_id=$5)))
), observed AS (
 SELECT c.*, att.attended, att.marked, att.ids AS attendance_ids,
        overdue.streak, overdue.ids AS assignment_ids, scored.ids AS score_ids, scored.drop_points,
        r.revision, r.status AS workflow_status, r.assigned_to, r.follow_up_on, r.updated_at AS case_updated_at
   FROM candidates c
   LEFT JOIN academy_rescue_cases r ON r.group_id=c.group_id AND r.student_id=c.student_user_id
   CROSS JOIN LATERAL (
     SELECT count(*) FILTER (WHERE a.status IN ('present','late')) AS attended,
            count(*) AS marked, array_agg(s.id ORDER BY s.starts_at DESC,s.id) AS ids
       FROM academy_attendance a JOIN academy_sessions s ON s.id=a.session_id
      WHERE a.student_user_id=c.student_user_id AND s.group_id=c.group_id AND s.status='held'
        AND s.starts_at>=GREATEST($1, c.activated_on::timestamp AT TIME ZONE 'Asia/Tashkent')
        AND s.starts_at<=$2 AND a.status IN ('present','late','absent')
   ) att
   CROSS JOIN LATERAL (
     SELECT count(*) FILTER (WHERE completed_before_cutoff=0) AS streak,
            array_agg(id ORDER BY due_at DESC,id) FILTER (WHERE completed_before_cutoff=0) AS ids
       FROM (
         SELECT t.id, t.due_at,
                count(*) FILTER (WHERE t.status='completed' AND t.completed_at<=t.due_at)
                OVER (ORDER BY t.due_at DESC,t.id ROWS UNBOUNDED PRECEDING) AS completed_before_cutoff
           FROM assignment_targets t
           JOIN assignments a ON a.id=t.assignment_id
          WHERE t.student_user_id=c.student_user_id AND t.due_at<$2
            AND t.due_at>=GREATEST($1,c.activated_on::timestamp AT TIME ZONE 'Asia/Tashkent')
            AND ($4 OR a.created_by_user_id=$5)
       ) recent
   ) overdue
   LEFT JOIN LATERAL (
     SELECT ARRAY[prior_id,id] AS ids, drop_points
       FROM (
         SELECT id,submitted_at,
                lag(id) OVER comparison AS prior_id,
                lag(percent) OVER comparison - percent AS drop_points
           FROM (
             SELECT id,submitted_at,test_id AS content_id,'listening' AS skill,score*100.0/total_questions AS percent
               FROM listening_attempts
              WHERE user_id=c.student_user_id AND status='completed'
                AND submitted_at BETWEEN GREATEST($1,c.activated_on::timestamp AT TIME ZONE 'Asia/Tashkent') AND $2
                AND total_questions>0 AND score BETWEEN 0 AND total_questions
             UNION ALL
             SELECT id,submitted_at,passage_id,'reading',score*100.0/total_questions
               FROM reading_attempts
              WHERE user_id=c.student_user_id AND status='completed'
                AND submitted_at BETWEEN GREATEST($1,c.activated_on::timestamp AT TIME ZONE 'Asia/Tashkent') AND $2
                AND total_questions>0 AND score BETWEEN 0 AND total_questions
           ) attempts
           WINDOW comparison AS (PARTITION BY skill,content_id ORDER BY submitted_at,id)
       ) observations
      WHERE prior_id IS NOT NULL
      ORDER BY submitted_at DESC,id DESC LIMIT 1
   ) scored ON TRUE
), signals AS (
 SELECT *,
        (marked >= $6 AND attended*100 < marked*$7) AS attendance_signal,
        (streak >= $8) AS overdue_signal,
        coalesce(drop_points >= $9,FALSE) AS score_signal
   FROM observed
), classified AS (
 SELECT *,
        attendance_signal::int + overdue_signal::int + score_signal::int AS score,
        CASE WHEN attendance_signal OR overdue_signal OR score_signal THEN 'needs_support'
             WHEN marked < $6 AND streak < $8 AND score_ids IS NULL THEN 'insufficient_data'
             ELSE 'no_signal' END AS status
   FROM signals
)
SELECT * FROM classified
 WHERE ($10::text IS NULL OR status=$10)
   AND ($13::text IS NULL OR coalesce(workflow_status,'open')=$13)
 ORDER BY score DESC, student_user_id, group_id
 LIMIT $11 OFFSET $12
"""


class Thresholds(Command):
    revision: Revision
    windowDays: Annotated[int, Field(strict=True, ge=7, le=90)]
    attendancePercent: Annotated[int, Field(strict=True, ge=1, le=100)]
    minimumMarkedSessions: Annotated[int, Field(strict=True, ge=2, le=20)]
    overdueStreak: Annotated[int, Field(strict=True, ge=1, le=10)]
    scoreDropPoints: Annotated[int, Field(strict=True, ge=1, le=100)]


async def update_thresholds(conn: Connection, actor: UUID, command: Thresholds) -> dict:
    async with conn.transaction():
        previous = await conn.fetchrow(THRESHOLDS + ' FOR UPDATE')
        values = command.model_dump()
        same = all(previous[key] == values[key] for key in VERSION_FIELDS)
        if same and command.revision in (previous['revision'], previous['revision']-1):
            return dict(previous)
        if command.revision != previous['revision']:
            raise GroupError('stale_thresholds')
        await conn.execute(
            """UPDATE academy_rescue_thresholds
                  SET revision=revision+1, window_days=$1, attendance_percent=$2,
                      minimum_marked_sessions=$3, overdue_streak=$4, score_drop_points=$5,
                      updated_at=now()
                WHERE id=1""",
            *(values[key] for key in VERSION_FIELDS),
        )
        current = dict(await conn.fetchrow(THRESHOLDS))
        await conn.execute(
            """INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
               VALUES($1,'academy.rescue.thresholds_updated','academy_rescue_thresholds','1',$2::jsonb)""",
            actor,json.dumps({'prior':dict(previous),'current':current}),
        )
        return current


def reason(rule: str, value: float | int, limit: int, size: int, evidence: list[UUID]) -> dict:
    return {'ruleId':rule,'value':value,'threshold':limit,'sampleSize':size,
            'evidenceIds':[str(item) for item in evidence]}


def item(row: Record, thresholds: Record, start: datetime, now: datetime) -> dict:
    reasons = []
    if row['attendance_signal']:
        attendance = row['attended'] * 100 / row['marked']
        reasons.append(reason('attendance',round(attendance,2),thresholds['attendancePercent'],
                              row['marked'],row['attendance_ids']))
    if row['overdue_signal']:
        reasons.append(reason('overdue_assignments',row['streak'],thresholds['overdueStreak'],
                              row['streak'],row['assignment_ids']))
    if row['score_signal']:
        reasons.append(reason('ielts_practice_drop',float(round(row['drop_points'],2)),
                              thresholds['scoreDropPoints'],2,row['score_ids']))
    return {
        'studentId':str(row['student_user_id']),'studentName':row['student_name'],
        'groupId':str(row['group_id']),'groupName':row['group_name'],
        'observedWindow':{'startsAt':start.isoformat(),'endsAt':now.isoformat()},
        'updatedAt':now.isoformat(),'thresholdVersion':thresholds['revision'],
        'status':row['status'],'priority':row['score'],'reasons':reasons,
        'case':case_result(row['revision'] or 0,row['workflow_status'] or 'open',
                           row['assigned_to'],row['follow_up_on'],row['case_updated_at']),
    }


async def read_queue(conn: Connection, actor: UUID, role: str, page: int,
                     group_id: UUID | None, status: Status | None, workflow: Workflow | None) -> dict:
    async with conn.transaction(isolation='repeatable_read', readonly=True):
        thresholds = await conn.fetchrow(THRESHOLDS)
        now = await conn.fetchval('SELECT transaction_timestamp()')
        start = now-timedelta(days=thresholds['windowDays'])
        rows = await conn.fetch(
            QUEUE_SQL,start,now,group_id,role in STAFF,actor,
            thresholds['minimumMarkedSessions'],thresholds['attendancePercent'],
            thresholds['overdueStreak'],thresholds['scoreDropPoints'],status,
            PAGE_SIZE+1,PAGE_SIZE*(page-1),workflow,
        )
    return {'thresholds':dict(thresholds),'page':page,'hasNext':len(rows)>PAGE_SIZE,
            'items':[item(row,thresholds,start,now) for row in rows[:PAGE_SIZE]]}


class CaseAction(Command):
    id: UUID
    revision: Annotated[int, Field(strict=True, ge=0, lt=2**31-1)]
    action: Action
    reason: Reason
    assignee: UUID | None = None
    followUpOn: date | None = None

    @model_validator(mode='after')
    def action_fields(self):
        if (self.action == 'assign') != (self.assignee is not None):
            raise ValueError('An assignee is required only for assignment')
        if (self.action == 'plan') != (self.followUpOn is not None):
            raise ValueError('A follow-up date is required only for planning')
        return self


def case_result(revision: int, status: str, assignee: UUID | None,
                due: date | None, updated: datetime | None) -> dict:
    return {'revision':revision,'status':status,'assignedTo':str(assignee) if assignee else None,
            'followUpOn':due.isoformat() if due else None,
            'updatedAt':updated.isoformat() if updated else None}


async def assigned_teacher(conn: Connection, group_id: UUID, student: UUID, teacher: UUID,
                           *, writing: bool = False) -> bool:
    query = """SELECT 1 FROM academy_group_teachers gt
                JOIN teacher_student_links tl ON tl.teacher_user_id=gt.teacher_user_id
                JOIN users u ON u.id=gt.teacher_user_id
               WHERE gt.group_id=$1 AND tl.student_user_id=$2 AND gt.teacher_user_id=$3
                 AND u.role='teacher' AND u.account_status='active'"""
    if writing:
        query += ' FOR SHARE OF gt,tl,u'
    return bool(await conn.fetchval(query,group_id,student,teacher))


async def authorize_case(conn: Connection, actor: UUID, role: str, group_id: UUID, student: UUID,
                         *, writing: bool = False) -> None:
    scope = """SELECT 1 FROM academy_group_memberships m
                JOIN academy_groups g ON g.id=m.group_id JOIN users u ON u.id=m.student_user_id
               WHERE m.group_id=$1 AND m.student_user_id=$2 AND m.status='active'
                 AND m.activated_on IS NOT NULL AND g.status='active'
                 AND u.role='student' AND u.account_status='active'"""
    if writing:
        scope += ' FOR SHARE OF m,g,u'
    member = await conn.fetchval(scope,group_id,student)
    if not member or (role not in STAFF and not await assigned_teacher(conn,group_id,student,actor,writing=writing)):
        raise GroupError('case_not_found',404)


async def case_assignees(conn: Connection, actor: UUID, role: str, group: UUID, student: UUID) -> dict:
    async with conn.transaction(isolation='repeatable_read',readonly=True):
        await authorize_case(conn,actor,role,group,student)
        rows = await conn.fetch(
            """SELECT u.id,coalesce(u.name,u.id::text) AS name FROM academy_group_teachers gt
                JOIN teacher_student_links tl ON tl.teacher_user_id=gt.teacher_user_id
                JOIN users u ON u.id=gt.teacher_user_id
                WHERE gt.group_id=$1 AND tl.student_user_id=$2 AND u.role='teacher'
                  AND u.account_status='active' ORDER BY lower(u.name) NULLS LAST,u.id""",group,student,
        )
    return {'teachers':[{'id':str(row['id']),'name':row['name']} for row in rows]}


async def case_history(conn: Connection, actor: UUID, role: str, group: UUID, student: UUID,
                       page: int) -> dict:
    async with conn.transaction(isolation='repeatable_read',readonly=True):
        await authorize_case(conn,actor,role,group,student)
        rows = await conn.fetch(
            """SELECT id,actor_id,action,reason,created_at,revision,result->>'followUpOn' AS follow_up_on
                 FROM academy_rescue_actions WHERE group_id=$1 AND student_id=$2
                ORDER BY revision DESC LIMIT $3 OFFSET $4""",group,student,PAGE_SIZE+1,PAGE_SIZE*(page-1),
        )
    return {'items':[{'id':str(row['id']),'actorId':str(row['actor_id']),
                      'action':row['action'],'reason':row['reason'],
                      'revision':row['revision'],'createdAt':row['created_at'].isoformat(),
                      'followUpOn':row['follow_up_on']}
                     for row in rows[:PAGE_SIZE]],
            'page':page,'hasNext':len(rows)>PAGE_SIZE}


async def apply_action(conn: Connection, actor: UUID, role: str, group: UUID, student: UUID,
                       command: CaseAction) -> dict:
    fingerprint = hashlib.sha256(command.model_dump_json().encode()).hexdigest()
    async with conn.transaction():
        await conn.execute('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',f'rescue:{group}:{student}')
        await authorize_case(conn,actor,role,group,student,writing=True)
        prior = await conn.fetchrow('SELECT group_id,student_id,actor_id,body_hash,result::text AS result FROM academy_rescue_actions WHERE id=$1',command.id)
        if prior:
            if (prior['group_id'],prior['student_id'],prior['actor_id'],prior['body_hash']) != (group,student,actor,fingerprint):
                raise GroupError('idempotency_conflict')
            return json.loads(prior['result'])
        case = await conn.fetchrow(
            'SELECT * FROM academy_rescue_cases WHERE group_id=$1 AND student_id=$2 FOR UPDATE',group,student)
        revision = case['revision'] if case else 0
        if command.revision != revision:
            raise GroupError('stale_case')
        status = case['status'] if case else 'open'
        assignee = case['assigned_to'] if case else None
        due = case['follow_up_on'] if case else None
        action = command.action
        if action == 'claim':
            if role != 'teacher' or status != 'open':
                raise GroupError('case_not_open')
            status, assignee = 'claimed', actor
        elif action == 'assign':
            if role not in STAFF:
                raise GroupError('forbidden',403)
            if status in CLOSED or not await assigned_teacher(conn,group,student,command.assignee,writing=True):
                raise GroupError('invalid_assignment')
            status, assignee = 'claimed', command.assignee
        else:
            if role not in STAFF and assignee != actor:
                raise GroupError('forbidden',403)
            if action == 'reopen':
                if status not in CLOSED:
                    raise GroupError('case_not_closed')
                status, assignee, due = 'open', None, None
            else:
                if status in CLOSED or case is None:
                    raise GroupError('case_not_active')
                if action == 'plan':
                    if status == 'open' or command.followUpOn < today():
                        raise GroupError('invalid_follow_up')
                    status, due = 'follow_up', command.followUpOn
                elif action == 'follow_up':
                    if status != 'follow_up':
                        raise GroupError('follow_up_not_planned')
                    status, due = 'claimed', None
                elif action in ('resolve','dismiss'):
                    status, due = ('resolved' if action == 'resolve' else 'dismissed'), None
        row = await conn.fetchrow(
            """INSERT INTO academy_rescue_cases(group_id,student_id,revision,status,assigned_to,follow_up_on)
               VALUES($1,$2,$3,$4,$5,$6)
               ON CONFLICT(group_id,student_id) DO UPDATE SET revision=excluded.revision,
                 status=excluded.status,assigned_to=excluded.assigned_to,follow_up_on=excluded.follow_up_on,
                 updated_at=transaction_timestamp() RETURNING updated_at""",
            group,student,revision+1,status,assignee,due,
        )
        result = case_result(revision+1,status,assignee,due,row['updated_at'])
        inserted = await conn.fetchval(
            """INSERT INTO academy_rescue_actions(id,group_id,student_id,actor_id,revision,action,reason,body_hash,result)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id""",
            command.id,group,student,actor,revision+1,action,command.reason,fingerprint,json.dumps(result),
        )
        if not inserted:
            raise GroupError('idempotency_conflict')
        return result
