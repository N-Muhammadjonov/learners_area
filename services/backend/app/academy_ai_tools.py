"""Typed read/draft tools registered in the existing RIWI broker, never a SQL executor."""
from __future__ import annotations

from datetime import datetime,timezone
import hashlib
import json
from typing import Annotated,Literal
from uuid import UUID

from asyncpg import Connection
from pydantic import BaseModel,ConfigDict,Field,Strict
from . import academy_workbench as workbench
from . import tuition_ledger as ledger
from .riwi_capabilities import RiwiActor
from .riwi_tool_broker import RiwiToolBroker,RiwiToolDefinition
from .runtime_config import academy_assistant_enabled


class ToolInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    studentId: UUID | None=None


class Evidence(BaseModel):
    model_config=ConfigDict(extra='forbid')
    id: str
    kind: str
    value: Annotated[int,Strict()]
    unit: Literal['count','UZS']
    sourceApi: str
    sourceHref: str


class Facts(BaseModel):
    model_config=ConfigDict(extra='forbid')
    observedAt: str
    evidence: list[Evidence]
    draftText: str | None=None
    reviewHref: str | None=None


def fact(kind: str,value: int,unit: str,source: str,href: str,stamp: str) -> dict:
    fingerprint=hashlib.sha256(json.dumps([kind,value,source,stamp],separators=(',',':')).encode()).hexdigest()
    return Evidence(id='ev_'+fingerprint[:24],kind=kind,value=value,unit=unit,sourceApi=source,sourceHref=href).model_dump()


def parse_input(value) -> dict:
    return ToolInput.model_validate(value).model_dump(mode='json')


def parse_output(value) -> dict:
    return Facts.model_validate(value).model_dump(mode='json')


async def operational_evidence(conn: Connection, actor: RiwiActor, stamp: str) -> list[dict]:
    """Count current operational records without exposing identities to the model."""
    if actor.role == 'teacher':
        count = await conn.fetchval('''SELECT count(*) FROM users u
            WHERE u.role='student' AND u.account_status='active'
              AND EXISTS(SELECT 1 FROM teacher_student_links t
                WHERE t.student_user_id=u.id AND t.teacher_user_id=$1)''', UUID(actor.id))
        return [fact('assigned_active_students', count, 'count', '/api/frontend/staff/teacher-students',
                     '/app/teacher/students', stamp)]
    if actor.role not in ('owner', 'admin'):
        raise PermissionError('staff_scope_required')
    row = await conn.fetchrow('''WITH groups AS (
        SELECT g.capacity,(SELECT count(*) FROM academy_group_memberships m
            WHERE m.group_id=g.id AND m.status IN ('active','paused')) AS reserved
          FROM academy_groups g WHERE g.status='active'
    ) SELECT
        (SELECT count(*) FROM groups) AS active_groups,
        (SELECT coalesce(sum(greatest(capacity-reserved,0)),0)::bigint FROM groups) AS available_seats,
        (SELECT count(*) FROM academy_leads WHERE stage NOT IN ('enrolled','lost')) AS active_leads,
        (SELECT count(*) FROM academy_leads WHERE stage='trial_scheduled') AS trials_scheduled''')
    return [fact(kind, row[kind], 'count', source, href, stamp) for kind, source, href in (
        ('active_groups', '/api/staff/academy/groups', '/app/management/groups'),
        ('available_seats', '/api/staff/academy/groups', '/app/management/groups'),
        ('active_leads', '/api/staff/academy/leads', '/app/management/leads'),
        ('trials_scheduled', '/api/staff/academy/leads', '/app/management/leads'),
    )]


