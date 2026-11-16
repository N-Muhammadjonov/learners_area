"""Narrow student/linked-child payment portal; no staff money-write permissions."""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from . import main as core
from . import guardian_port as guardian
from . import self_service_payments as payments
from . import tuition_port as finance
from .tuition_ledger import LedgerError
from .tuition_schemas import ValidationError, parse


async def require_payments() -> None:
    if not payments.enabled():
        raise HTTPException(404,'Not Found',headers=finance.PRIVATE)


router=APIRouter(dependencies=[Depends(require_payments)])


async def portal(req: Request, child_id: UUID | None, *, body=None,
                 intent_id: UUID | None = None, offset: int = 0, limit: int = 20,
                 status: str | None = None, refresh: bool = False):
    profile=None
    if child_id is not None:
        user,profile,denied=await guardian.guardian_actor(req)
    else:
        user,denied=await finance.actor(req,('student',))
    if denied:
        return denied
    if body is not None:
        try:
            body=parse(payments.IntentCreate,body)
        except ValidationError as exc:
            return finance.invalid(exc)
        limited=await finance._write_gate(req,user,'payment_intent')
        if limited:
            return limited
    db=await core.pool()
    try:
        async with db.acquire() as conn, conn.transaction():
            if profile:
                # The row lock establishes one ordering with link revocation and prevents
                # a successful authorization followed by a write after revocation.
                link=await conn.fetchrow('''SELECT l.id FROM guardian_links l JOIN users u ON u.id=l.student_id
                    WHERE l.guardian_profile_id=$1 AND l.student_id=$2 AND l.status='linked'
                      AND u.role='student' AND u.account_status='active' FOR SHARE OF l,u''',profile['id'],child_id)
                if not link:
                    return finance.err('forbidden',403)
                student_id,link_id=child_id,link['id']
            else:
                student_id,link_id=user['id'],None
            if body is not None:
                result=await payments.create_intent(conn,payer=user,student_id=student_id,link_id=link_id,body=body)
            elif intent_id:
                row=await payments.intent_row(conn,intent_id,lock=refresh)
                if not row or row['student_user_id']!=student_id:
                    return finance.err('intent_not_found',404)
                if refresh and row['provider']=='uzum' and row['provider_transaction_id'] and row['status'] not in payments.TERMINAL:
                    from .payment_providers import verify_uzum
                    limited=await finance._write_gate(req,user,'payment_status')
                    if limited:return limited
                    config=payments.provider_config('uzum')
                    payments.require(config['available'],'provider_unavailable')
                    row=await verify_uzum(conn,row,config)
                result=await payments.public_intent(conn,row)
            else:
                result=await payments.summary(conn,student_id,offset=offset,limit=limit,status=status)
        if body is not None and body.provider=='uzum':
            from .payment_providers import register_uzum
            async with db.acquire() as conn, conn.transaction():
                row=await payments.intent_row(conn,UUID(result['intentId']),lock=True)
                row=await register_uzum(conn,row,payments.provider_config('uzum'))
                result=await payments.public_intent(conn,row)
    except LedgerError as exc:
        return finance.failure(exc)
    return core.j(result,headers=finance.PRIVATE)


@router.get('/api/finance/me/payments')
async def my_payments(req: Request,offset: int=Query(0,ge=0,le=100000),limit: int=Query(20,ge=1,le=50),
                      status: Literal['created','pending','paid','failed','cancelled','expired','partially_refunded','refunded'] | None=None):
    return await portal(req,None,offset=offset,limit=limit,status=status)


@router.post('/api/finance/me/intents')
async def create_my_intent(req: Request):
    # Parse even an absent/invalid JSON body through the same strict contract.
    return await portal(req,None,body=(await finance.payload(req)) or {})


@router.get('/api/finance/me/intents/{intent_id}')
async def my_intent(req: Request,intent_id: UUID):
    return await portal(req,None,intent_id=intent_id)


@router.post('/api/finance/me/intents/{intent_id}/refresh')
async def refresh_my_intent(req: Request,intent_id: UUID):
    return await portal(req,None,intent_id=intent_id,refresh=True)


@router.get('/api/guardian/children/{child_id}/payments')
async def child_payments(req: Request,child_id: UUID,offset: int=Query(0,ge=0,le=100000),
                         limit: int=Query(20,ge=1,le=50),
                         status: Literal['created','pending','paid','failed','cancelled','expired','partially_refunded','refunded'] | None=None):
    return await portal(req,child_id,offset=offset,limit=limit,status=status)


