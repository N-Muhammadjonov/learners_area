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

import json
import re

from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Request

from . import main as core
from .admin_authoring_port import uuid_val
from .rate_limit import RULES, async_counter as counter, too_many
from . import payments_sandbox as sandbox
from . import tuition_schemas as schemas
from .tuition_schemas import ValidationError
from . import tuition_ledger as ledger
from .tuition_ledger import LedgerError

router = APIRouter()
PRIVATE = {'Cache-Control': 'private, no-store'}
# FIN-11: a billing period is always the seven-character form YYYY-MM.
PERIOD_PATTERN = re.compile(r'\d{4}-(0[1-9]|1[0-2])')
WRITE_ROLES = ('owner', 'admin')
#: Approvals are an owner act: separation of duties is enforced in the ledger too.
OWNER_ONLY = ('owner',)
READ_ROLES = ('owner', 'admin', 'teacher')
#: Who may see actual money: amounts, payers, receipts, refunds. A teaching link is not on
#: this list (FIN-12) - see `student_tuition_status` for what a teacher may see instead.
MONEY_READ_ROLES = ('owner', 'admin')
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


def typed(model, body):
    """Validate a request body against its typed contract (FIN-11).

    Raises `ValidationError`, which callers turn into one 422 shape. Money is refused unless
    it is a whole number of minor units, so `true` and `1.5` cannot become a charge.
    """
    return schemas.parse(model, body)


def invalid(exc: ValidationError):
    return core.j(exc.as_body(), 422, PRIVATE)


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
    try:
        body = typed(schemas.ContractCreate, await payload(req))
    except ValidationError as exc:
        return invalid(exc)
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            contract = await ledger.create_contract(
                conn, actor_user_id=user['id'], student_user_id=body.studentUserId,
                monthly_amount_minor=body.monthlyAmountMinor, starts_on=body.startsOn,
                term_months=body.termMonths, course_id=body.courseId, ends_on=body.endsOn,
                note=body.note)
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
    try:
        body = typed(schemas.DiscountCreate, await payload(req))
    except ValidationError as exc:
        return invalid(exc)
    if not ident:
        return err('invalid_payload')
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            discount = await ledger.add_discount(
                conn, actor_user_id=user['id'], contract_id=ident,
                period=body.periodKey, amount_minor=body.amountMinor, reason=body.reason)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'discount': serialize(discount)}, headers=PRIVATE)


# ─────────────────────────────── charges ───────────────────────────────
@router.post('/api/staff/finance/charges')
async def create_charge(req: Request):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    try:
        body = typed(schemas.ChargeCreate, await payload(req))
    except ValidationError as exc:
        return invalid(exc)
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            charge = await ledger.create_charge(
                conn, actor_user_id=user['id'], student_user_id=body.studentUserId,
                period=body.periodKey, due_date=body.dueDate,
                gross_amount_minor=body.grossAmountMinor, contract_id=body.contractId,
                adjustment_reason=body.adjustmentReason)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'charge': serialize(charge)}, headers=PRIVATE)


@router.post('/api/staff/finance/contracts/{contractId}/installment')
async def generate_installment(req: Request, contractId: str):
    """Idempotently bill the ONE tuition installment for a contract and billing period.

    This is the route a monthly scheduler (or a double-clicking admin) calls. A retry returns
    the charge that already exists instead of creating a second receivable, and the amount
    comes from the approved contract rather than from the request body.
    """
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    contract_id = uuid_val(contractId)
    if not contract_id:
        return err('contract_not_found', 404)
    try:
        body = typed(schemas.InstallmentCreate, await payload(req))
    except ValidationError as exc:
        return invalid(exc)
    period = body.periodKey or ledger.period_key(ledger.business_date(datetime.now(timezone.utc)))
    due = body.dueDate
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            charge, created = await ledger.generate_installment(
                conn, actor_user_id=user['id'], contract_id=contract_id, period=period,
                due_date=due)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'created': created, 'charge': serialize(charge)}, headers=PRIVATE)


@router.post('/api/staff/finance/charges/{chargeId}/approve')
async def approve_charge(req: Request, chargeId: str):
    """Owner approval of a drafted receivable (FIN-06).

    Without it a receivable cannot be posted: `draft` is not a postable state. The ledger
    also refuses a non-owner approver and self-approval by the drafter.
    """
    user, denied = await actor(req, OWNER_ONLY)
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
            charge = await ledger.approve_charge(conn, actor_user_id=user['id'], charge_id=ident)
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
@router.post('/api/staff/finance/credit-notes')
async def create_credit_note(req: Request):
    """Draft relief against an already-posted charge (FIN-05).

    A discount can no longer be added once a period is posted; this is the sanctioned
    replacement. It changes nothing until an owner approves and someone posts it.
    """
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    try:
        body = typed(schemas.CreditNoteCreate, await payload(req))
    except ValidationError as exc:
        return invalid(exc)
    charge_id = body.chargeId
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            note = await ledger.create_credit_note(
                conn, actor_user_id=user['id'], charge_id=charge_id,
                amount_minor=body.amountMinor, reason=body.reason)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'creditNote': serialize(note)}, headers=PRIVATE)