async def read_workbench(conn,actor: RiwiActor,data: dict) -> dict:
    if data['studentId'] is not None:raise PermissionError('target_not_permitted')
    day=await workbench.today(conn,actor_id=UUID(actor.id),role=actor.role)
    stamp=day['observedAt'];source='/api/staff/academy/today'
    facts=[fact('classes_today',day['classes']['count'],'count',source,'/app/management#today-classes',stamp)]
    if actor.role in ('owner','admin'):
        today=ledger.business_date(datetime.now(timezone.utc))
        summary=await ledger.finance_summary(conn,start=today.replace(day=1),end=today)
        uri=f'/api/staff/finance/summary?start={today.replace(day=1)}&end={today}'
        facts.extend([fact('accounts_due',day['balances']['count'],'count','/api/staff/finance/debtors','/app/management/finance?view=debts',stamp),
            fact('collection_net',summary['collectedNetMinor'],'UZS',uri,'/app/management/finance',stamp),
            fact('revenue_recognized',summary['recognizedRevenueMinor'],'UZS',uri,'/app/management/finance',stamp),
            fact('followups_due',day['followUps']['count'],'count',source,'/app/management#today-followups',stamp)])
    else:
        facts.append(fact('parent_links',int(day['parents']['count']),'count',source,'/app/management/guardians',stamp))
    facts.extend(await operational_evidence(conn,actor,stamp))
    return {'observedAt':stamp,'evidence':facts}


async def read_payment(conn,actor: RiwiActor,data: dict) -> dict:
    target=UUID(actor.id)
    if actor.role=='guardian':
        if not data['studentId']:raise PermissionError('linked_child_required')
        target=UUID(data['studentId'])
        allowed=await conn.fetchval('''SELECT l.student_id FROM guardian_links l
            JOIN guardian_profiles g ON g.id=l.guardian_profile_id JOIN users u ON u.id=l.student_id
            WHERE g.user_id=$1 AND l.student_id=$2 AND l.status='linked'
              AND u.role='student' AND u.account_status='active'
            FOR SHARE OF l,g,u''',UUID(actor.id),target)
        if not allowed:raise PermissionError('linked_child_required')
        source=f'/api/guardian/children/{target}/payments';href=f'/app/payments?child={target}'
    else:
        if data['studentId'] not in (None,actor.id):raise PermissionError('self_scope_required')
        source='/api/finance/me/payments';href='/app/payments'
    position=await ledger.student_position(conn,target);stamp=position['asOf']
    facts=[fact(kind,position[key],'UZS',source,href,stamp) for kind,key in (
        ('balance_due','balanceDueMinor'),('advance','advanceMinor'),('settled_refunds','refundedMinor'))]
    return {'observedAt':stamp,'evidence':facts}


async def draft_parent_message(conn,actor: RiwiActor,data: dict) -> dict:
    if not data['studentId']:raise PermissionError('student_required')
    target=UUID(data['studentId'])
    row=await conn.fetchrow("""SELECT u.id,u.name,l.id AS link_id FROM users u JOIN guardian_links l ON l.student_id=u.id
        WHERE u.id=$1 AND u.role='student' AND l.status='linked'
        AND ($2 OR EXISTS(SELECT 1 FROM teacher_student_links t WHERE t.teacher_user_id=$3 AND t.student_user_id=u.id))
        ORDER BY l.id LIMIT 1 FOR SHARE OF u,l""",
        target,actor.role in ('owner','admin'),UUID(actor.id))
    if not row:raise PermissionError('student_not_assigned')
    text=(f"Assalomu alaykum. {row['name']}ning o‘qishi va keyingi qadamlarini birga ko‘rib chiqishni taklif qilamiz. Qulay vaqtingizni yozishingiz mumkin." if actor.locale=='uz' else
          f"Hello. We would like to review {row['name']}’s learning and next steps together. Please reply with a convenient time.")
    stamp=datetime.now(timezone.utc).isoformat()
    return {'observedAt':stamp,'evidence':[fact('verified_student',1,'count',f"/api/staff/guardians/{row['link_id']}",
        '/app/management/guardians',stamp)],'draftText':text,'reviewHref':'/app/management/guardians'}


def register_academy_tools(broker: RiwiToolBroker) -> None:
    if not academy_assistant_enabled():return
    for name,capability,roles,handler in (
        ('academy.read_workbench','riwi.academy.read_workbench',('owner','admin','teacher'),read_workbench),
        ('academy.read_payment','riwi.academy.payment_help',('student','guardian'),read_payment),
        ('academy.draft_parent_message','riwi.academy.draft_parent_message',('owner','admin','teacher'),draft_parent_message),
    ):
        broker.register(RiwiToolDefinition(name=name,required_capability=capability,allowed_roles=roles,
            input_validator=parse_input,output_validator=parse_output,handler=handler,mutating=False,requires_confirmation=False))
