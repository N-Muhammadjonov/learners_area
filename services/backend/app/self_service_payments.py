"""Durable self-service quotes; only verified vendor adapters can settle the ledger.

Existing money is whole UZS. Tiyin conversion belongs exclusively to vendor adapters.
Guardian revocation denies all portal reads immediately. An unprepared order is refused
at provider preparation after revocation. A prepared order may settle only its immutable
original beneficiary, so money already accepted by a vendor cannot become orphaned.
"""
from __future__ import annotations

import os
import hashlib
from datetime import datetime, timezone
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, Strict

from . import tuition_ledger as ledger
from .runtime_config import academy_enabled, development

PROVIDERS = ('click', 'payme', 'uzum')
MAX_AMOUNT = 90071992547409
TERMINAL = ('paid', 'failed', 'cancelled', 'expired')


class IntentCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    amountMinor: Annotated[int, Strict(), Field(ge=1, le=MAX_AMOUNT)]
    currency: Literal['UZS'] = 'UZS'
    provider: Literal['click', 'payme', 'uzum']
    idempotencyKey: UUID


def enabled() -> bool:
    value = os.getenv('SELF_SERVICE_PAYMENTS_ENABLED')
    return academy_enabled() and (value == '1' if value is not None else development())


def https_origin(value: str) -> bool:
    try:
        url = urlsplit(value)
        return bool(url.scheme == 'https' and url.hostname and url.port in (None,443) and not url.username
                    and not url.password and url.path in ('', '/') and not url.query and not url.fragment)
    except ValueError:
        return False


def provider_config(provider: str) -> dict:
    prefix = provider.upper()
    names = {'click': ('SERVICE_ID', 'MERCHANT_ID', 'SECRET_KEY'),
             'payme': ('MERCHANT_ID', 'KEY', 'LOGIN'),
             'uzum': ('TERMINAL_ID', 'API_KEY', 'BASE_URL', 'CHECKOUT_ORIGIN')}
    values = {key: os.getenv(prefix+'_'+key, '').strip() for key in names[provider]}
    verified = os.getenv(prefix+'_LIVE_VERIFIED') == '1'
    environment=os.getenv(prefix+'_ENVIRONMENT','live' if verified else 'disabled').strip().lower()
    sandbox=environment=='sandbox' and development()
    verified=(verified and environment=='live') or (sandbox and os.getenv(prefix+'_SANDBOX_VERIFIED')=='1')
    origin = os.getenv('PAYMENTS_RETURN_ORIGIN', '').strip().rstrip('/')
    configured = all(values.values()) and https_origin(origin)
    if provider == 'click':
        configured = configured and values['SERVICE_ID'].isascii() and values['SERVICE_ID'].isdigit()
        configured = configured and values['MERCHANT_ID'].isascii() and values['MERCHANT_ID'].isdigit()
    if provider == 'uzum':
        configured = configured and https_origin(values['BASE_URL']) and https_origin(values['CHECKOUT_ORIGIN'])
    ready=verified and configured
    try:
        minimum = int(os.getenv(prefix+'_MIN_UZS', '1'))
        if not 1 <= minimum <= MAX_AMOUNT:
            raise ValueError
    except ValueError:
        minimum, ready = 1, False
    callbacks=bool(configured and
                   (ready or sandbox and os.getenv(prefix+'_CALLBACKS_ENABLED')=='1'))
    return {**values, 'available': bool(ready), 'callbacksAvailable':callbacks,'environment':environment,
            'returnOrigin': origin, 'minimumMinor': minimum,
            'maximumMinor': min(MAX_AMOUNT, 9999999999) if provider == 'uzum' else MAX_AMOUNT}


def capabilities() -> list[dict]:
    return [{'id': key, 'label': {'click':'Click','payme':'Payme','uzum':'Uzum'}[key],
             'available': (config := provider_config(key))['available'],
             'status': 'ready' if config['available'] else 'unavailable',
             'environment':config['environment'] if config['available'] else None,
             'minimumMinor': config['minimumMinor'], 'maximumMinor': config['maximumMinor'],
             'checkoutUrl': None} for key in PROVIDERS]


def require(condition: bool, code: str, status: int = 409, **detail) -> None:
    if not condition:
        raise ledger.LedgerError(code, status, **detail)


