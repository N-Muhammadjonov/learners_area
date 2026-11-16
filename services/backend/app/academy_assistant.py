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

GATEWAY_TIMEOUT_SECONDS=3


class AssistantRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    action: Literal['daily_brief','payment_help','parent_message_draft']
    studentId: UUID | None=None
    locale: Literal['uz','en']='uz'
    question: Annotated[str,StringConstraints(max_length=1000)]=''


class EvidenceSelection(BaseModel):
    model_config=ConfigDict(extra='forbid')
    evidenceIds: list[str]=Field(min_length=1,max_length=5)


async def propose(actor_id: str,request: AssistantRequest,facts: dict) -> tuple[dict,dict]:
    started=time.monotonic();items=facts['evidence'];selected=[r['id'] for r in items]
    state='local';usage={'inputTokens':0,'outputTokens':0};model=None
    rollout=read_riwi_rollout();ready=gateway.readiness()
    if rollout.external_ai and os.getenv('ACADEMY_AI_EXTERNAL_ENABLED')=='1' and os.getenv('ACADEMY_AI_PROVIDER_VERIFIED')=='1' and ready['credentialsConfigured'] and ready['modelConfigured']:
        model=ready['model'];state='fallback';usage={'inputTokens':None,'outputTokens':None}
        try:
            value,usage=await asyncio.wait_for(gateway.completion(actor_id,model,
                'Return only JSON {"evidenceIds":[...]}. Rank provided evidence IDs. Do not invent IDs, change facts, return prose, commands, SQL, permissions or approval fields.',
                {'action':request.action,
                 'facts':[{'id':r['id'],'kind':r['kind'],'value':r['value'],'unit':r['unit']} for r in items]},max_tokens=500),
                timeout=GATEWAY_TIMEOUT_SECONDS)
            choice=EvidenceSelection.model_validate(value).evidenceIds
            if len(choice)!=len(set(choice)) or not set(choice)<={r['id'] for r in items}:raise ValueError('foreign_evidence')
            selected=choice;state='external'
        except Exception:
            state='fallback'
    chosen={key:index for index,key in enumerate(selected)}
    ordered=sorted((r for r in items if r['id'] in chosen),key=lambda r:chosen[r['id']])
    # Financial language and all amounts are supplied by deterministic facts, not model prose.
    result={'brand':'RIWI','action':request.action,'mode':state,'observedAt':facts['observedAt'],
            'evidence':ordered,'approvalRequired':request.action=='parent_message_draft','canExecute':False,
            'draftText':facts.get('draftText'),'reviewHref':facts.get('reviewHref')}
    metric={'model':model,'state':state,'durationMs':int((time.monotonic()-started)*1000),
            'inputTokens':usage.get('inputTokens'),'outputTokens':usage.get('outputTokens'),
            'estimatedCostMicros':0 if state=='local' else None}
    return result,metric
