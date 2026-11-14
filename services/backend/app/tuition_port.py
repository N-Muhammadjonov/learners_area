"""Tuition/billing HTTP surface for staff and students.

Authorization is explicit on every route (never by hiding buttons):

* ``owner`` / ``admin`` may write money documents and read every statement.
* ``teacher`` may read the billing statement of a student they are linked to
  (``teacher_student_links``) and nothing else; teachers never write money documents.
* ``student`` may read only their own billing status via ``/api/finance/me``.
* ``guardian`` is rejected centrally by ``guardian_path_allowed`` before reaching here:
  a parent sees the child's academic slice, not the child's finances.

Every write goes through one transaction in :mod:`app.tuition_ledger`, so the ledger
invariants hold no matter which client called.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Request

from . import main as core
from .admin_authoring_port import uuid_val
from .rate_limit import RULES, async_counter as counter, too_many
from . import tuition_ledger as ledger
from .tuition_ledger import LedgerError

router = APIRouter()
PRIVATE = {'Cache-Control': 'private, no-store'}
WRITE_ROLES = ('owner', 'admin')
READ_ROLES = ('owner', 'admin', 'teacher')
MAX_NOTE = 300


def err(code, status=400, **details):
    return core.j({'error': code, **details}, status, PRIVATE)


async def actor(req: Request, roles):
    user = await core.current_user(req, active=True)
    if not user:
        return None, core.auth_error()
    if user['role'] not in roles:
        return None, core.j({'error': 'forbidden'}, 403, PRIVATE)
    return user, None


async def payload(req: Request):
    try:
        body = await req.json()
    except Exception:
        return None
    return body if isinstance(body, dict) else None


def as_date(value):
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def serialize(row):
    """Records contain UUID/datetime values; convert once so no route hand-rolls it."""
    out = {}
    for key, value in dict(row).items():
        if isinstance(value, (UUID, datetime, date)):
            out[key] = str(value)
        elif isinstance(value, list):
            out[key] = [serialize(item) for item in value]
        else:
            out[key] = value
    return out


def failure(exc: LedgerError):
    return core.j({'error': exc.code, **exc.details}, exc.status, PRIVATE)


async def _write_gate(req: Request, user, rule='finance_write'):
    RULES.setdefault(rule, (120, 60))
    delay = await counter(rule, 'u:' + str(user['id']), consume=True)
    return too_many(delay) if delay else None


async def _teacher_may_read(conn, teacher_id, student_id) -> bool:
    return bool(await conn.fetchval(
        'SELECT 1 FROM teacher_student_links WHERE teacher_user_id=$1 AND student_user_id=$2',
        teacher_id, student_id))


# ─────────────────────────────── contracts ───────────────────────────────
@router.post('/api/staff/finance/contracts')
async def create_contract(req: Request):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    body = await payload(req)
    if body is None:
        return err('invalid_payload')
    student_id = uuid_val(body.get('studentUserId'))
    if not student_id:
        return err('invalid_student')
    if not isinstance(body.get('monthlyAmountMinor'), int):
        return err('amount_must_be_integer_minor_units')
    starts_on = as_date(body.get('startsOn'))
    if not starts_on:
        return err('invalid_start_date')
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            contract = await ledger.create_contract(
                conn, actor_user_id=user['id'], student_user_id=student_id,
                monthly_amount_minor=body['monthlyAmountMinor'], starts_on=starts_on,
                term_months=body.get('termMonths', 1), course_id=uuid_val(body.get('courseId')),
                ends_on=as_date(body.get('endsOn')), note=str(body.get('note') or '')[:MAX_NOTE] or None)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'contract': serialize(contract)}, headers=PRIVATE)


@router.post('/api/staff/finance/contracts/{contractId}/approve')
async def approve_contract(req: Request, contractId: str):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    ident = uuid_val(contractId)
    if not ident:
        return err('contract_not_found', 404)
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            contract = await ledger.approve_contract(conn, actor_user_id=user['id'], contract_id=ident)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'contract': serialize(contract)}, headers=PRIVATE)


@router.post('/api/staff/finance/contracts/{contractId}/activate')
async def activate_contract(req: Request, contractId: str):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    ident = uuid_val(contractId)
    if not ident:
        return err('contract_not_found', 404)
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            contract = await ledger.activate_contract(conn, actor_user_id=user['id'], contract_id=ident)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'contract': serialize(contract)}, headers=PRIVATE)


@router.post('/api/staff/finance/contracts/{contractId}/discounts')
async def add_discount(req: Request, contractId: str):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    ident = uuid_val(contractId)
    body = await payload(req)
    if not ident or body is None:
        return err('invalid_payload')
    if not isinstance(body.get('amountMinor'), int):
        return err('amount_must_be_integer_minor_units')
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            discount = await ledger.add_discount(
                conn, actor_user_id=user['id'], contract_id=ident,
                period=str(body.get('periodKey') or '')[:7], amount_minor=body['amountMinor'],
                reason=str(body.get('reason') or ''))
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'discount': serialize(discount)}, headers=PRIVATE)


# ─────────────────────────────── charges ───────────────────────────────
@router.post('/api/staff/finance/charges')
async def create_charge(req: Request):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    body = await payload(req)
    if body is None:
        return err('invalid_payload')
    student_id = uuid_val(body.get('studentUserId'))
    due = as_date(body.get('dueDate'))
    if not student_id or not due or not isinstance(body.get('grossAmountMinor'), int):
        return err('invalid_payload')
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            charge = await ledger.create_charge(
                conn, actor_user_id=user['id'], student_user_id=student_id,
                period=str(body.get('periodKey') or ledger.period_key(due))[:7], due_date=due,
                gross_amount_minor=body['grossAmountMinor'],
                contract_id=uuid_val(body.get('contractId')))
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'charge': serialize(charge)}, headers=PRIVATE)


@router.post('/api/staff/finance/charges/{chargeId}/post')
async def post_charge(req: Request, chargeId: str):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    ident = uuid_val(chargeId)
    if not ident:
        return err('charge_not_found', 404)
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            charge = await ledger.post_charge(conn, actor_user_id=user['id'], charge_id=ident)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'charge': serialize(charge)}, headers=PRIVATE)


@router.post('/api/staff/finance/charges/{chargeId}/reverse')
async def reverse_charge(req: Request, chargeId: str):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    ident = uuid_val(chargeId)
    body = await payload(req)
    if not ident or body is None:
        return err('invalid_payload')
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            reversal = await ledger.reverse_charge(conn, actor_user_id=user['id'], charge_id=ident,
                                                   reason=str(body.get('reason') or ''))
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'reversal': serialize(reversal)}, headers=PRIVATE)


# ─────────────────────────────── payments ───────────────────────────────
@router.post('/api/staff/finance/payments')
async def record_payment(req: Request):
    """Record money in. `idempotencyKey` makes a retried submit produce one payment."""
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    body = await payload(req)
    if body is None:
        return err('invalid_payload')
    student_id = uuid_val(body.get('studentUserId'))
    if not student_id or not isinstance(body.get('amountMinor'), int):
        return err('invalid_payload')
    limited = await _write_gate(req, user)
    if limited:
        return limited
    occurred = body.get('occurredAt')
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            payment, allocations, duplicate = await ledger.record_payment(
                conn, actor_user_id=user['id'], student_user_id=student_id,
                amount_minor=body['amountMinor'], method=str(body.get('method') or 'cash'),
                provider=body.get('provider'), provider_transaction_id=body.get('providerTransactionId'),
                idempotency_key=str(body['idempotencyKey'])[:120] if body.get('idempotencyKey') else None,
                receipt_purpose=str(body.get('receiptPurpose') or '')[:120] or None,
                payer_name=str(body.get('payerName') or '')[:160] or None,
                occurred_at=datetime.fromisoformat(occurred) if occurred else None,
                confirm=bool(body.get('confirm', True)))
        except LedgerError as exc:
            return failure(exc)
        except ValueError:
            return err('invalid_occurred_at')
        position = await ledger.student_position(conn, student_id)
    return core.j({'ok': True, 'duplicate': duplicate, 'payment': serialize(payment),
                   'allocations': [serialize(row) for row in allocations],
                   'position': position}, headers=PRIVATE)


@router.post('/api/staff/finance/payments/{paymentId}/refund')
async def refund_payment(req: Request, paymentId: str):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    ident = uuid_val(paymentId)
    body = await payload(req)
    if not ident or body is None or not isinstance(body.get('amountMinor'), int):
        return err('invalid_payload')
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            refund, duplicate = await ledger.refund_payment(
                conn, actor_user_id=user['id'], payment_id=ident,
                amount_minor=body['amountMinor'], reason=str(body.get('reason') or ''),
                method=body.get('method'), provider_refund_id=body.get('providerRefundId'),
                provider_refund_state=str(body.get('providerRefundState') or 'internal'))
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'duplicate': duplicate, 'refund': serialize(refund)}, headers=PRIVATE)


@router.post('/api/staff/finance/revenue/recognize')
async def recognize_revenue(req: Request):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    body = await payload(req)
    if body is None:
        return err('invalid_payload')
    student_id = uuid_val(body.get('studentUserId'))
    if not student_id or not isinstance(body.get('amountMinor'), int):
        return err('invalid_payload')
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            result = await ledger.recognize_revenue(
                conn, actor_user_id=user['id'], student_user_id=student_id,
                amount_minor=body['amountMinor'], period=body.get('periodKey'),
                memo=str(body.get('memo') or '')[:200] or None)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, **result}, headers=PRIVATE)


# ─────────────────────────────── cash controls ───────────────────────────────
@router.post('/api/staff/finance/days/close')
async def close_day(req: Request):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    body = await payload(req)
    business_date = as_date((body or {}).get('businessDate'))
    if not business_date or not isinstance((body or {}).get('countedMinor'), int):
        return err('invalid_payload')
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            close = await ledger.close_day(conn, actor_user_id=user['id'],
                                           business_date=business_date,
                                           counted_minor=body['countedMinor'],
                                           reason=str(body.get('reason') or '')[:300] or None)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'close': serialize(close)}, headers=PRIVATE)


@router.post('/api/staff/finance/periods/close')
async def close_period(req: Request):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    body = await payload(req)
    period = str((body or {}).get('periodKey') or '')[:7]
    if len(period) != 7:
        return err('invalid_payload')
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            close = await ledger.close_period(conn, actor_user_id=user['id'], period=period,
                                              reason=str(body.get('reason') or '')[:300] or None)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'period': serialize(close)}, headers=PRIVATE)


# ─────────────────────────────── read models ───────────────────────────────
@router.get('/api/staff/finance/summary')
async def finance_summary(req: Request):
    user, denied = await actor(req, READ_ROLES)
    if denied:
        return denied
    if user['role'] == 'teacher':
        # A teacher does not see centre-wide money. Read-only per-student statements only.
        return core.j({'error': 'forbidden'}, 403, PRIVATE)
    today = datetime.now(timezone.utc).date()
    start = as_date(req.query_params.get('start')) or today.replace(day=1)
    end = as_date(req.query_params.get('end')) or today
    if end < start:
        return err('invalid_range')
    db = await core.pool()
    async with db.acquire() as conn:
        summary = await ledger.finance_summary(conn, start=start, end=end)
    return core.j(summary, headers=PRIVATE)


@router.get('/api/staff/finance/reconciliation')
async def reconciliation(req: Request):
    user, denied = await actor(req, READ_ROLES)
    if denied or user['role'] == 'teacher':
        return denied or core.j({'error': 'forbidden'}, 403, PRIVATE)
    db = await core.pool()
    async with db.acquire() as conn:
        return core.j(await ledger.journal_is_balanced(conn), headers=PRIVATE)


@router.get('/api/staff/finance/students/{studentId}/statement')
async def student_statement(req: Request, studentId: str):
    user, denied = await actor(req, READ_ROLES)
    if denied:
        return denied
    student_id = uuid_val(studentId)
    if not student_id:
        return err('student_not_found', 404)
    db = await core.pool()
    async with db.acquire() as conn:
        if user['role'] == 'teacher' and not await _teacher_may_read(conn, user['id'], student_id):
            # Same shape as a missing student: no cross-scope information disclosure.
            return core.j({'error': 'student_not_found'}, 404, PRIVATE)
        statement = await ledger.student_statement(conn, student_id)
    return core.j(serialize(statement), headers=PRIVATE)


@router.get('/api/finance/me')
async def my_billing(req: Request):
    """A student sees their own billing status only — never another student's, and never
    the centre's cash totals."""
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    if user['role'] != 'student':
        return core.j({'error': 'forbidden'}, 403, PRIVATE)
    db = await core.pool()
    async with db.acquire() as conn:
        position = await ledger.student_position(conn, user['id'])
    return core.j({'position': position}, headers=PRIVATE)


def install():
    core.app.include_router(router)
