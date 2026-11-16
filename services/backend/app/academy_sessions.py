"""Bounded scheduling with atomic teacher and room reservations."""
from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta
from typing import Annotated, Literal, Self
from uuid import UUID, uuid5

from asyncpg import Connection, Record
from pydantic import Field, StringConstraints, field_validator, model_validator

from .academy_groups import (Calendar, Command, GROUP_STAFF, GroupError, Label, Revision,
                             group_lock, public_row, today, validate_teachers)

PAGE_SIZE = 25
DAY_TIME = Annotated[str, StringConstraints(pattern=r'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=300)]


class Slot(Command):
    room: Label
    localDate: date
    localStart: DAY_TIME
    durationMinutes: Annotated[int, Field(strict=True, ge=15, le=360)]
    teacherIds: list[UUID] | None = Field(default=None, min_length=1, max_length=12)

    @field_validator('localDate', mode='before')
    @classmethod
    def check_date(cls, value: object) -> date:
        if not isinstance(value, str):
            raise ValueError('Expected ISO calendar date')
        result = date.fromisoformat(value)
        if result.isoformat() != value:
            raise ValueError('Expected ISO calendar date')
        return result

    @model_validator(mode='after')
    def unique_teachers(self) -> Self:
        if self.teacherIds and len(set(self.teacherIds)) != len(self.teacherIds):
            raise ValueError('Repeated teacher')
        return self


class Book(Slot):
    seriesId: UUID
    weeks: Annotated[int, Field(strict=True, ge=1, le=16)] = 1
    holidayDates: list[date] = Field(default_factory=list, max_length=16)

    @model_validator(mode='after')
    def holidays_belong_to_series(self) -> Self:
        if self.localDate > date.max - timedelta(weeks=self.weeks - 1):
            raise ValueError('Weekly series exceeds the calendar')
        dates = {self.localDate + timedelta(weeks=i) for i in range(self.weeks)}
        if not set(self.holidayDates) <= dates or len(set(self.holidayDates)) != len(self.holidayDates):
            raise ValueError('Holiday dates must fall on distinct series dates')
        return self


class Transition(Command):
    revision: Revision
    status: Literal['held', 'cancelled']
    reason: Reason | None = None

    @model_validator(mode='after')
    def cancellation_requires_reason(self) -> Self:
        if self.status == 'cancelled' and self.reason is None:
            raise ValueError('Cancellation requires a reason')
        return self


class Reschedule(Slot):
    revision: Revision
    reason: Reason
    replacementId: UUID


def interval(fields: Slot, day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.fromisoformat(fields.localStart), Calendar)
    if start.date() > today() + timedelta(days=366):
        raise GroupError('invalid_session_window', 422)
    return start, start + timedelta(minutes=fields.durationMinutes)


def room_key(branch: str, room: str) -> str:
    return 'room:' + json.dumps([branch.casefold().strip(), room.casefold().strip()], ensure_ascii=False)


def resource_keys(group: Record, room: str, teachers: list[UUID]) -> list[str]:
    return sorted([f"group:{group['id']}", room_key(group['branch'], room),
                   *(f'teacher:{teacher}' for teacher in teachers)])


async def lock_keys(conn: Connection, keys: list[str]) -> None:
    # Every writer takes the same ordered locks before it tests any overlap.
    for key in sorted(set(keys)):
        await conn.execute('SELECT pg_advisory_xact_lock(hashtextextended($1, 1123))', key)


async def teacher_ids(conn: Connection, group_id: UUID, fields: Slot) -> list[UUID]:
    ids = fields.teacherIds
    if ids is None:
        ids = [row['teacher_user_id'] for row in await conn.fetch(
            'SELECT teacher_user_id FROM academy_group_teachers WHERE group_id=$1', group_id)]
    if not ids:
        raise GroupError('invalid_teachers', 422)
    await validate_teachers(conn, ids)
    return sorted(ids)


def validate_window(group: Record, start: datetime, end: datetime) -> None:
    day = start.date()
    if (group['status'] != 'active' or day < max(today(), group['starts_on'])
            or day > today() + timedelta(days=366) or end.date() != day
            or group['ends_on'] and day > group['ends_on']):
        raise GroupError('invalid_session_window', 422)


async def audit(conn: Connection, actor: UUID, action: str, session_id: UUID, detail: dict) -> None:
    await conn.execute(
        """INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
           VALUES($1,$2,'academy_session',$3,$4::jsonb)""",
        actor, 'academy.session.' + action, str(session_id), json.dumps(detail))


async def get_session(conn: Connection, group_id: UUID, session_id: UUID) -> Record:
    row = await conn.fetchrow('SELECT * FROM academy_sessions WHERE id=$1 AND group_id=$2',
                              session_id, group_id)
    if not row:
        raise GroupError('session_not_found', 404)
    return row


async def reserve(conn: Connection, row: Record, keys: list[str]) -> None:
    found = await conn.fetchval(
        """SELECT EXISTS(SELECT 1 FROM academy_session_reservations
                   WHERE resource_key=ANY($1::text[]) AND starts_at<$3 AND ends_at>$2)""",
        keys, row['starts_at'], row['ends_at'])
    if found:
        raise GroupError('schedule_overlap')
    await conn.execute(
        """INSERT INTO academy_session_reservations(session_id,resource_key,starts_at,ends_at)
           SELECT $1, unnest($2::text[]), $3, $4""", row['id'], keys, row['starts_at'], row['ends_at'])


async def insert_session(conn: Connection, group: Record, session_id: UUID, series_id: UUID,
                         fields: Slot, start: datetime, end: datetime, teachers: list[UUID],
                         keys: list[str], holiday: bool = False, replaces: UUID | None = None) -> Record:
    row = await conn.fetchrow(
        """INSERT INTO academy_sessions(id,group_id,series_id,branch,room,starts_at,ends_at,status,
                                       reason,replaces_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *""",
        session_id, group['id'], series_id, group['branch'], fields.room, start, end,
        'cancelled' if holiday else 'scheduled', 'holiday' if holiday else None, replaces)
    await conn.execute(
        """INSERT INTO academy_session_teachers(session_id,teacher_user_id)
           SELECT $1, unnest($2::uuid[])""", row['id'], teachers)
    if not holiday:
        await reserve(conn, row, keys)
    return row


async def book(conn: Connection, actor: UUID, group_id: UUID, command: Book) -> dict:
    async with conn.transaction(isolation='read_committed'):
        group = await group_lock(conn, group_id)
        await lock_keys(conn, [f'series:{command.seriesId}'])
        recorded = await conn.fetch(
            'SELECT * FROM academy_sessions WHERE series_id=$1 ORDER BY starts_at', command.seriesId)
        if recorded:
            historical = await conn.fetchval(
                """SELECT metadata FROM audit_log WHERE target_id=$1 AND action='academy.session.booked'
                   ORDER BY created_at LIMIT 1""", str(recorded[0]['id']))
            if (recorded[0]['group_id'] == group_id and historical
                    and (json.loads(historical) if isinstance(historical, str) else historical)
                    == command.model_dump(mode='json')):
                return {'sessions': [public_row(row) for row in recorded]}
            raise GroupError('series_conflict')
        teachers = await teacher_ids(conn, group_id, command)
        keys = resource_keys(group, command.room, teachers)
        await lock_keys(conn, keys)
        results = []
        for week in range(command.weeks):
            day = command.localDate + timedelta(weeks=week)
            starts, ends = interval(command, day)
            validate_window(group, starts, ends)
            row = await insert_session(conn, group, uuid5(command.seriesId, str(day)), command.seriesId,
                                       command, starts, ends, teachers, keys, day in command.holidayDates)
            results.append(public_row(row))
        await audit(conn, actor, 'booked', UUID(results[0]['id']), command.model_dump(mode='json'))
        return {'sessions': results}


async def transition(conn: Connection, actor: UUID, group_id: UUID, session_id: UUID,
                     command: Transition) -> dict:
    async with conn.transaction(isolation='read_committed'):
        await group_lock(conn, group_id)
        row = await get_session(conn, group_id, session_id)
        if (row['status'] == command.status and row['revision'] == command.revision + 1
                and row['reason'] == command.reason):
            return public_row(row)
        if row['status'] != 'scheduled' or row['revision'] != command.revision:
            raise GroupError('session_revision_conflict')
        if command.status == 'held' and row['ends_at'] > datetime.now(Calendar):
            raise GroupError('session_not_ended')
        if command.status == 'cancelled':
            keys = [r['resource_key'] for r in await conn.fetch(
                'SELECT resource_key FROM academy_session_reservations WHERE session_id=$1', session_id)]
            await lock_keys(conn, keys)
            await conn.execute('DELETE FROM academy_session_reservations WHERE session_id=$1', session_id)
        result = await conn.fetchrow(
            """UPDATE academy_sessions SET status=$2,reason=$3,revision=revision+1
                WHERE id=$1 RETURNING *""", session_id, command.status, command.reason)
        if command.status == 'held':
            from .academy_attendance import snapshot
            await snapshot(conn, result)
            from .prepaid_services import held_session
            await held_session(conn,result,actor)
        await audit(conn, actor, command.status, session_id, {'reason': command.reason})
        return public_row(result)


async def reschedule(conn: Connection, actor: UUID, group_id: UUID, session_id: UUID,
                     command: Reschedule) -> dict:
    async with conn.transaction(isolation='read_committed'):
        group = await group_lock(conn, group_id)
        row = await get_session(conn, group_id, session_id)
        if row['status'] == 'rescheduled' and row['revision'] == command.revision + 1:
            replacement = await conn.fetchrow(
                'SELECT * FROM academy_sessions WHERE replaces_id=$1 AND id=$2',
                session_id, command.replacementId)
            previous = await conn.fetchval(
                """SELECT metadata FROM audit_log WHERE target_id=$1 AND action='academy.session.rescheduled'
                   ORDER BY created_at LIMIT 1""", str(session_id))
            payload = json.loads(previous) if isinstance(previous, str) else previous
            if replacement and payload == command.model_dump(mode='json'):
                return public_row(replacement)
        if row['status'] != 'scheduled' or row['revision'] != command.revision:
            raise GroupError('session_revision_conflict')
        await lock_keys(conn, [f'series:{command.replacementId}'])
        if await conn.fetchval('SELECT EXISTS(SELECT 1 FROM academy_sessions WHERE series_id=$1 OR id=$1)',
                               command.replacementId):
            raise GroupError('series_conflict')
        starts, ends = interval(command, command.localDate)
        validate_window(group, starts, ends)
        teachers = await teacher_ids(conn, group_id, command)
        new_keys = resource_keys(group, command.room, teachers)
        old_keys = [r['resource_key'] for r in await conn.fetch(
            'SELECT resource_key FROM academy_session_reservations WHERE session_id=$1', session_id)]
        await lock_keys(conn, old_keys + new_keys)
        await conn.execute('DELETE FROM academy_session_reservations WHERE session_id=$1', session_id)
        await conn.execute(
            """UPDATE academy_sessions SET status='rescheduled',reason=$2,revision=revision+1
                WHERE id=$1""", session_id, command.reason)
        new = await insert_session(conn, group, command.replacementId, command.replacementId,
                                   command, starts, ends, teachers, new_keys, replaces=session_id)
        await audit(conn, actor, 'rescheduled', session_id, command.model_dump(mode='json'))
        return public_row(new)


async def list_sessions(conn: Connection, group_id: UUID, actor_id: UUID, role: str,
                        page: int) -> dict:
    can_manage = role in GROUP_STAFF
    async with conn.transaction(isolation='repeatable_read', readonly=True):
        if not await conn.fetchval(
            """SELECT EXISTS (SELECT 1 FROM academy_groups g WHERE g.id=$1 AND
                   ($2::boolean OR EXISTS(SELECT 1 FROM academy_group_teachers t
                       WHERE t.group_id=g.id AND t.teacher_user_id=$3)
                    OR EXISTS(SELECT 1 FROM academy_sessions s JOIN academy_session_teachers st
                                    ON st.session_id=s.id
                                WHERE s.group_id=g.id AND st.teacher_user_id=$3)))""",
            group_id, can_manage, actor_id):
            raise GroupError('group_not_found', 404)
        rows = await conn.fetch(
            """SELECT s.*, ARRAY(SELECT coalesce(u.name,u.id::text) FROM academy_session_teachers st
                                    JOIN users u ON u.id=st.teacher_user_id WHERE st.session_id=s.id
                                  ORDER BY u.name,u.id) AS teacher_names
                 FROM academy_sessions s WHERE s.group_id=$1
                  AND ($2::boolean OR EXISTS(SELECT 1 FROM academy_session_teachers t
                          WHERE t.session_id=s.id AND t.teacher_user_id=$3))
                ORDER BY s.starts_at DESC, s.id DESC LIMIT $4 OFFSET $5""",
            group_id, can_manage, actor_id, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE)
    return {'sessions': [public_row(row) for row in rows[:PAGE_SIZE]],
            'hasNext': len(rows) > PAGE_SIZE, 'calendar': 'Asia/Tashkent'}