async def intent_row(conn, intent_id: UUID, *, lock: bool = False):
    return await conn.fetchrow('SELECT * FROM tuition_payment_intents WHERE id=$1'+
                              (' FOR UPDATE' if lock else ''), intent_id)


async def create_intent(conn, *, payer, student_id: UUID, link_id: UUID | None,
                        body: IntentCreate) -> dict:
    """Called inside the portal's authorization transaction and live-link row lock."""
    # Serialize repeat submissions before checking their payload; no aborted-transaction
    # recovery or race-dependent duplicate order can escape the unique constraint.
    await conn.execute('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
                       str(payer['id'])+':'+str(body.idempotencyKey))
    old = await conn.fetchrow('SELECT * FROM tuition_payment_intents WHERE payer_user_id=$1 AND idempotency_key=$2',
                              payer['id'], body.idempotencyKey)
    if old:
        require((old['student_user_id'], old['amount_minor'], old['provider'], old['currency_code']) ==
                (student_id, body.amountMinor, body.provider, body.currency), 'idempotency_conflict')
        return await public_intent(conn, old)
    config = provider_config(body.provider)
    require(config['available'], 'provider_unavailable')
    require(body.amountMinor >= config['minimumMinor'], 'provider_minimum', 422,
            minimumMinor=config['minimumMinor'])
    require(body.amountMinor <= config['maximumMinor'], 'provider_maximum', 422,
            maximumMinor=config['maximumMinor'])
    row = await conn.fetchrow('''INSERT INTO tuition_payment_intents
        (student_user_id,payer_user_id,guardian_link_id,amount_minor,provider,idempotency_key,provider_environment)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *''', student_id,payer['id'],link_id,
        body.amountMinor,body.provider,body.idempotencyKey,config['environment'])
    await ledger.audit_event(conn, actor_user_id=payer['id'],action='self_service_intent_created',
        subject_type='payment_intent',subject_id=row['id'],amount_minor=body.amountMinor,
        detail={'studentUserId':str(student_id),'provider':body.provider,'guardianLinkId':str(link_id) if link_id else None})
    # Imported here to keep adapter -> deterministic domain dependencies acyclic at import.
    from .payment_providers import checkout
    # Remote registration happens only AFTER this order commits. An uncertain network
    # result must leave a durable order, never an orphaned vendor payment.
    if body.provider == 'uzum':
        return await public_intent(conn,row)
    url, vendor_id = await checkout(row, config)
    row = await conn.fetchrow('''UPDATE tuition_payment_intents SET checkout_url=$2,checkout_state='ready',
        provider_transaction_id=$3,updated_at=now() WHERE id=$1 RETURNING *''', row['id'], url, vendor_id)
    return await public_intent(conn, row)


async def public_intent(conn, row) -> dict:
    """Never infer success from a URL, request parameter, or pending provider response."""
    payment = await conn.fetchrow('SELECT * FROM tuition_payments WHERE id=$1',row['payment_id']) if row['payment_id'] else None
    allocated = await conn.fetchval('SELECT coalesce(sum(amount_minor),0)::bigint FROM tuition_payment_allocations WHERE payment_id=$1',
                                    row['payment_id']) if payment else 0
    refunded = await conn.fetchval("SELECT coalesce(sum(amount_minor),0)::bigint FROM tuition_refunds WHERE payment_id=$1 AND status='settled'",
                                   row['payment_id']) if payment else 0
    status = row['status']
    if status=='created' and not row['payment_id'] and row['expires_at']<=datetime.now(timezone.utc):
        status='expired'
    if status == 'paid' and payment:
        status = {'partially_refunded':'partially_refunded','refunded':'refunded'}.get(payment['status'],'paid')
    student = await conn.fetchval('SELECT name FROM users WHERE id=$1', row['student_user_id'])
    payer = await conn.fetchval('SELECT name FROM users WHERE id=$1', row['payer_user_id'])
    resumable = status in ('created','pending') and row['expires_at'] > datetime.now(timezone.utc)
    return {'intentId':str(row['id']),'status':status,'beneficiaryStudentId':str(row['student_user_id']),
            'beneficiaryName':student,'payerName':payer,'amountMinor':row['amount_minor'],'currency':row['currency_code'],
            'provider':row['provider'],'environment':row['provider_environment'],
            'createdAt':row['created_at'].isoformat(),'expiresAt':row['expires_at'].isoformat(),
            'quoteVersion':row['quote_version'],'checkoutState':row['checkout_state'],
            'merchantCheckoutUrl':row['checkout_url'] if resumable and provider_config(row['provider'])['available'] else None,
            'allocatedMinor':int(allocated),'advanceMinor':max(0,row['amount_minor']-int(allocated)-int(refunded)) if status in ('paid','partially_refunded','refunded') else 0,
            'refundedMinor':int(refunded),'acknowledgement':{'kind':'internal','number':payment['receipt_no']} if payment and status in ('paid','partially_refunded','refunded') else None,
            'fiscalStatus':row['fiscal_status'],'fiscalReceiptUrl':row['fiscal_url'] if row['fiscal_status']=='issued' else None}


