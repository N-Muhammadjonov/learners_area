"""Held-session attendance, preserved roster and reasoned corrections."""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta
from typing import Literal, Self
from uuid import UUID

from asyncpg import Connection, Record
from pydantic import Field, model_validator

from .academy_groups import Calendar, Command, GROUP_STAFF, GroupError, Revision, group_lock, public_row
from .academy_sessions import Reason, get_session

DEFAULT_TEACHER_WINDOW = 7


def teacher_window() -> timedelta:
    try:
        days = int(os.environ.get('ACADEMY_ATTENDANCE_CORRECTION_DAYS', DEFAULT_TEACHER_WINDOW))
    except ValueError:
        days = DEFAULT_TEACHER_WINDOW
    return timedelta(days=max(0,min(days,90)))


class Mark(Command):
    studentId: UUID
    revision: Revision
    status: Literal['present', 'late', 'absent', 'excused']


class BulkMarks(Command):
    id: UUID
    reason: Reason | None = None
    marks: list[Mark] = Field(min_length=1, max_length=250)

    @model_validator(mode='after')
    def unique(self) -> Self:
        if len({mark.studentId for mark in self.marks}) != len(self.marks):
            raise ValueError('Duplicate mark')
        return self


async def snapshot(conn: Connection, session: Record) -> None:
    """Capture the eligible group roster with date-based transfers effective that day."""
    await conn.execute(
        """INSERT INTO academy_attendance(session_id,membership_id,student_user_id)
           SELECT DISTINCT ON (student_user_id) $1,id,student_user_id
             FROM academy_group_memberships
            WHERE group_id=$2 AND activated_on<=$3 AND (ends_on IS NULL OR ends_on>$3
                OR ends_on=$3 AND status IN ('completed','withdrawn'))
            ORDER BY student_user_id,activated_on DESC,id
           ON CONFLICT DO NOTHING""",
        session['id'], session['group_id'], session['starts_at'].astimezone(Calendar).date())


async def authorize_session(conn: Connection, actor: UUID, role: str,
                            group_id: UUID, session_id: UUID) -> Record:
    session = await get_session(conn, group_id, session_id)
    if role not in GROUP_STAFF and not await conn.fetchval(
            """SELECT EXISTS(SELECT 1 FROM academy_session_teachers
                              WHERE session_id=$1 AND teacher_user_id=$2)""", session_id, actor):
        raise GroupError('forbidden', 403)
    if session['status'] != 'held':
        raise GroupError('session_not_held')
    return session


async def read(conn: Connection, actor: UUID, role: str, group_id: UUID,
               session_id: UUID, page: int) -> dict:
    async with conn.transaction(isolation='repeatable_read', readonly=True):
        await authorize_session(conn, actor, role, group_id, session_id)
        rows = await conn.fetch(
            """SELECT a.*, u.name FROM academy_attendance a JOIN users u ON u.id=a.student_user_id
                WHERE a.session_id=$1 ORDER BY u.name,a.student_user_id LIMIT 101 OFFSET $2""",
            session_id, 100 * (page - 1))
    return {'attendance': [public_row(row) for row in rows[:100]], 'hasNext': len(rows)>100,
            'teacherWindowDays': teacher_window().days}