@router.post('/api/guardian/children/{child_id}/payments/intents')
async def create_child_intent(req: Request,child_id: UUID):
    return await portal(req,child_id,body=(await finance.payload(req)) or {})


@router.get('/api/guardian/children/{child_id}/payments/intents/{intent_id}')
async def child_intent(req: Request,child_id: UUID,intent_id: UUID):
    return await portal(req,child_id,intent_id=intent_id)


@router.post('/api/guardian/children/{child_id}/payments/intents/{intent_id}/refresh')
async def refresh_child_intent(req: Request,child_id: UUID,intent_id: UUID):
    return await portal(req,child_id,intent_id=intent_id,refresh=True)


def install() -> None:
    core.app.include_router(router)


@router.post('/api/payments/callbacks/payme')
async def payme_callback(req: Request):
    from . import payment_providers as vendors
    config=payments.provider_config('payme')
    if not config['callbacksAvailable']:
        raise HTTPException(404,'Not Found')
    raw=await req.body()
    if len(raw)>16384:return core.j({'error':{'code':-32600,'message':'Request too large'}},headers=finance.PRIVATE)
    body=await finance.payload(req)
    rpc_id=body.get('id') if isinstance(body,dict) else None
    if not vendors.payme_authorized(req.headers.get('authorization',''),config):
        return core.j({'id':rpc_id,'error':{'code':-32504,'message':'Unauthorized'}},headers=finance.PRIVATE)
    if not isinstance(body,dict) or not isinstance(body.get('params'),dict) or not isinstance(body.get('method'),str):
        return core.j({'id':rpc_id,'error':{'code':-32600,'message':'Invalid request'}},headers=finance.PRIVATE)
    try:
        db=await core.pool()
        async with db.acquire() as conn, conn.transaction():
            result=await vendors.payme(conn,body['method'],body['params'],environment=config['environment'])
        response={'error':result['_error']} if '_error' in result else {'result':result}
    except vendors.PaymeError as exc:
        response={'error':{'code':exc.code,'message':exc.message,**({'data':exc.data} if exc.data else {})}}
    except LedgerError as exc:
        response={'error':{'code':-31008,'message':exc.code}}
    return core.j({'id':rpc_id,**response},headers=finance.PRIVATE)


@router.post('/api/payments/callbacks/click')
async def click_callback(req: Request):
    from . import payment_providers as vendors
    from urllib.parse import parse_qs
    config=payments.provider_config('click')
    if not config['callbacksAvailable']:raise HTTPException(404,'Not Found')
    raw=await req.body()
    if len(raw)>16384:return finance.err('invalid_provider_payload',400)
    try:
        values=parse_qs(raw.decode('utf-8'),keep_blank_values=True,max_num_fields=20)
        if any(len(v)!=1 for v in values.values()):raise ValueError
        body={k:v[0] for k,v in values.items()}
    except (ValueError,UnicodeDecodeError):return finance.err('invalid_provider_payload',400)
    try:
        db=await core.pool()
        async with db.acquire() as conn, conn.transaction():
            result=await vendors.click(conn,body,config)
    except LedgerError as exc:
        code={'provider_signature_invalid':-1,'provider_amount_mismatch':-2,
              'provider_order_not_found':-5,'provider_declined':-9}.get(exc.code,-8)
        result={'error':code,'error_note':exc.code}
    return core.j(result,headers=finance.PRIVATE)


@router.post('/api/payments/callbacks/uzum')
async def uzum_callback(req: Request):
    from . import payment_providers as vendors
    config=payments.provider_config('uzum')
    if not config['callbacksAvailable']:raise HTTPException(404,'Not Found')
    raw=await req.body()
    if len(raw)>16384:return finance.err('invalid_provider_payload',400)
    body=await finance.payload(req)
    try:
        order=UUID(body['orderNumber']);vendor=UUID(body['orderId'])
    except (ValueError,KeyError,TypeError):return finance.err('invalid_provider_payload',400)
    # A wake-up is not proof. Rate-limit BEFORE a paid authenticated status query.
    limited=await finance._write_gate(req,{'id':order},'uzum_status')
    if limited:return limited
    try:
        db=await core.pool()
        async with db.acquire() as conn, conn.transaction():
            row=await payments.intent_row(conn,order,lock=True)
            payments.require(row is not None and row['provider']=='uzum','provider_order_not_found',404)
            payments.require(row['provider_transaction_id'] in (None,str(vendor)),'provider_reference_mismatch')
            row=await vendors.verify_uzum(conn,row,config,candidate_vendor=str(vendor))
    except LedgerError as exc:return finance.failure(exc)
    return core.j({'accepted':True},headers=finance.PRIVATE)
