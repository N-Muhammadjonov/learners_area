"""Transactional cohort operations for existing courses and learner identities."""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Annotated, Literal, Self
from uuid import UUID
from zoneinfo import ZoneInfo

from asyncpg import Connection, Record
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

Calendar = ZoneInfo('Asia/Tashkent')
GroupStatus = Literal['active', 'paused', 'completed', 'archived']
MembershipStatus = Literal['pending', 'active', 'paused', 'completed', 'withdrawn']
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Revision = Annotated[int, Field(strict=True, ge=1, lt=2**31 - 1)]
CURRENT = ('pending', 'active', 'paused')
RESERVED = ('active', 'paused')
GROUP_STAFF = ('owner', 'admin')
PAGE_SIZE = 25


class GroupError(Exception):
    def __init__(self, code: str, status: int = 409):
        super().__init__(code)
        self.status = status
        self.code = code


class Command(BaseModel):
    model_config = ConfigDict(extra='forbid')


class GroupFields(Command):
    name: Label
    branch: Label
    room: Label | None = None
    feePlanLabel: Label | None = None
    capacity: Annotated[int, Field(strict=True, ge=1, le=1000)]
    startsOn: date
    endsOn: date | None = None
    status: GroupStatus = 'active'
    teacherIds: list[UUID] = Field(min_length=1, max_length=12)

    @field_validator('startsOn', 'endsOn', mode='before')
    @classmethod
    def calendar_date(cls, value: object) -> date | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError('Expected ISO calendar date')
        parsed = date.fromisoformat(value)
        if parsed.isoformat() != value:
            raise ValueError('Expected ISO calendar date')
        return parsed

    @model_validator(mode='after')
    def consistent(self) -> Self:
        if self.endsOn and self.endsOn < self.startsOn:
            raise ValueError('End date precedes start date')
        if len(set(self.teacherIds)) != len(self.teacherIds):
            raise ValueError('Repeated teacher')
        return self


class CreateGroup(GroupFields):
    id: UUID
    courseId: UUID


class UpdateGroup(GroupFields):
    revision: Revision


class Enrol(Command):
    studentId: UUID
    status: Literal['pending', 'active'] = 'active'


class UpdateMembership(Command):
    revision: Revision
    status: MembershipStatus


class Transfer(Command):
    revision: Revision
    groupId: UUID


def today() -> date:
    return datetime.now(Calendar).date()


def public_row(row: Record) -> dict:
    return {
        key: str(value) if isinstance(value, UUID) else value.isoformat() if isinstance(value, date) else value
        for key, value in row.items()
    }


async def audit(conn: Connection, actor: UUID, action: str, target: UUID, detail: dict) -> None:
    await conn.execute(
        """INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
           VALUES($1,$2,'academy_group',$3,$4::jsonb)""",
        actor, 'academy.group.' + action, str(target), json.dumps(detail))


async def list_groups(conn: Connection, actor: UUID, role: str, query: str,
                      status: str | None, page: int, course_id: UUID | None = None) -> dict:
    rows = await conn.fetch(
        """SELECT g.*, c.title AS course_title,
                  (SELECT count(*) FROM academy_group_memberships m
                    WHERE m.group_id=g.id AND m.status IN ('active','paused')) AS seats
             FROM academy_groups g JOIN courses c ON c.id=g.course_id
            WHERE ($1::boolean OR EXISTS(SELECT 1 FROM academy_group_teachers gt
                     WHERE gt.group_id=g.id AND gt.teacher_user_id=$2))
              AND ($3::text IS NULL OR g.status=$3)
              AND ($4='' OR strpos(lower(g.name), lower($4))>0
                         OR strpos(lower(g.branch), lower($4))>0
                         OR strpos(lower(c.title), lower($4))>0)
              AND ($7::uuid IS NULL OR g.course_id=$7)
            ORDER BY lower(g.name), g.id LIMIT $5 OFFSET $6""",
        role in GROUP_STAFF, actor, status, query, PAGE_SIZE + 1, PAGE_SIZE * (page - 1), course_id)
    results = [public_row(row) for row in rows[:PAGE_SIZE]]
    if role not in GROUP_STAFF:
        for group in results:
            group.pop('fee_plan_label')
    return {'groups': results, 'hasNext': len(rows) > PAGE_SIZE}