async def save(conn: Connection, actor: UUID, role: str, group_id: UUID,
               session_id: UUID, command: BulkMarks) -> dict:
    async with conn.transaction(isolation='read_committed'):
        await group_lock(conn, group_id)
        session = await authorize_session(conn, actor, role, group_id, session_id)
        await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,1124))",
                           str(command.id))
        payload = command.model_dump(mode='json')
        previous = await conn.fetchval(
            """SELECT metadata FROM audit_log WHERE action='academy.attendance.saved'
                AND target_id=$1 LIMIT 1""", str(command.id))
        if previous:
            recorded = json.loads(previous) if isinstance(previous, str) else previous
            if (recorded['sessionId'] != str(session_id) or recorded['actorId'] != str(actor)
                    or recorded['command'] != payload):
                raise GroupError('attendance_id_conflict')
            return {'ok': True, 'updated': recorded['updated']}
        if role not in GROUP_STAFF and datetime.now(Calendar) > session['ends_at'] + teacher_window():
            raise GroupError('attendance_correction_window_closed', 403)
        rows = await conn.fetch(
            """SELECT student_user_id, revision,status FROM academy_attendance WHERE session_id=$1
               AND student_user_id=ANY($2::uuid[])""",
            session_id, [mark.studentId for mark in command.marks])
        existing = {row['student_user_id']: row for row in rows}
        changes = []
        for mark in command.marks:
            old = existing.get(mark.studentId)
            if not old:
                raise GroupError('student_not_on_session_roster', 422)
            if mark.revision != old['revision']:
                raise GroupError('attendance_revision_conflict')
            if old['status'] != mark.status:
                if old['status'] != 'not_marked' and command.reason is None:
                    raise GroupError('attendance_reason_required', 422)
                changes.append({'studentId': str(mark.studentId), 'old': old['status'], 'new': mark.status})
        await conn.execute(
            """UPDATE academy_attendance a SET status=x.status,revision=a.revision+1,
                   marked_by=$2,marked_at=now()
                FROM unnest($3::uuid[],$4::varchar[]) AS x(student_id,status)
               WHERE a.session_id=$1 AND a.student_user_id=x.student_id""",
            session_id, actor, [UUID(change['studentId']) for change in changes],
            [change['new'] for change in changes])
        await conn.execute(
            """INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
               VALUES($1,'academy.attendance.saved','academy_session',$2,$3::jsonb)""",
            actor, str(command.id), json.dumps({'actorId':str(actor), 'sessionId':str(session_id),
                                               'command':payload,'updated':len(changes),'changes':changes}))
        return {'ok': True, 'updated': len(changes)}


async def student_summary(conn: Connection, student: UUID) -> dict:
    """Own-child counts use the frozen held-session roster as the denominator."""
    async with conn.transaction(isolation='repeatable_read', readonly=True):
        counts = await conn.fetchrow(
            """SELECT count(*) AS eligible,
                    count(*) FILTER(WHERE a.status IN ('present','late')) AS attended,
                    count(*) FILTER(WHERE a.status='absent') AS absent,
                    count(*) FILTER(WHERE a.status='excused') AS excused,
                    count(*) FILTER(WHERE a.status='not_marked') AS not_marked
                 FROM academy_attendance a JOIN academy_sessions s ON s.id=a.session_id
                WHERE a.student_user_id=$1 AND s.status='held'""", student)
        history = await conn.fetch(
            """SELECT s.starts_at, g.name AS group_name, a.status
                 FROM academy_attendance a JOIN academy_sessions s ON s.id=a.session_id
                 JOIN academy_groups g ON g.id=s.group_id
                WHERE a.student_user_id=$1 AND s.status='held'
                ORDER BY s.starts_at DESC,s.id LIMIT 25""", student)
    recorded = public_row(counts)
    eligible = recorded['eligible'] - recorded['excused']
    return {'counts': recorded, 'attendanceRate': recorded['attended'] / eligible if eligible else None,
            'history': [public_row(row) for row in history]}


async def student_calendar(conn: Connection, student: UUID, page: int = 1) -> dict:
    """Own calendar: historical marked sessions and future sessions of actual memberships.

    An active membership never exposes lessons held before the learner joined.
    """
    async with conn.transaction(isolation='repeatable_read', readonly=True):
        rows = await conn.fetch(
            """SELECT s.id, s.group_id, g.name AS group_name, g.branch, s.room,
                      s.starts_at, s.ends_at, s.status AS session_status,
                      a.status AS attendance_status
                 FROM academy_sessions s
                 JOIN academy_groups g ON g.id=s.group_id
                 LEFT JOIN academy_attendance a
                   ON a.session_id=s.id AND a.student_user_id=$1
                WHERE a.student_user_id=$1
                   OR (s.status='scheduled' AND EXISTS (
                      SELECT 1 FROM academy_group_memberships m
                       WHERE m.group_id=s.group_id AND m.student_user_id=$1
                         AND m.status IN ('active','paused')
                         AND m.starts_on <= (s.starts_at AT TIME ZONE 'Asia/Tashkent')::date
                         AND (m.ends_on IS NULL OR m.ends_on >=
                              (s.starts_at AT TIME ZONE 'Asia/Tashkent')::date)
                   ))
                ORDER BY s.starts_at DESC,s.id
                LIMIT 26 OFFSET $2""",
            student, 25 * (page - 1))
    sessions = []
    for row in rows[:25]:
        item = public_row(row)
        for key in ('starts_at', 'ends_at'):
            if isinstance(item.get(key), datetime):
                item[key] = item[key].isoformat()
        sessions.append(item)
    return {'sessions': sessions, 'page': page, 'hasNext': len(rows) > 25}