async def summary(conn, student_id: UUID, *, offset: int = 0, limit: int = 20,
                  status: str | None = None) -> dict:
    position = await ledger.student_position(conn, student_id)
    # This release has no approved prepaid conversion policy. The existing contract and
    # ledger remain monthly monetary obligations, with no invented day/lesson counter.
    rows = await conn.fetch("""SELECT * FROM (
        SELECT 'intent'::text AS kind,i.id,i.created_at AS at,
          CASE WHEN p.status IN ('partially_refunded','refunded') THEN p.status
               WHEN i.status='created' AND i.payment_id IS NULL AND i.expires_at<=now() THEN 'expired'
               ELSE i.status END AS status
          FROM tuition_payment_intents i LEFT JOIN tuition_payments p ON p.id=i.payment_id
         WHERE i.student_user_id=$1
        UNION ALL
        SELECT 'legacy',p.id,p.occurred_at,
          CASE p.status WHEN 'confirmed' THEN 'paid' WHEN 'pending_provider' THEN 'pending'
               WHEN 'initiated' THEN 'created' WHEN 'rejected' THEN 'failed' ELSE p.status END
          FROM tuition_payments p WHERE p.student_user_id=$1
          AND NOT EXISTS(SELECT 1 FROM tuition_payment_intents i WHERE i.payment_id=p.id)
        ) h WHERE ($2::varchar IS NULL OR h.status=$2)
        ORDER BY at DESC,id DESC LIMIT $3 OFFSET $4""",student_id,status,limit+1,offset)
    history=[]
    for item in rows[:limit]:
        if item['kind']=='intent':
            history.append(await public_intent(conn,await intent_row(conn,item['id'])))
        else:
            history.append(await public_legacy_payment(conn,item['id']))
    name = await conn.fetchval('SELECT name FROM users WHERE id=$1',student_id)
    due = await conn.fetchval('''SELECT min(c.due_date) FROM tuition_charges c
        WHERE c.student_user_id=$1 AND c.status='posted' AND NOT c.is_reversal
          AND c.net_amount_minor > coalesce((SELECT sum(a.amount_minor) FROM tuition_payment_allocations a WHERE a.charge_id=c.id),0)
               +coalesce((SELECT sum(n.amount_minor) FROM tuition_credit_notes n WHERE n.charge_id=c.id AND n.status='posted'),0)''',student_id)
    return {'beneficiaryStudentId':str(student_id),'beneficiaryName':name,'position':position,
            'billingPolicy':{'mode':'MONTHLY_INVOICE','version':'monthly-invoice-v1','advanceUse':'money_on_account'},
            'nextDueDate':due.isoformat() if due else None,'providers':capabilities(),
            'history':history,'pagination':{'offset':offset,'limit':limit,'hasMore':len(rows)>limit},
            'asOf':position['asOf']}


async def prepare(conn, row, transaction_id: str, *, created_ms: int | None = None,
                  accepted_by_provider: bool = False):
    """Bind the vendor's immutable reference once, before any settlement."""
    require(bool(transaction_id) and len(transaction_id) <= 80,'provider_reference_invalid')
    if row['provider_transaction_id']:
        require(row['provider_transaction_id'] == transaction_id,'provider_reference_mismatch')
    if row['payment_id']:
        require(created_ms is None or row['provider_created_ms']==created_ms,'provider_creation_time_mismatch')
        return row
    require(row['status'] in ('created','pending'),'intent_not_prepareable')
    require(accepted_by_provider or row['expires_at'] > datetime.now(timezone.utc),'intent_expired')
    if row['guardian_link_id'] and not accepted_by_provider:
        link = await conn.fetchrow("SELECT status FROM guardian_links WHERE id=$1 FOR SHARE",row['guardian_link_id'])
        require(bool(link and link['status']=='linked'),'guardian_link_revoked')
    payment, _, _ = await ledger.record_payment(conn,actor_user_id=row['payer_user_id'],
        student_user_id=row['student_user_id'],amount_minor=row['amount_minor'],method='provider',
        provider=row['provider'],provider_transaction_id=transaction_id,idempotency_key=str(row['id']),confirm=False)
    return await conn.fetchrow('''UPDATE tuition_payment_intents SET status='pending',payment_id=$2,
        provider_transaction_id=$3,provider_created_ms=$4,updated_at=now() WHERE id=$1 RETURNING *''',
        row['id'],payment['id'],transaction_id,created_ms)