async def group_detail(conn: Connection, group_id: UUID, actor: UUID, role: str,
                       query: str, page: int) -> dict:
    async with conn.transaction(isolation='repeatable_read', readonly=True):
        can_manage = role in GROUP_STAFF
        group = await conn.fetchrow(
            """SELECT g.*, c.title AS course_title FROM academy_groups g
                JOIN courses c ON c.id=g.course_id WHERE g.id=$1
                  AND ($2::boolean OR EXISTS(SELECT 1 FROM academy_group_teachers gt
                      WHERE gt.group_id=g.id AND gt.teacher_user_id=$3))""",
            group_id, can_manage, actor)
        if not group:
            raise GroupError('group_not_found', 404)
        teachers = await conn.fetch(
            """SELECT u.id, u.name FROM academy_group_teachers gt JOIN users u ON u.id=gt.teacher_user_id
                WHERE gt.group_id=$1 ORDER BY u.name, u.id""", group_id)
        rows = await conn.fetch(
            """SELECT m.*, u.name AS student_name, EXISTS(SELECT 1 FROM teacher_student_links t
                       WHERE t.teacher_user_id=$2 AND t.student_user_id=m.student_user_id) AS profile_allowed
                 FROM academy_group_memberships m JOIN users u ON u.id=m.student_user_id
                WHERE m.group_id=$1 AND ($3::boolean OR m.status IN ('active','paused'))
                  AND ($4='' OR strpos(lower(coalesce(u.name,'')), lower($4))>0)
                ORDER BY m.starts_on DESC, m.id DESC LIMIT $5 OFFSET $6""",
            group_id, actor, can_manage, query, PAGE_SIZE + 1, PAGE_SIZE * (page - 1))
        result = public_row(group)
        if not can_manage:
            result.pop('fee_plan_label')
        return {'group': result, 'teachers': [public_row(row) for row in teachers],
                'memberships': [public_row(row) for row in rows[:PAGE_SIZE]],
                'hasNext': len(rows) > PAGE_SIZE}


async def lookup(conn: Connection, kind: str, query: str) -> list[dict]:
    if kind == 'courses':
        rows = await conn.fetch(
            """SELECT id, title AS label FROM courses WHERE is_active
               AND strpos(lower(title), lower($1))>0 ORDER BY title, id LIMIT 25""", query)
    else:
        rows = await conn.fetch(
            """SELECT id, coalesce(name,email,id::text) AS label FROM users
               WHERE (role::text=$1 OR ($1='teacher' AND role='owner')) AND account_status='active'
                 AND strpos(lower(coalesce(name,'') || ' ' || coalesce(email,'') || ' ' || id::text),
                            lower($2))>0 ORDER BY name, id LIMIT 25""",
            kind, query)
    return [public_row(row) for row in rows]


async def group_lock(conn: Connection, group_id: UUID) -> Record:
    row = await conn.fetchrow('SELECT * FROM academy_groups WHERE id=$1 FOR UPDATE', group_id)
    if not row:
        raise GroupError('group_not_found', 404)
    return row


async def validate_teachers(conn: Connection, ids: list[UUID]) -> None:
    rows = await conn.fetch(
        """SELECT id FROM users WHERE id=ANY($1::uuid[]) AND role IN ('teacher','owner')
           AND account_status='active' ORDER BY id FOR SHARE""", ids)
    if len(rows) != len(ids):
        raise GroupError('invalid_teachers', 422)


async def seat_count(conn: Connection, group_id: UUID) -> int:
    return await conn.fetchval(
        """SELECT count(*) FROM academy_group_memberships
            WHERE group_id=$1 AND status IN ('active','paused')""", group_id)


def assert_accepting(group: Record, day: date, *, pending: bool = False) -> None:
    outside_run = (group['ends_on'] is not None and group['ends_on'] < day
                   or not pending and group['starts_on'] > day)
    if group['status'] != 'active' or outside_run:
        raise GroupError('group_not_accepting')


async def available(conn: Connection, group: Record, state: str, day: date) -> None:
    assert_accepting(group, day, pending=state == 'pending')
    if state in RESERVED and await seat_count(conn, group['id']) >= group['capacity']:
        raise GroupError('group_full')


async def create_group(conn: Connection, actor: UUID, fields: CreateGroup) -> dict:
    return await save_group(conn, actor, fields.id, fields)