async def attendance_aggregate_report(
    conn: Connection, actor: UUID, role: str, *,
    branch: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict:
    """Role-scoped per-group and per-branch report, with held lessons only in rate."""
    today = datetime.now(Calendar).date()
    end = end_date or today
    start = start_date or (end - timedelta(days=30))
    if start > end or (end - start).days > 366:
        raise GroupError('invalid_attendance_date_range', 422)
    async with conn.transaction(isolation='repeatable_read', readonly=True):
        rows = await conn.fetch(
            """SELECT g.id AS group_id, g.name AS group_name, g.branch,
                      count(DISTINCT s.id) FILTER (WHERE s.status='held') AS held_sessions,
                      count(DISTINCT s.id) FILTER (WHERE s.status='cancelled') AS cancelled_sessions,
                      count(DISTINCT s.id) FILTER (WHERE s.status='scheduled') AS scheduled_sessions,
                      count(a.student_user_id) FILTER (WHERE s.status='held') AS eligible_marks,
                      count(a.student_user_id) FILTER (
                        WHERE s.status='held' AND a.status IN ('present','late')) AS attended_marks,
                      count(a.student_user_id) FILTER (
                        WHERE s.status='held' AND a.status='absent') AS absent_marks,
                      count(a.student_user_id) FILTER (
                        WHERE s.status='held' AND a.status='excused') AS excused_marks,
                      count(a.student_user_id) FILTER (
                        WHERE s.status='held' AND a.status='not_marked') AS not_marked
                 FROM academy_groups g
                 LEFT JOIN academy_sessions s ON s.group_id=g.id
                   AND (s.starts_at AT TIME ZONE 'Asia/Tashkent')::date
                       BETWEEN $3::date AND $4::date
                 LEFT JOIN academy_attendance a ON a.session_id=s.id
                WHERE ($1::boolean OR EXISTS (
                    SELECT 1 FROM academy_group_teachers gt
                     WHERE gt.group_id=g.id AND gt.teacher_user_id=$2))
                  AND ($5::text IS NULL OR lower(g.branch)=lower($5))
                GROUP BY g.id,g.name,g.branch
                ORDER BY lower(g.branch),lower(g.name),g.id""",
            role in GROUP_STAFF, actor, start, end, branch)
    groups = []
    branches = {}
    for row in rows:
        item = public_row(row)
        attended = int(item['attended_marks'])
        eligible = int(item['eligible_marks'])
        excused = int(item['excused_marks'])
        item['attendanceRate'] = attended / (eligible - excused) if eligible > excused else None
        groups.append(item)
        bucket = branches.setdefault(item['branch'], {
            'branch': item['branch'], 'groupCount': 0, 'heldSessions': 0,
            'cancelledSessions': 0, 'scheduledSessions': 0, 'eligibleMarks': 0,
            'attendedMarks': 0, 'absentMarks': 0, 'excusedMarks': 0, 'notMarked': 0,
        })
        bucket['groupCount'] += 1
        for source_key, target_key in (
            ('held_sessions','heldSessions'), ('cancelled_sessions','cancelledSessions'),
            ('scheduled_sessions','scheduledSessions'), ('eligible_marks','eligibleMarks'),
            ('attended_marks','attendedMarks'), ('absent_marks','absentMarks'),
            ('excused_marks','excusedMarks'), ('not_marked','notMarked'),
        ):
            bucket[target_key] += int(item[source_key])
    for bucket in branches.values():
        denominator = bucket['eligibleMarks'] - bucket['excusedMarks']
        bucket['attendanceRate'] = bucket['attendedMarks'] / denominator if denominator > 0 else None
    return {
        'groups': groups, 'branches': list(branches.values()),
        'start': start.isoformat(), 'end': end.isoformat(),
        'denominatorPolicy': 'held_sessions_only_excluding_excused',
    }