@router.post('/api/staff/finance/credit-notes/{creditNoteId}/approve')
async def approve_credit_note(req: Request, creditNoteId: str):
    """Owner-only approval. The ledger also refuses self-approval by the drafter."""
    user, denied = await actor(req, OWNER_ONLY)
    if denied:
        return denied
    ident = uuid_val(creditNoteId)
    if not ident:
        return err('credit_note_not_found', 404)
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            note = await ledger.approve_credit_note(conn, actor_user_id=user['id'],
                                                    credit_note_id=ident)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'creditNote': serialize(note)}, headers=PRIVATE)


@router.post('/api/staff/finance/credit-notes/{creditNoteId}/post')
async def post_credit_note(req: Request, creditNoteId: str):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    ident = uuid_val(creditNoteId)
    if not ident:
        return err('credit_note_not_found', 404)
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            note = await ledger.post_credit_note(conn, actor_user_id=user['id'],
                                                 credit_note_id=ident)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'creditNote': serialize(note)}, headers=PRIVATE)


@router.post('/api/staff/finance/payments')
async def record_payment(req: Request):
    """Record money in. `idempotencyKey` makes a retried submit produce one payment."""
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    try:
        body = typed(schemas.PaymentCreate, await payload(req))
    except ValidationError as exc:
        return invalid(exc)
    if body.method == 'provider' and body.confirm:
        # Provider money settles only through a verified provider callback. A staff session
        # asserting "the provider paid" would let a privileged caller invent a receipt.
        return core.j({'error': 'provider_confirmation_requires_provider_proof'}, 409, PRIVATE)
    # FIN-11: a client may say WHEN money changed hands, but dating a receipt into the past
    # rewrites which cash day and which accounting period it belongs to. Today and yesterday
    # are normal till work; anything older needs an owner, and is audited either way.
    backdated = schemas.backdate_days(body.occurredAt)
    if backdated > schemas.BACKDATE_GRACE_DAYS and user['role'] not in OWNER_ONLY:
        return core.j({'error': 'backdating_requires_owner',
                       'graceDays': schemas.BACKDATE_GRACE_DAYS, 'backdatedDays': backdated},
                      403, PRIVATE)
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            payment, allocations, duplicate = await ledger.record_payment(
                conn, actor_user_id=user['id'], student_user_id=body.studentUserId,
                amount_minor=body.amountMinor, method=body.method, provider=body.provider,
                provider_transaction_id=body.providerTransactionId,
                idempotency_key=body.idempotencyKey, receipt_purpose=body.receiptPurpose,
                payer_name=body.payerName, occurred_at=body.occurredAt, confirm=body.confirm)
            if backdated > schemas.BACKDATE_GRACE_DAYS:
                await ledger.audit_event(
                    conn, actor_user_id=user['id'], action='backdated_payment',
                    subject_type='tuition_payment', subject_id=payment['id'],
                    period=ledger.period_key(body.occurredAt), amount_minor=body.amountMinor,
                    reason=f'receipt dated {backdated} days in the past',
                    request_id=getattr(req.state, 'request_id', None),
                    detail={'occurredAt': body.occurredAt.isoformat(),
                            'backdatedDays': backdated, 'method': body.method})
        except LedgerError as exc:
            return failure(exc)
        position = await ledger.student_position(conn, body.studentUserId)
    return core.j({'ok': True, 'duplicate': duplicate, 'payment': serialize(payment),
                   'allocations': [serialize(row) for row in allocations],
                   'position': position}, headers=PRIVATE)


@router.post('/api/staff/finance/payments/{paymentId}/refund')
async def refund_payment(req: Request, paymentId: str):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    ident = uuid_val(paymentId)
    try:
        body = typed(schemas.RefundRequest, await payload(req))
    except ValidationError as exc:
        return invalid(exc)
    if not ident:
        return err('payment_not_found', 404)
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            # FIN-08: this OPENS a refund request. Money leaves only after an owner approves
            # and a cashier settles it, and it leaves in today's period - the closed cash day
            # the original receipt belongs to is never reopened or rewritten.
            refund, duplicate = await ledger.request_refund(
                conn, actor_user_id=user['id'], payment_id=ident,
                amount_minor=body.amountMinor, reason=body.reason, method=body.method,
                provider_refund_id=body.providerRefundId)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'duplicate': duplicate, 'refund': serialize(refund)},
                  status=202 if not duplicate else 200, headers=PRIVATE)


