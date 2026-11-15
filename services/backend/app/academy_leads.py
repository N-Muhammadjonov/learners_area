"""Recruitment leads with explicit conversion to an existing learner."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Annotated, Literal, Self
from uuid import UUID

from asyncpg import Connection, Record, UniqueViolationError
from pydantic import AwareDatetime, Field, StringConstraints, field_validator, model_validator

from . import academy_groups as groups

Stage = Literal['new', 'contacted', 'trial_scheduled', 'trial_completed', 'enrolled', 'lost']
PipelineStage = Literal['new', 'contacted', 'trial_scheduled', 'trial_completed', 'lost']
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
STAGES: dict[str, set[str]] = {
    'new': {'new', 'contacted', 'lost'},
    'contacted': {'contacted', 'trial_scheduled', 'lost'},
    'trial_scheduled': {'trial_scheduled', 'trial_completed', 'lost'},
    'trial_completed': {'trial_completed', 'lost'},
}
END_STAGES = {'enrolled', 'lost'}
PAGE_SIZE = 25


class Fields(groups.Command):
    name: groups.Label
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=40)
    source: groups.Label
    courseId: UUID | None = None
    assignedTo: UUID | None = None
    followUpAt: AwareDatetime | None = None
    trialAt: AwareDatetime | None = None

    @field_validator('email')
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', normalized):
            raise ValueError('Enter a valid email address')
        return normalized

    @field_validator('phone')
    @classmethod
    def normalize_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = re.sub(r'[ ()-]', '', value)
        if not re.fullmatch(r'\+[1-9][0-9]{7,14}', normalized):
            raise ValueError('Enter an international phone number')
        return normalized

    @model_validator(mode='after')
    def require_contact(self) -> Self:
        if not (self.email or self.phone):
            raise ValueError('An email or phone number is required')
        return self


class CreateLead(Fields):
    id: UUID


class UpdateLead(Fields):
    stage: PipelineStage
    revision: groups.Revision
    lostReason: Reason | None = None

    @model_validator(mode='after')
    def validate_stage(self) -> Self:
        if self.stage in ('trial_scheduled', 'trial_completed') and self.trialAt is None:
            raise ValueError('Trials require a date')
        if self.stage == 'lost' and self.lostReason is None:
            raise ValueError('A lost lead requires a reason')
        return self


class LeadNote(groups.Command):
    id: UUID
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1200)]


class ConvertLead(groups.Command):
    revision: groups.Revision
    studentId: UUID
    groupId: UUID


def projection(record: Record) -> dict:
    data = groups.public_row(record)
    data.pop('create_fingerprint', None)
    return data


async def audit(conn: Connection, actor: UUID, lead_id: UUID, action: str, detail: dict) -> None:
    await conn.execute(
        """INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
           VALUES($1,$2,'academy_lead',$3,$4::jsonb)""",
        actor, 'academy.lead.' + action, str(lead_id), json.dumps(detail))


async def lead_row(conn: Connection, lead_id: UUID, *, lock: bool = False) -> Record:
    query = 'SELECT * FROM academy_leads WHERE id=$1'
    record = await conn.fetchrow(query + (' FOR UPDATE' if lock else ''), lead_id)
    if not record:
        raise groups.GroupError('lead_not_found', 404)
    return record


async def validate_links(conn: Connection, command: Fields) -> None:
    if command.courseId and not await conn.fetchval(
            'SELECT 1 FROM courses WHERE id=$1 AND is_active', command.courseId):
        raise groups.GroupError('course_not_found', 404)
    if command.assignedTo and not await conn.fetchval(
            """SELECT 1 FROM users WHERE id=$1 AND role IN ('owner','admin')
                  AND account_status='active'""", command.assignedTo):
        raise groups.GroupError('lead_assignee_not_found', 404)


async def create(conn: Connection, actor: UUID, command: CreateLead) -> dict:
    fingerprint = hashlib.sha256(json.dumps(command.model_dump(mode='json'), sort_keys=True).encode()).hexdigest()
    async with conn.transaction():
        await validate_links(conn, command)
        row = await conn.fetchrow(
            """INSERT INTO academy_leads(id,name,email,phone,source,course_id,assigned_to,follow_up_at,
                                         trial_at,created_by,create_fingerprint)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING *""",
            command.id, command.name, command.email, command.phone, command.source, command.courseId,
            command.assignedTo, command.followUpAt, command.trialAt, actor, fingerprint)
        if row:
            await audit(conn, actor, command.id, 'created', {'assignedTo': str(command.assignedTo or '')})
            return projection(row)
        existing = await conn.fetchrow('SELECT * FROM academy_leads WHERE id=$1', command.id)
        if existing and existing['created_by'] == actor and existing['create_fingerprint'] == fingerprint:
            return projection(existing)
        raise groups.GroupError('lead_already_exists')


async def update(conn: Connection, actor: UUID, lead_id: UUID, command: UpdateLead) -> dict:
    try:
        async with conn.transaction():
            current = await lead_row(conn, lead_id, lock=True)
            if current['revision'] != command.revision:
                raise groups.GroupError('lead_revision_conflict')
            if command.stage not in STAGES.get(current['stage'], set()):
                raise groups.GroupError('lead_invalid_transition')
            trial_at = current['trial_at'] if command.stage == 'trial_completed' else command.trialAt
            if command.stage == 'trial_completed' and (trial_at is None or trial_at > datetime.now(timezone.utc)):
                raise groups.GroupError('trial_not_started')
            await validate_links(conn, command)
            row = await conn.fetchrow(
                """UPDATE academy_leads SET name=$2,email=$3,phone=$4,source=$5,course_id=$6,
                          assigned_to=$7,follow_up_at=$8,trial_at=$9,stage=$10,lost_reason=$11,
                          updated_at=now(),revision=revision+1 WHERE id=$1 RETURNING *""",
                lead_id, command.name, command.email, command.phone, command.source, command.courseId,
                command.assignedTo, None if command.stage == 'lost' else command.followUpAt,
                trial_at, command.stage, command.lostReason if command.stage == 'lost' else None)
            await audit(conn, actor, lead_id, 'updated', {
                'from': current['stage'], 'to': command.stage, 'revision': row['revision'],
                'fromAssignee': str(current['assigned_to'] or ''), 'toAssignee': str(command.assignedTo or ''),
            })
            return projection(row)
    except UniqueViolationError as exc:
        raise groups.GroupError('lead_already_exists') from exc


async def add_note(conn: Connection, actor: UUID, lead_id: UUID, command: LeadNote) -> dict:
    async with conn.transaction():
        await lead_row(conn, lead_id)
        changed = await conn.fetchrow(
            """INSERT INTO academy_lead_notes(id,lead_id,author_id,body)
                VALUES($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING RETURNING *""",
            command.id, lead_id, actor, command.body)
        if changed:
            await audit(conn, actor, lead_id, 'note_added', {'noteId': str(command.id)})
            return groups.public_row(changed)
        previous = await conn.fetchrow('SELECT * FROM academy_lead_notes WHERE id=$1', command.id)
        if previous and (previous['lead_id'], previous['author_id'], previous['body']) == (
                lead_id, actor, command.body):
            return groups.public_row(previous)
        raise groups.GroupError('lead_note_conflict')


async def convert(conn: Connection, actor: UUID, lead_id: UUID, command: ConvertLead) -> dict:
    async with conn.transaction(isolation='read_committed'):
        lead = await lead_row(conn, lead_id, lock=True)
        if lead['stage'] == 'enrolled' and lead['student_user_id'] == command.studentId:
            membership = await conn.fetchrow(
                'SELECT group_id FROM academy_group_memberships WHERE id=$1', lead['membership_id'])
            if membership and membership['group_id'] == command.groupId:
                return projection(lead)
        if lead['revision'] != command.revision:
            raise groups.GroupError('lead_revision_conflict')
        if lead['stage'] != 'trial_completed':
            raise groups.GroupError('lead_invalid_transition')
        group_course = await conn.fetchval('SELECT course_id FROM academy_groups WHERE id=$1', command.groupId)
        if group_course is None:
            raise groups.GroupError('group_not_found', 404)
        if lead['course_id'] is not None and group_course != lead['course_id']:
            raise groups.GroupError('lead_course_mismatch')
        # Serialize claims even when group enrolment returns an existing active membership.
        await groups.lock_student(conn, command.studentId)
        enrollment = await groups.enrol(conn, actor, command.groupId, groups.Enrol(studentId=command.studentId))
        membership_id = UUID(enrollment['id'])
        if await conn.fetchval('SELECT 1 FROM academy_leads WHERE membership_id=$1', membership_id):
            raise groups.GroupError('lead_membership_already_linked')
        row = await conn.fetchrow(
            """UPDATE academy_leads SET stage='enrolled',student_user_id=$2,membership_id=$3,
                      follow_up_at=NULL,updated_at=now(),revision=revision+1 WHERE id=$1 RETURNING *""",
            lead_id, command.studentId, membership_id)
        await audit(conn, actor, lead_id, 'enrolled', {'membershipId': enrollment['id']})
        return projection(row)


async def lead_list(conn: Connection, query: str, stage: Stage | None, page: int, mine: UUID | None) -> dict:
    rows = await conn.fetch(
        """SELECT l.*, c.title AS course_title, u.name AS assignee
             FROM academy_leads l LEFT JOIN courses c ON c.id=l.course_id
             LEFT JOIN users u ON u.id=l.assigned_to
            WHERE ($1::text IS NULL OR l.stage=$1) AND ($2::uuid IS NULL OR l.assigned_to=$2)
              AND ($3='' OR strpos(lower(l.name),lower($3))>0 OR strpos(coalesce(l.email,''),lower($3))>0
                         OR strpos(coalesce(l.phone,''),$3)>0)
            ORDER BY l.updated_at DESC,l.id LIMIT $4 OFFSET $5""",
        stage, mine, query, PAGE_SIZE + 1, (page - 1)*PAGE_SIZE)
    counts = await conn.fetch(
        """SELECT stage,count(*) AS count FROM academy_leads
              WHERE ($1::uuid IS NULL OR assigned_to=$1) GROUP BY stage""", mine)
    due = await conn.fetchval(
        """SELECT count(*) FROM academy_leads WHERE stage NOT IN ('enrolled','lost') AND follow_up_at<=now()
             AND ($1::uuid IS NULL OR assigned_to=$1)""", mine)
    return {'leads': [projection(row) for row in rows[:PAGE_SIZE]], 'hasNext': len(rows) > PAGE_SIZE,
            'stages': {row['stage']: row['count'] for row in counts}, 'followUpDue': due}


async def lead_detail(conn: Connection, lead_id: UUID, page: int) -> dict:
    row = await conn.fetchrow(
        """SELECT l.*, c.title AS course_title, u.name AS assignee
             FROM academy_leads l LEFT JOIN courses c ON c.id=l.course_id
              LEFT JOIN users u ON u.id=l.assigned_to WHERE l.id=$1""", lead_id)
    if not row:
        raise groups.GroupError('lead_not_found', 404)
    notes = await conn.fetch(
        """SELECT n.id,n.body,n.created_at,u.name AS author FROM academy_lead_notes n
              LEFT JOIN users u ON u.id=n.author_id WHERE lead_id=$1
              ORDER BY n.created_at DESC,n.id LIMIT $2 OFFSET $3""",
        lead_id, PAGE_SIZE + 1, (page-1)*PAGE_SIZE)
    return {'lead': projection(row), 'notes': [groups.public_row(n) for n in notes[:PAGE_SIZE]],
            'hasNext': len(notes) > PAGE_SIZE}


async def staff_choices(conn: Connection, query: str) -> list[dict]:
    rows = await conn.fetch(
        """SELECT id, name AS label FROM users WHERE role IN ('owner','admin') AND account_status='active'
              AND strpos(lower(coalesce(name,'')),lower($1))>0 ORDER BY name,id LIMIT 25""", query)
    return [groups.public_row(row) for row in rows]
