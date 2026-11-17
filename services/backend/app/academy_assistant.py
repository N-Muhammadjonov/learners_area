"""RIWI evidence selection. Model output can rank known facts, never issue commands."""
from __future__ import annotations

import asyncio
import os
import time
from typing import Annotated,Literal
from uuid import UUID

from pydantic import BaseModel,ConfigDict,Field,StringConstraints
from . import riwi_ai_gateway as gateway
from .riwi_rollout import read_riwi_rollout
from . import riwi_workflows as workflows

GATEWAY_TIMEOUT_SECONDS=3


class AssistantRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    action: Literal['daily_brief','payment_help','parent_message_draft']
    studentId: UUID | None=None
    locale: Literal['uz','en']='uz'
    question: Annotated[str,StringConstraints(max_length=1000)]=''
    workflowId: Annotated[str,StringConstraints(pattern=r'^[a-z_]{1,40}$')] | None=None


class EvidenceSelection(BaseModel):
    model_config=ConfigDict(extra='forbid')
    evidenceIds: list[str]=Field(min_length=1,max_length=5)
    workflowIds: list[str]=Field(default_factory=list,max_length=3)


async def propose(actor_id: str,request: AssistantRequest,facts: dict, *, role: str | None=None) -> tuple[dict,dict]:
    started=time.monotonic();items=facts['evidence'];selected=[r['id'] for r in items]
    role=role or ('student' if request.action=='payment_help' else 'teacher')
    guidance=workflows.select(role,request.action,request.question,request.workflowId,items)
    candidates=(workflows.available(role) if request.action=='daily_brief' and not request.workflowId else guidance)
    context=workflows.provider_context(role)
    state='local';usage={'inputTokens':0,'outputTokens':0};model=None
    rollout=read_riwi_rollout();ready=gateway.readiness()
    if rollout.external_ai and os.getenv('ACADEMY_AI_EXTERNAL_ENABLED')=='1' and os.getenv('ACADEMY_AI_PROVIDER_VERIFIED')=='1' and ready['credentialsConfigured'] and ready['modelConfigured']:
        model=ready['model'];state='fallback';usage={'inputTokens':None,'outputTokens':None}
        try:
            value,usage=await asyncio.wait_for(gateway.completion(actor_id,model,
                'Return only JSON {"evidenceIds":[...],"workflowIds":[...]}. Prioritize provided evidence and suggested workflow IDs using the reviewed process context. Money and dates are computed by the site. Missing input is unknown, never zero. Do not invent IDs, change facts, return prose, commands, SQL, links, permissions or approval fields.',
                {'action':request.action,
                 'processContext':context,'suggestedWorkflows':[workflow.id for workflow in guidance],
                 'facts':[{'id':r['id'],'kind':r['kind'],'value':r['value'],'unit':r['unit']} for r in items]},max_tokens=500),
                timeout=GATEWAY_TIMEOUT_SECONDS)
            selection=EvidenceSelection.model_validate(value);choice=selection.evidenceIds
            if len(choice)!=len(set(choice)) or not set(choice)<={r['id'] for r in items}:raise ValueError('foreign_evidence')
            ids=selection.workflowIds
            if len(ids)!=len(set(ids)) or not set(ids)<={workflow.id for workflow in candidates}:
                raise ValueError('foreign_workflow')
            if ids:
                guidance=([workflow for key in ids for workflow in candidates if workflow.id==key]
                          +[workflow for workflow in guidance if workflow.id not in ids])[:3]
            selected=choice;state='external'
        except Exception:
            state='fallback'
    chosen={key:index for index,key in enumerate(selected)}
    # Ranking must not hide remaining balances, refunds or operational exceptions.
    ordered=sorted(items,key=lambda r:chosen.get(r['id'],len(chosen)))
    # Financial language and all amounts are supplied by deterministic facts, not model prose.
    result={'brand':'RIWI','action':request.action,'mode':state,'observedAt':facts['observedAt'],
            'evidence':ordered,'approvalRequired':request.action=='parent_message_draft','canExecute':False,
            'draftText':facts.get('draftText'),'reviewHref':facts.get('reviewHref'),
            'contextVersion':context['version'],
            'workflows':[{**workflows.public(workflow,request.locale),
                          **({'href':items[0]['sourceHref']} if role=='guardian' and workflow.id=='payments' else {})}
                         for workflow in guidance],
            'availableWorkflows':[{'id':workflow.id,'title':workflows.public(workflow,request.locale)['title']}
                                  for workflow in workflows.available(role)
                                  if request.action=='daily_brief' or workflow in guidance],
            'questionMatched':bool(request.workflowId or workflows.matching(role,request.question))}
    metric={'model':model,'state':state,'durationMs':int((time.monotonic()-started)*1000),
            'inputTokens':usage.get('inputTokens'),'outputTokens':usage.get('outputTokens'),
            'estimatedCostMicros':0 if state=='local' else None}
    return result,metric