async def settle(conn, row, *, transaction_id: str, amount_minor: int, currency: str,
                 order_ref: str, student_id: str, event_key: str) -> dict:
    # Check semantics BEFORE duplicate acknowledgement. The underlying ledger's settled
    # fast path alone must never turn a replay with a different amount into acceptance.
    require((row['provider_transaction_id'],row['amount_minor'],row['currency_code'],str(row['id']),str(row['student_user_id'])) ==
            (transaction_id,amount_minor,currency,order_ref,student_id),'provider_proof_mismatch')
    require(row['status'] in ('pending','paid'),'intent_not_settleable')
    proof=ledger.provider_proof(amount_minor=amount_minor,currency=currency,status='paid',
                               order_ref=order_ref,student_user_id=student_id)
    payment,_,duplicate=await ledger.confirm_provider_payment(conn,provider=row['provider'],
        provider_transaction_id=transaction_id,proof=proof,actor_user_id=None)
    now_ms=int(datetime.now(timezone.utc).timestamp()*1000)
    updated=await conn.fetchrow('''UPDATE tuition_payment_intents SET status='paid',
        performed_ms=coalesce(performed_ms,$2),updated_at=now() WHERE id=$1 RETURNING *''',row['id'],now_ms)
    fingerprint=hashlib.sha256(f'{transaction_id}:{amount_minor}:{currency}:{order_ref}:{student_id}:paid'.encode()).hexdigest()
    prior=await conn.fetchrow('SELECT intent_id,fingerprint FROM tuition_provider_events WHERE provider=$1 AND event_key=$2',row['provider'],event_key)
    require(not prior or (prior['intent_id']==row['id'] and prior['fingerprint']==fingerprint),'provider_event_conflict')
    await conn.execute('''INSERT INTO tuition_provider_events(intent_id,provider,event_key,fingerprint,event_type)
        VALUES($1,$2,$3,$4,'settled') ON CONFLICT(provider,event_key) DO NOTHING''',row['id'],row['provider'],event_key,fingerprint)
    return dict(updated)


async def public_legacy_payment(conn, payment_id: UUID) -> dict:
    """Cash/bank and older provider receipts stay visible alongside portal orders."""
    row=await conn.fetchrow('''SELECT p.*,u.name AS student_name,
        coalesce((SELECT sum(a.amount_minor) FROM tuition_payment_allocations a WHERE a.payment_id=p.id),0)::bigint AS allocated,
        coalesce((SELECT sum(r.amount_minor) FROM tuition_refunds r WHERE r.payment_id=p.id AND r.status='settled'),0)::bigint AS refunded
        FROM tuition_payments p JOIN users u ON u.id=p.student_user_id WHERE p.id=$1''',payment_id)
    state={'confirmed':'paid','pending_provider':'pending','initiated':'created','rejected':'failed'}.get(row['status'],row['status'])
    settled=row['status'] in ledger.SETTLED_PAYMENT_STATES
    return {'intentId':None,'paymentId':str(row['id']),'status':state,'beneficiaryStudentId':str(row['student_user_id']),
        'beneficiaryName':row['student_name'],'payerName':row['payer_name'],'amountMinor':row['amount_minor'],
        'currency':row['currency_code'],'provider':row['provider'] or row['method'],
        'createdAt':row['occurred_at'].isoformat(),'merchantCheckoutUrl':None,
        'allocatedMinor':row['allocated'],'refundedMinor':row['refunded'],
        'advanceMinor':max(0,row['amount_minor']-row['allocated']-row['refunded']) if settled else 0,
        'acknowledgement':{'kind':'internal','number':row['receipt_no']} if settled else None,
        'fiscalStatus':'manual_review','fiscalReceiptUrl':None}
