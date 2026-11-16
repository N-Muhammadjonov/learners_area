"""Staff commands for approved service contracts; parent payments use the existing portal."""
from __future__ import annotations

from datetime import date
from uuid import UUID
from fastapi import APIRouter,Depends,Request
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel,ConfigDict,field_validator

from . import main as core,prepaid_services as service
from .academy_availability import require_academy
from .tuition_port import actor,payload,invalid,failure,PRIVATE,_write_gate,serialize
from .tuition_schemas import parse,ValidationError
from .tuition_ledger import LedgerError

router=APIRouter(dependencies=[Depends(require_academy)])


class ConsumeDay(BaseModel):
    model_config=ConfigDict(extra='forbid')
    serviceDate: date

    @field_validator('serviceDate',mode='before')
    @classmethod
    def calendar_date(cls,value):
        return service.PolicyCreate.calendar_date(value)


async def command(req: Request,kind: str,policy_id: UUID | None=None,pause_id: UUID | None=None):
    user,denied=await actor(req,('owner',) if kind=='approve_pause' else ('owner','admin'))
    if denied:return denied
    model={'create':service.PolicyCreate,'pause':service.PauseCreate,'day':ConsumeDay}.get(kind)
    try:body=parse(model,await payload(req)) if model else None
    except ValidationError as exc:return invalid(exc)
    limited=await _write_gate(req,user,'service_policy')
    if limited:return limited
    pool=await core.pool()
    try:
        async with pool.acquire() as conn,conn.transaction():
            if kind=='create':result=await service.create_policy(conn,user['id'],body)
            elif kind=='pause':result=await service.request_pause(conn,user['id'],policy_id,body)
            elif kind=='approve_pause':result=await service.approve_pause(conn,user['id'],policy_id,pause_id)
            else:result=await service.consume(conn,policy_id,service_date=body.serviceDate,session_id=None,actor=user['id'])
    except LedgerError as exc:return failure(exc)
    return core.j(jsonable_encoder(result),headers=PRIVATE)


@router.post('/api/staff/finance/service-policies')
async def create_policy(req: Request):return await command(req,'create')


@router.get('/api/staff/finance/students/{student_id}/service-policies')
async def student_policies(req: Request,student_id: UUID):
    user,denied=await actor(req,('owner','admin'))
    if denied:return denied
    pool=await core.pool()
    async with pool.acquire() as conn,conn.transaction(readonly=True):
        result=await service.accounts(conn,student_id)
        pauses=await conn.fetch('''SELECT s.* FROM tuition_service_pauses s JOIN tuition_service_policies p ON p.id=s.policy_id
            WHERE p.student_user_id=$1 ORDER BY s.created_at DESC LIMIT 100''',student_id) if result else []
    return core.j(jsonable_encoder({'policies':result,'pauses':[dict(p) for p in pauses],
        'purchasesEnabled':service.purchases_enabled()}),headers=PRIVATE)


@router.post('/api/staff/finance/service-policies/{policy_id}/pauses')
async def request_pause(req: Request,policy_id: UUID):return await command(req,'pause',policy_id)


@router.post('/api/staff/finance/service-policies/{policy_id}/pauses/{pause_id}/approve')
async def approve_pause(req: Request,policy_id: UUID,pause_id: UUID):return await command(req,'approve_pause',policy_id,pause_id)


@router.post('/api/staff/finance/service-policies/{policy_id}/days')
async def consume_day(req: Request,policy_id: UUID):return await command(req,'day',policy_id)


def install() -> None:core.app.include_router(router)