async def _refund_transition(req, refund_id, action, roles):
    user, denied = await actor(req, roles)
    if denied:
        return denied
    ident = uuid_val(refund_id)
    if not ident:
        return err('refund_not_found', 404)
    body = await payload(req) or {}
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            if action == 'approve':
                refund = await ledger.approve_refund(conn, actor_user_id=user['id'],
                                                     refund_id=ident)
            elif action == 'settle':
                refund = await ledger.settle_refund(conn, actor_user_id=user['id'],
                                                    refund_id=ident)
            else:
                reason = str(body.get('reason') or '')
                refund = await (ledger.reject_refund if action == 'reject' else ledger.fail_refund)(
                    conn, actor_user_id=user['id'], refund_id=ident, reason=reason)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'refund': serialize(refund)}, headers=PRIVATE)


@router.post('/api/staff/finance/refunds/{refundId}/approve')
async def approve_refund(req: Request, refundId: str):
    """Owner authorization of a refund request (FIN-08). The requester cannot self-approve."""
    return await _refund_transition(req, refundId, 'approve', OWNER_ONLY)


@router.post('/api/staff/finance/refunds/{refundId}/settle')
async def settle_refund(req: Request, refundId: str):
    """Pay an approved refund out, in today's open period."""
    return await _refund_transition(req, refundId, 'settle', WRITE_ROLES)


@router.post('/api/staff/finance/refunds/{refundId}/reject')
async def reject_refund(req: Request, refundId: str):
    """Owner declines a request. Kept on the record; no money moves."""
    return await _refund_transition(req, refundId, 'reject', OWNER_ONLY)


@router.post('/api/staff/finance/refunds/{refundId}/fail')
async def fail_refund(req: Request, refundId: str):
    """Record that an authorized refund could not be paid (e.g. provider declined)."""
    return await _refund_transition(req, refundId, 'fail', WRITE_ROLES)


@router.post('/api/staff/finance/days/{businessDate}/adjustments')
async def add_cash_adjustment(req: Request, businessDate: str):
    """An approved intraday cash movement that is neither a receipt nor a refund."""
    user, denied = await actor(req, OWNER_ONLY)
    if denied:
        return denied
    day = as_date(businessDate)
    try:
        body = typed(schemas.CashAdjustment, await payload(req))
    except ValidationError as exc:
        return invalid(exc)
    if not day:
        return err('invalid_payload')
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            adjustment = await ledger.add_cash_adjustment(
                conn, actor_user_id=user['id'], business_date=day,
                amount_minor=body.amountMinor, reason=body.reason)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'adjustment': serialize(adjustment)}, headers=PRIVATE)


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
    try:
        body = typed(schemas.DayClose, await payload(req))
    except ValidationError as exc:
        return invalid(exc)
    business_date, opening = body.businessDate, body.openingMinor
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            close = await ledger.close_day(conn, actor_user_id=user['id'],
                                           business_date=business_date,
                                           counted_minor=body.countedMinor,
                                           reason=body.reason, opening_minor=opening)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'close': serialize(close)}, headers=PRIVATE)


@router.post('/api/staff/finance/periods/close')
async def close_period(req: Request):
    user, denied = await actor(req, WRITE_ROLES)
    if denied:
        return denied
    try:
        body = typed(schemas.PeriodClose, await payload(req))
    except ValidationError as exc:
        return invalid(exc)
    period = body.periodKey
    limited = await _write_gate(req, user)
    if limited:
        return limited
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            close = await ledger.close_period(conn, actor_user_id=user['id'], period=period,
                                              reason=body.reason)
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
    today = ledger.business_date(datetime.now(timezone.utc))
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
    today = ledger.business_date(datetime.now(timezone.utc))
    start = as_date(req.query_params.get('start')) or today.replace(day=1)
    end = as_date(req.query_params.get('end')) or today
    if end < start:
        return err('invalid_range')
    db = await core.pool()
    async with db.acquire() as conn:
        # FIN-10: "the dashboard agrees with the ledger" is a checkable statement, so it is
        # checked - every reported figure against an independent source, plus the journal's
        # own debit/credit balance.
        return core.j({'journal': await ledger.journal_is_balanced(conn),
                       'summary': await ledger.reconcile_summary(conn, start=start, end=end)},
                      headers=PRIVATE)