async def save_group(conn: Connection, actor: UUID, group_id: UUID,
                     fields: CreateGroup | UpdateGroup) -> dict:
    async with conn.transaction(isolation='read_committed'):
        await validate_teachers(conn, fields.teacherIds)
        values = (fields.name, fields.branch, fields.room, fields.feePlanLabel, fields.capacity,
                  fields.startsOn, fields.endsOn, fields.status)
        if isinstance(fields, CreateGroup):
            if fields.status not in ('active', 'paused'):
                raise GroupError('invalid_group_transition', 422)
            if not await conn.fetchval(
                    'SELECT id FROM courses WHERE id=$1 AND is_active FOR SHARE', fields.courseId):
                raise GroupError('course_not_found', 404)
            row = await conn.fetchrow(
                """INSERT INTO academy_groups(id,course_id,name,branch,room,fee_plan_label,
                          capacity,starts_on,ends_on,status)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                   ON CONFLICT(id) DO NOTHING RETURNING *""", group_id, fields.courseId, *values)
            if not row:
                current = await group_lock(conn, group_id)
                selected = await conn.fetch(
                    'SELECT teacher_user_id FROM academy_group_teachers WHERE group_id=$1', group_id)
                if (current['revision'] == 1 and current['course_id'] == fields.courseId
                        and tuple(current[key] for key in (
                            'name','branch','room','fee_plan_label','capacity','starts_on','ends_on','status')) == values
                        and {item['teacher_user_id'] for item in selected} == set(fields.teacherIds)):
                    return public_row(current)
                raise GroupError('group_revision_conflict')
            action = 'created'
        else:
            old = await group_lock(conn, group_id)
            if old['revision'] != fields.revision:
                raise GroupError('group_revision_conflict')
            if old['status'] == 'archived' or old['status'] == 'completed' and fields.status != 'archived':
                raise GroupError('invalid_group_transition')
            if await seat_count(conn, group_id) > fields.capacity:
                raise GroupError('capacity_below_occupied')
            if fields.status in ('completed', 'archived') and await conn.fetchval(
                    """SELECT EXISTS(SELECT 1 FROM academy_group_memberships
                                      WHERE group_id=$1 AND ends_on IS NULL)""", group_id):
                raise GroupError('group_has_members')
            row = await conn.fetchrow(
                """UPDATE academy_groups SET name=$2,branch=$3,room=$4,fee_plan_label=$5,
                      capacity=$6,starts_on=$7,ends_on=$8,status=$9,revision=revision+1
                    WHERE id=$1 RETURNING *""", group_id, *values)
            action = 'updated'
        await conn.execute(
            """DELETE FROM academy_group_teachers WHERE group_id=$1
                   AND NOT (teacher_user_id=ANY($2::uuid[]))""", group_id, fields.teacherIds)
        await conn.execute(
            """INSERT INTO academy_group_teachers(group_id,teacher_user_id)
               SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING""", group_id, fields.teacherIds)
        await audit(conn, actor, action, group_id, {
            **public_row(row), 'teacherIds': [str(teacher_id) for teacher_id in fields.teacherIds],
        })
        return public_row(row)


async def lock_student(conn: Connection, student_id: UUID, *, require_active: bool = True) -> None:
    row = await conn.fetchrow(
        "SELECT account_status FROM users WHERE id=$1 AND role='student' FOR UPDATE", student_id)
    if not row or require_active and row['account_status'] != 'active':
        raise GroupError('student_not_found', 404)


async def grant_curriculum(conn: Connection, student_id: UUID, course_id: UUID) -> None:
    # Caller holds the student row. Legacy course enrolment is durable across transfers and exits.
    await conn.execute(
        """INSERT INTO enrollments(user_id,course_id)
           SELECT $1,$2 WHERE NOT EXISTS (
               SELECT 1 FROM enrollments WHERE user_id=$1 AND course_id=$2)""",
        student_id, course_id)


async def record_member(conn: Connection, group: Record, student_id: UUID, state: str,
                        day: date, predecessor: UUID | None = None) -> Record:
    result = await conn.fetchrow(
        """INSERT INTO academy_group_memberships
                (group_id,course_id,student_user_id,starts_on,status,transferred_from_id)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING *""",
        group['id'], group['course_id'], student_id, day, state, predecessor)
    if state == 'active':
        await grant_curriculum(conn, student_id, group['course_id'])
    return result


async def enrol(conn: Connection, actor: UUID, group_id: UUID, command: Enrol) -> dict:
    async with conn.transaction(isolation='read_committed'):
        await lock_student(conn, command.studentId)
        group = await group_lock(conn, group_id)
        existing = await conn.fetchrow(
            """SELECT * FROM academy_group_memberships WHERE student_user_id=$1
                AND course_id=$2 AND ends_on IS NULL""", command.studentId, group['course_id'])
        if existing:
            if existing['group_id'] == group_id and existing['status'] == command.status:
                return public_row(existing)
            raise GroupError('student_has_current_group')
        day = today()
        await available(conn, group, command.status, day)
        row = await record_member(conn, group, command.studentId, command.status, day)
        await audit(conn, actor, 'enrolled', group_id,
                    {'membershipId': str(row['id']), 'status': command.status})
        return public_row(row)


