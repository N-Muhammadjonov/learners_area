"""Vendor-specific protocols from official Click Shop, Payme Merchant and Uzum Checkout docs.

No provider is usable until its merchant configuration has been explicitly live-verified.
Uzum callbacks are wake-ups only: authenticated getOrderStatus is the proof, because the
Checkout spec does not define a callback signature. Return URLs never settle payments.
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import hmac
from urllib.parse import urlencode, urlsplit
from uuid import UUID

import httpx

from . import self_service_payments as domain
from .tuition_ledger import LedgerError


def integer(value, *, minimum: int = 0, maximum: int = 2**63-1) -> int:
    domain.require(type(value) is int and minimum <= value <= maximum,'invalid_provider_integer',400)
    return value


def reference(value) -> str:
    domain.require(isinstance(value,str) and 1 <= len(value) <= 80,'invalid_provider_reference',400)
    return value


async def uzum_request(config: dict, path: str, body: dict) -> dict:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8,connect=3),follow_redirects=False,trust_env=False) as client:
            response=await client.post(config['BASE_URL'].rstrip('/')+path,json=body,
                headers={'X-Terminal-Id':config['TERMINAL_ID'],'X-API-Key':config['API_KEY'],'Content-Language':'uz-UZ'})
            response.raise_for_status()
            data=response.json()
        domain.require(type(data) is dict and type(data.get('errorCode')) is int and data['errorCode']==0 and type(data.get('result')) is dict,
                       'provider_temporarily_unavailable',503)
        return data['result']
    except (httpx.HTTPError,ValueError,KeyError) as exc:
        raise LedgerError('provider_temporarily_unavailable',503) from exc


async def checkout(row, config: dict) -> tuple[str,str | None]:
    order=str(row['id'])
    return_url=config['returnOrigin']+'/app/payments?intent='+order
    if row['guardian_link_id']:return_url+='&child='+str(row['student_user_id'])
    if row['provider']=='click':
        return 'https://my.click.uz/services/pay?'+urlencode({'service_id':config['SERVICE_ID'],
            'merchant_id':config['MERCHANT_ID'],'amount':str(row['amount_minor']),
            'transaction_param':order,'return_url':return_url}),None
    if row['provider']=='payme':
        # ac.order_id is the merchant's immutable order, not a browser-selected student.
        token=f"m={config['MERCHANT_ID']};ac.order_id={order};a={row['amount_minor']*100};l=uz;c={return_url}"
        host='https://test.paycom.uz/' if config['environment']=='sandbox' else 'https://checkout.paycom.uz/'
        return host+base64.b64encode(token.encode()).decode(),None
    result=await uzum_request(config,'/api/v1/payment/register',{
        'amount':row['amount_minor']*100,'clientId':str(row['student_user_id']),'currency':860,
        'orderNumber':order,'successUrl':return_url,'failureUrl':return_url,'viewType':'REDIRECT',
        'paymentParams':{'payType':'ONE_STEP','operationType':'PAYMENT'},'sessionTimeoutSecs':1800})
    vendor=str(UUID(result.get('orderId','')))
    url=result.get('paymentRedirectUrl','')
    expected=urlsplit(config['CHECKOUT_ORIGIN'])
    actual=urlsplit(url)
    domain.require(actual.scheme=='https' and actual.netloc==expected.netloc and not actual.username
                   and not actual.password,'provider_checkout_invalid',503)
    return url,vendor


async def close(conn,row,*,status: str='cancelled',reason: int=0):
    domain.require(row['status'] not in domain.TERMINAL,'intent_is_terminal')
    if row['payment_id']:
        from . import tuition_ledger as ledger
        await ledger.close_provider_intent(conn,provider=row['provider'],
            provider_transaction_id=row['provider_transaction_id'],to_status='expired' if status=='expired' else 'cancelled')
    return await conn.fetchrow('''UPDATE tuition_payment_intents SET status=$2,cancelled_ms=$3,
        cancellation_reason=$4,updated_at=now() WHERE id=$1 RETURNING *''',row['id'],status,
        int(datetime.now(timezone.utc).timestamp()*1000),reason)


async def click(conn, data: dict, config: dict) -> dict:
    """Shop API prepares/commits an order; the documented MD5 input is exact text."""
    required=('click_trans_id','service_id','merchant_trans_id','amount','action','sign_time','sign_string','error')
    domain.require(all(isinstance(data.get(k),str) and len(data[k])<=200 for k in required),'invalid_provider_payload',400)
    action=data['action']
    domain.require(action in ('0','1') and data['service_id']==config['SERVICE_ID'],'invalid_provider_payload',400)
    if action=='1':
        domain.require(isinstance(data.get('merchant_prepare_id'),str),'invalid_provider_payload',400)
    signed=data['click_trans_id']+data['service_id']+config['SECRET_KEY']+data['merchant_trans_id']
    if action=='1':signed+=data['merchant_prepare_id']
    signed+=data['amount']+action+data['sign_time']
    # MD5 is mandated by Click Shop API; it is not used for passwords or new signatures.
    expected=hashlib.md5(signed.encode(),usedforsecurity=False).hexdigest()
    domain.require(hmac.compare_digest(expected,data['sign_string'].lower()),'provider_signature_invalid',401)
    try:
        order=UUID(data['merchant_trans_id'])
        amount=Decimal(data['amount'])
    except (ValueError,InvalidOperation) as exc:
        raise LedgerError('invalid_provider_payload',400) from exc
    row=await domain.intent_row(conn,order,lock=True)
    domain.require(row is not None and row['provider']=='click','provider_order_not_found',404)
    domain.require(row['provider_environment']==config['environment'],'provider_environment_mismatch')
    domain.require(amount.is_finite() and amount==row['amount_minor'],'provider_amount_mismatch')
    transaction=reference(data['click_trans_id'])
    if action=='0':
        domain.require(data['error']=='0','provider_declined')
        row=await domain.prepare(conn,row,transaction)
    else:
        domain.require(data['merchant_prepare_id']==str(row['prepare_number']),'provider_prepare_mismatch')
        domain.require(row['provider_transaction_id']==transaction,'provider_reference_mismatch')
        if data['error']=='0':
            row=await domain.settle(conn,row,transaction_id=transaction,amount_minor=row['amount_minor'],
                currency='UZS',order_ref=str(row['id']),student_id=str(row['student_user_id']),event_key=transaction+':complete')
        elif row['status'] not in domain.TERMINAL:
            row=await close(conn,row)
        else:
            domain.require(row['status']=='cancelled','provider_state_conflict')
    return {'click_trans_id':data['click_trans_id'],'merchant_trans_id':str(row['id']),
            'merchant_prepare_id' if action=='0' else 'merchant_confirm_id':row['prepare_number'],
            'error':0,'error_note':'Success'}


class PaymeError(Exception):
    def __init__(self,code: int,message: str,data: str | None=None):
        self.code,self.message,self.data=code,message,data


def payme_error(code: int,message: str,data: str | None=None):
    raise PaymeError(code,message,data)


def payme_authorized(header: str,config: dict) -> bool:
    expected='Basic '+base64.b64encode((config['LOGIN']+':'+config['KEY']).encode()).decode()
    return hmac.compare_digest(header,expected)


def payme_state(row) -> int:
    return 2 if row['status']=='paid' else 1 if row['status']=='pending' else -1


def payme_transaction(row) -> dict:
    return {'create_time':row['provider_created_ms'] or 0,'perform_time':row['performed_ms'] or 0,
            'cancel_time':row['cancelled_ms'] or 0,'transaction':str(row['id']),
            'state':payme_state(row),'reason':row['cancellation_reason']}


async def payme(conn, method: str, params: dict, *, environment: str) -> dict:
    if method=='GetStatement':
        start=integer(params.get('from'));end=integer(params.get('to'))
        if not start<=end<=start+31*86400000:payme_error(-32602,'Invalid statement interval')
        rows=await conn.fetch("""SELECT * FROM tuition_payment_intents WHERE provider='payme'
            AND provider_environment=$3 AND provider_created_ms BETWEEN $1 AND $2
            ORDER BY provider_created_ms,id LIMIT 10001""",start,end,environment)
        if len(rows)>10000:payme_error(-32602,'Narrow the statement interval')
        return {'transactions':[{'id':r['provider_transaction_id'],'time':r['provider_created_ms'],
            'amount':r['amount_minor']*100,'account':{'order_id':str(r['id'])},**payme_transaction(r)} for r in rows]}
    if method in ('CheckPerformTransaction','CreateTransaction'):
        account=params.get('account')
        try:order=UUID(account['order_id']) if isinstance(account,dict) else None
        except (ValueError,KeyError,TypeError):order=None
        if not order:payme_error(-31050,'Order not found','order_id')
        row=await domain.intent_row(conn,order,lock=True)
        if not row or row['provider']!='payme':payme_error(-31050,'Order not found','order_id')
        if row['provider_environment']!=environment:payme_error(-31050,'Order not found','order_id')
        if integer(params.get('amount'),minimum=1)!=row['amount_minor']*100:payme_error(-31001,'Incorrect amount')
        if row['status'] not in ('created','pending','paid'):payme_error(-31008,'Order unavailable')
        if method=='CheckPerformTransaction':
            if row['status']=='paid':payme_error(-31008,'Order already paid')
            return {'allow':True}
        transaction=reference(params.get('id'));created=integer(params.get('time'),minimum=1)
        if row['provider_transaction_id'] and row['provider_transaction_id']!=transaction:
            payme_error(-31008,'Order reserved by another transaction','order_id')
        row=await domain.prepare(conn,row,transaction,created_ms=created)
        return {k:v for k,v in payme_transaction(row).items() if k in ('create_time','transaction','state')}
    if method not in ('PerformTransaction','CancelTransaction','CheckTransaction'):
        payme_error(-32601,'Method not found',method)
    transaction=reference(params.get('id'))
    row=await conn.fetchrow("SELECT * FROM tuition_payment_intents WHERE provider='payme' AND provider_transaction_id=$1 AND provider_environment=$2 FOR UPDATE",transaction,environment)
    if not row:payme_error(-31003,'Transaction not found')
    if method=='CheckTransaction':return payme_transaction(row)
    if method=='PerformTransaction':
        if row['status']=='pending' and int(datetime.now(timezone.utc).timestamp()*1000)-(row['provider_created_ms'] or 0)>43200000:
            # Persist the timeout in the successful protocol response transaction. Returning
            # a protocol error must not roll this cancellation back.
            await close(conn,row,reason=4)
            return {'_error':{'code':-31008,'message':'Transaction expired'}}
        if row['status'] not in ('pending','paid'):payme_error(-31008,'Transaction cannot be performed')
        row=await domain.settle(conn,row,transaction_id=transaction,amount_minor=row['amount_minor'],
            currency='UZS',order_ref=str(row['id']),student_id=str(row['student_user_id']),event_key=transaction+':perform')
        return {k:v for k,v in payme_transaction(row).items() if k in ('perform_time','transaction','state')}
    reason=integer(params.get('reason'),minimum=1,maximum=10)
    if row['status']=='paid':
        # Tuition already credited: refunds follow the existing maker/checker + settlement
        # workflow. A provider cancel cannot silently reverse paid tuition.
        payme_error(-31007,'Payment credited; use the approved refund process')
    if row['status'] in ('created','pending'):row=await close(conn,row,reason=reason)
    return {k:v for k,v in payme_transaction(row).items() if k in ('cancel_time','transaction','state')}


async def verify_uzum(conn, row, config: dict, *, candidate_vendor: str | None = None):
    """Only an authenticated canonical status response is allowed to move money."""
    domain.require(row['provider_environment']==config['environment'],'provider_environment_mismatch')
    vendor=row['provider_transaction_id'] or candidate_vendor
    domain.require(bool(vendor),'provider_reference_missing')
    result=await uzum_request(config,'/api/v1/payment/getOrderStatus',{'orderId':vendor})
    domain.require(result.get('orderId')==vendor and result.get('merchantOrderId')==str(row['id'])
        and type(result.get('amount')) is int and result['amount']==row['amount_minor']*100,'provider_proof_mismatch')
    if result.get('status')=='COMPLETED':
        domain.require(type(result.get('completedAmount')) is int and result['completedAmount']==row['amount_minor']*100
            and type(result.get('refundedAmount')) is int and result['refundedAmount']==0
            and type(result.get('reversedAmount')) is int and result['reversedAmount']==0,'provider_proof_mismatch')
        row=await domain.prepare(conn,row,vendor,accepted_by_provider=True)
        row=await domain.settle(conn,row,transaction_id=row['provider_transaction_id'],amount_minor=row['amount_minor'],
            currency='UZS',order_ref=str(row['id']),student_id=str(row['student_user_id']),
            event_key=row['provider_transaction_id']+':complete')
    elif result.get('status')=='DECLINED' and row['status'] not in domain.TERMINAL:
        row=await close(conn,row,status='failed')
    elif result.get('status') in ('REFUNDED','REVERSED'):
        # Do not fabricate a local refund from a status field. Reconciliation must match
        # the approved refund documents and independently settled amounts first.
        from . import tuition_ledger as ledger
        await ledger.audit_event(conn,actor_user_id=None,action='provider_refund_review_required',
            subject_type='payment_intent',subject_id=row['id'],detail={'provider':'uzum','status':result['status']})
    return row


async def register_uzum(conn, row, config: dict):
    """No automatic re-register after an unknown outcome; reconcile the same order."""
    if row['checkout_state']!='new' or row['status']!='created':return row
    if row['guardian_link_id']:
        link=await conn.fetchrow('SELECT status FROM guardian_links WHERE id=$1 FOR SHARE',row['guardian_link_id'])
        domain.require(link and link['status']=='linked','guardian_link_revoked')
    await conn.execute("UPDATE tuition_payment_intents SET checkout_state='registering' WHERE id=$1",row['id'])
    try:
        url,vendor=await checkout(row,config)
    except (LedgerError,ValueError,TypeError):
        return await conn.fetchrow("UPDATE tuition_payment_intents SET checkout_state='unknown',updated_at=now() WHERE id=$1 RETURNING *",row['id'])
    return await conn.fetchrow("""UPDATE tuition_payment_intents SET checkout_url=$2,
        provider_transaction_id=$3,checkout_state='ready',updated_at=now() WHERE id=$1 RETURNING *""",row['id'],url,vendor)