@router.get('/api/staff/finance/students/{studentId}/statement')
async def student_statement(req: Request, studentId: str):
    """A full financial statement: charges, payments, receipts, refunds, balances.

    FIN-12: default-deny for teachers. Being assigned to teach a student is not authority
    over that family's finances, and the buyer has not granted it, so a linked student's
    payer details are refused rather than narrowed. The coarse indicator route below is the
    only financial fact a teacher may see.
    """
    user, denied = await actor(req, MONEY_READ_ROLES)
    if denied:
        return denied
    student_id = uuid_val(studentId)
    if not student_id:
        return err('student_not_found', 404)
    db = await core.pool()
    async with db.acquire() as conn:
        statement = await ledger.student_statement(conn, student_id)
    return core.j(serialize(statement), headers=PRIVATE)


@router.get('/api/staff/finance/students/{studentId}/tuition-status')
async def student_tuition_status(req: Request, studentId: str):
    """The minimum financial indicator a teacher needs: is there an unpaid balance?

    Amount-free and payer-free on purpose. It answers the one question with a pedagogical
    consequence - a student who has stopped paying may also have stopped attending - without
    turning a teaching link into financial access. Scope is still enforced: an unlinked
    student is indistinguishable from a student who does not exist.
    """
    user, denied = await actor(req, READ_ROLES)
    if denied:
        return denied
    student_id = uuid_val(studentId)
    if not student_id:
        return err('student_not_found', 404)
    db = await core.pool()
    async with db.acquire() as conn:
        if user['role'] not in MONEY_READ_ROLES and not await _teacher_may_read(
                conn, user['id'], student_id):
            # Same shape as a missing student: no cross-scope information disclosure.
            return core.j({'error': 'student_not_found'}, 404, PRIVATE)
        position = await ledger.student_position(conn, student_id)
    if position['overdueMinor'] > 0:
        status = 'overdue'
    elif position['balanceDueMinor'] > 0:
        status = 'outstanding'
    else:
        status = 'clear'
    return core.j({'studentUserId': studentId, 'balanceStatus': status}, headers=PRIVATE)


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


@router.post('/api/internal/payments/sandbox/callback')
async def sandbox_provider_callback(req: Request):
    """Provider callback for the SANDBOX adapter only.

    Disabled unless `TUITION_PROVIDER_SANDBOX=1`, in which case the route answers 404 so an
    unconfigured deployment is indistinguishable from one that has no such route. The
    signature is the authentication; the ledger still re-verifies amount, currency, customer
    and order against the pending intent. See `app/payments_sandbox.py`.
    """
    if not sandbox.enabled():
        return core.j({'error': 'not_found'}, 404, PRIVATE)
    payload, reason = sandbox.validate_notification(req.headers, await req.body())
    if payload is None:
        return core.j({'error': 'invalid_provider_notification', 'reason': reason}, 401, PRIVATE)
    provider = str(payload['provider'])[:20]
    transaction_id = str(payload['transactionId'])[:80]
    status = str(payload['status']).lower()
    db = await core.pool()
    async with db.acquire() as conn, conn.transaction():
        try:
            if status in ledger.PAID_PROOF_STATUSES:
                proof = ledger.provider_proof(
                    amount_minor=payload.get('amountMinor'),
                    currency=payload.get('currency') or ledger.CURRENCY, status=status,
                    order_ref=payload.get('orderRef'),
                    student_user_id=uuid_val(payload.get('studentUserId')))
                payment, _, duplicate = await ledger.confirm_provider_payment(
                    conn, provider=provider, provider_transaction_id=transaction_id, proof=proof)
            elif status in ledger.INTENT_CLOSED_STATES:
                payment = await ledger.close_provider_intent(
                    conn, provider=provider, provider_transaction_id=transaction_id,
                    to_status=status, reason='provider callback')
                duplicate = False
            else:
                return core.j({'error': 'unsupported_provider_status'}, 400, PRIVATE)
        except LedgerError as exc:
            return failure(exc)
    return core.j({'ok': True, 'duplicate': duplicate, 'status': payment['status']},
                  headers=PRIVATE)


async def _write_refusal_audit(event: dict) -> None:
    """Persist a refused money action on its own connection.

    The command that was refused is rolling back, so this must not share its transaction.
    Failure to write the audit is logged but never turns a correct refusal into a 500.
    """
    try:
        db = await core.pool()
        async with db.acquire() as conn:
            await conn.execute(
                'INSERT INTO finance_audit_events (actor_user_id, action, subject_type,'
                ' subject_id, period_key, amount_minor, currency_code, reason, request_id,'
                ' detail) VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6,$7,$8,$9,$10::jsonb)',
                event['actorUserId'], event['action'], event['subjectType'], event['subjectId'],
                event['periodKey'], event['amountMinor'], event['currency'], event['reason'],
                event['requestId'], json.dumps(event['detail'], sort_keys=True, default=str))
    except Exception:  # pragma: no cover - audit must never mask the refusal itself
        core.LOG.exception('refusal_audit_write_failed')


def install():
    ledger.install_refusal_audit(_write_refusal_audit)
    core.app.include_router(router)
