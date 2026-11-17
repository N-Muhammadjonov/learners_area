"""RIWI read/draft surface. Authority and evidence scope are always server-selected."""
from __future__ import annotations

import os
from uuid import UUID,uuid4
from fastapi import APIRouter,Depends,Request

from . import main as core,guardian_port as guardian,academy_assistant as assistant
from . import riwi_workflows as workflows
from .academy_availability import require_academy
from .rate_limit import RULES,async_counter,too_many
from .riwi_audit import record_riwi_usage_metric
from .riwi_capabilities import RiwiActor
from .riwi_rollout import read_riwi_rollout,riwi_enabled_for_role
from .riwi_tool_broker import RiwiToolBrokerError
from .riwi_tools_domain import build_default_riwi_tool_broker
from .tuition_port import actor,PRIVATE,payload,invalid
from .tuition_schemas import parse,ValidationError
from .runtime_config import academy_assistant_enabled
from .self_service_payment_port import require_payments

router=APIRouter(dependencies=[Depends(require_academy)])
for role,limit in {'owner':120,'admin':100,'teacher':60,'student':30,'guardian':20}.items():
    RULES.setdefault('ai_provider_academy_'+role,(limit,3600))


async def respond(req: Request, *, mode: str,child_id: UUID | None=None):
    if not academy_assistant_enabled() or not read_riwi_rollout().enabled:return core.j({'error':'riwi_disabled'},503,PRIVATE)
    if mode=='guardian':
        user,_,denied=await guardian.guardian_actor(req)
    else:
        user,denied=await actor(req,('student',) if mode=='student' else ('owner','admin','teacher'))
    if denied:return denied
    allowed=(os.getenv('RIWI_GUARDIAN_ENABLED','1').lower() not in ('0','false','off','no') if user['role']=='guardian'
             else riwi_enabled_for_role(user['role']))
    if not allowed:return core.j({'error':'riwi_disabled'},503,PRIVATE)
    try:body=parse(assistant.AssistantRequest,await payload(req))
    except ValidationError as exc:return invalid(exc)
    if body.workflowId and not workflows.allowed(user['role'],body.workflowId):
        return core.j({'error':'forbidden'},403,PRIVATE)
    required_workflow={'payment_help':'payments','parent_message_draft':'parent_message'}.get(body.action)
    if body.workflowId and required_workflow and body.workflowId!=required_workflow:
        return core.j({'error':'forbidden'},403,PRIVATE)
    if mode in ('guardian','student'):
        if body.action!='payment_help' or body.studentId not in (None,child_id if mode=='guardian' else user['id']):
            return core.j({'error':'forbidden'},403,PRIVATE)
        tool='academy.read_payment';target=child_id if mode=='guardian' else None
    else:
        if body.action=='payment_help':return core.j({'error':'forbidden'},403,PRIVATE)
        if body.action=='parent_message_draft' and body.studentId is None:return core.j({'error':'student_required'},422,PRIVATE)
        tool='academy.draft_parent_message' if body.action=='parent_message_draft' else 'academy.read_workbench'
        target=body.studentId
    delay=await async_counter('ai_provider_academy_'+user['role'],'u:'+str(user['id']),consume=True)
    if delay:return too_many(delay)
    pool=await core.pool()
    identity=RiwiActor(id=str(user['id']),role=user['role'],account_status=user['account_status'],locale=body.locale)
    broker=build_default_riwi_tool_broker()
    try:
        # Audit/read inside a bounded transaction. No connection or child lock is held
        # while an optional external model is pending.
        async with pool.acquire() as conn,conn.transaction():
            facts=await broker.execute(conn,actor=identity,tool_name=tool,raw_input={'studentId':str(target) if target else None})
    except RiwiToolBrokerError as exc:
        return core.j({'error':'forbidden' if exc.code in ('forbidden','tool_execution_failed') else exc.code},
                      403 if exc.code in ('forbidden','tool_execution_failed') else 503,PRIVATE)
    result,metric=await assistant.propose(str(user['id']),body,facts,role=user['role'])
    async with pool.acquire() as conn:
        correlation=str(uuid4())
        await record_riwi_usage_metric(conn,actor_user_id=str(user['id']),actor_role=user['role'],
            task_profile='academy_'+body.action,provider_id='configured_gateway' if metric['model'] else None,
            model=metric['model'],state=metric['state'],duration_ms=metric['durationMs'],correlation_id=correlation,
            input_tokens=metric['inputTokens'],output_tokens=metric['outputTokens'],estimated_cost_micros=metric['estimatedCostMicros'])
    return core.j(result,headers=PRIVATE)


@router.post('/api/staff/academy/assistant/proposals')
async def academy_staff_proposal(req: Request):
    return await respond(req,mode='staff')


@router.post('/api/finance/me/assistant',dependencies=[Depends(require_payments)])
async def academy_student_payment_help(req: Request):
    return await respond(req,mode='student')


@router.post('/api/guardian/children/{child_id}/assistant',dependencies=[Depends(require_payments)])
async def academy_guardian_payment_help(req: Request,child_id: UUID):
    return await respond(req,mode='guardian',child_id=child_id)


def install() -> None:
    core.app.include_router(router)