async def membership(conn: Connection, group_id: UUID, member_id: UUID) -> Record:
    row = await conn.fetchrow(
        'SELECT * FROM academy_group_memberships WHERE id=$1 AND group_id=$2', member_id, group_id)
    if not row:
        raise GroupError('membership_not_found', 404)
    return row


async def set_membership(conn: Connection, actor: UUID, group_id: UUID, member_id: UUID,
                         command: UpdateMembership) -> dict:
    async with conn.transaction(isolation='read_committed'):
        initial = await membership(conn, group_id, member_id)
        await lock_student(conn, initial['student_user_id'], require_active=command.status == 'active')
        group = await group_lock(conn, group_id)
        row = await membership(conn, group_id, member_id)
        old = row['status']
        if (old == command.status and row['revision'] in (command.revision, command.revision + 1)):
            return public_row(row)
        if row['revision'] != command.revision:
            raise GroupError('membership_revision_conflict')
        transitions = {'pending': ('active', 'withdrawn'),
                       'active': ('paused', 'completed', 'withdrawn'),
                       'paused': ('active', 'completed', 'withdrawn')}
        if command.status not in transitions.get(old, ()):
            raise GroupError('invalid_membership_transition')
        day = today()
        if command.status == 'active':
            if old in RESERVED:
                assert_accepting(group, day)
            else:
                await available(conn, group, command.status, day)
        result = await conn.fetchrow(
            """UPDATE academy_group_memberships SET status=$2,ends_on=$3,revision=revision+1
                WHERE id=$1 RETURNING *""",
            member_id, command.status, None if command.status in CURRENT else day)
        if command.status == 'active':
            await grant_curriculum(conn, row['student_user_id'], row['course_id'])
        await audit(conn, actor, 'membership_updated', group_id,
                    {'membershipId': str(member_id), 'from': old, 'to': command.status})
        return public_row(result)


async def transfer(conn: Connection, actor: UUID, group_id: UUID, member_id: UUID,
                   command: Transfer) -> dict:
    if group_id == command.groupId:
        raise GroupError('same_group', 422)
    async with conn.transaction(isolation='read_committed'):
        before = await membership(conn, group_id, member_id)
        await lock_student(conn, before['student_user_id'])
        first, second = sorted((group_id, command.groupId))
        groups = {first: await group_lock(conn, first), second: await group_lock(conn, second)}
        row = await membership(conn, group_id, member_id)
        target = groups[command.groupId]
        if row['status'] == 'transferred' and row['revision'] == command.revision + 1:
            existing = await conn.fetchrow(
                """SELECT * FROM academy_group_memberships WHERE transferred_from_id=$1
                    AND group_id=$2""", member_id, command.groupId)
            if existing:
                return public_row(existing)
        if row['revision'] != command.revision or row['status'] not in RESERVED:
            raise GroupError('membership_revision_conflict')
        if row['course_id'] != target['course_id']:
            raise GroupError('transfer_course_mismatch', 422)
        day = today()
        await available(conn, target, row['status'], day)
        await conn.execute(
            """UPDATE academy_group_memberships
                  SET status='transferred',ends_on=$2,revision=revision+1 WHERE id=$1""",
            member_id, day)
        result = await record_member(conn, target, row['student_user_id'], row['status'], day, member_id)
        await audit(conn, actor, 'transferred', group_id,
                    {'membershipId': str(member_id), 'targetGroupId': str(target['id']),
                     'targetMembershipId': str(result['id'])})
        return public_row(result)


async def student_groups(conn: Connection, student_id: UUID, page: int) -> dict:
    rows = await conn.fetch(
        """SELECT m.id,m.group_id,m.status,m.starts_on,m.ends_on,m.transferred_from_id,
                  g.name,g.branch,c.title AS course_title
             FROM academy_group_memberships m JOIN academy_groups g ON g.id=m.group_id
             JOIN courses c ON c.id=m.course_id WHERE m.student_user_id=$1
            ORDER BY m.starts_on DESC, m.id DESC LIMIT $2 OFFSET $3""",
        student_id, PAGE_SIZE + 1, PAGE_SIZE * (page - 1))
    return {'memberships': [public_row(row) for row in rows[:PAGE_SIZE]],
            'hasNext': len(rows) > PAGE_SIZE}
