"""Tuition accounts-receivable subledger and the double-entry journal behind it.

This module owns every authoritative money write. It contains no HTTP, no request
parsing and no role logic on purpose: `tuition_port.py` does authorization and input
shaping, and these functions do the transactional work, so the same invariants are
enforced whether the caller is the staff UI, an import job or a test.

Design rules (docs/architecture/DOMAIN_CONTRACTS.md):

* All amounts are ``bigint`` in the currency's smallest unit (``amount_minor``). For UZS
  the smallest unit in circulation is 1 som, so ``800000`` means 800,000 UZS. No float is
  ever used for money and no total is computed in the browser.
* The journal is append-only. Corrections are new documents that reference the original
  (``original_charge_id`` / reversal rows); an ``UPDATE`` or ``DELETE`` of a posted line
  is blocked by a database trigger.
* Every journal transaction must balance. A deferred constraint trigger checks
  ``SUM(debits) = SUM(credits)`` at COMMIT, so a half-written entry cannot survive.
* Revenue recognition is independent of collection: a payment settles a receivable, it
  never recognises revenue by itself.
* Overpayment is a customer-advance liability. It is never clamped away and never turned
  into revenue.
* A provider confirmation produces at most one internal payment, guarded by unique
  indexes on ``(provider, provider_transaction_id)`` and on ``idempotency_key``.

Discount presentation policy: charges post at NET (gross minus approved discount), which
is what the worked example in the delivery brief specifies. ``scholarship_discounts``
stays in the chart of accounts for a buyer who wants gross presentation; switching is a
configuration decision, not a silent behaviour change.
"""
from __future__ import annotations

import json
from hashlib import sha256

import asyncpg

from datetime import date, datetime, timezone
from functools import wraps
from zoneinfo import ZoneInfo
from uuid import UUID, uuid4

#: Every money total in this module is denominated in this currency's smallest unit.
CURRENCY = 'UZS'

#: The operating chart of accounts created by migration 1115. `statutory_code` stays NULL
#: until a buyer maps these to their own approved chart; no statutory number is invented.
ACCOUNT_CODES = (
    'cash_on_hand',
    'bank_clearing',
    'accounts_receivable',
    'customer_advance',
    'deferred_tuition_revenue',
    'tuition_revenue',
    'scholarship_discounts',
    'refund_payable',
    'salary_expense',
    'salary_payable',
    'payment_fees_expense',
    'provider_clearing',
)

CONTRACT_STATES = ('draft', 'approved', 'active', 'completed', 'cancelled')
CHARGE_STATES = ('draft', 'approved', 'posted', 'reversed', 'credited')
PAYMENT_STATES = ('initiated', 'pending_provider', 'confirmed', 'rejected', 'expired',
                  'cancelled', 'partially_refunded', 'refunded')
SETTLED_PAYMENT_STATES = ('confirmed', 'partially_refunded', 'refunded')
CASH_METHODS = {'cash': 'cash_on_hand', 'bank': 'bank_clearing', 'provider': 'provider_clearing'}

# ---------------------------------------------------------------------------
# Two predicates decide which documents take part in money maths. They are
# defined here once so every projection agrees (FIN-01, FIN-10).
#
# POSTED_EVENT — the document has been posted, so it is an accounting fact.
#   Both an original charge and its reversing document satisfy this, which is
#   what makes a reversal net the receivable to zero instead of inverting it.
#   A `reversed`/`credited` marker is a display lifecycle state, not a licence
#   to drop the original out of the sum.
#
# OPEN_DOCUMENT — the document still represents a live obligation. A superseded
#   original is excluded here, so aging, overdue and payment allocation never
#   chase a charge that has already been corrected.
# ---------------------------------------------------------------------------
POSTED_EVENT = "posted_at IS NOT NULL"
OPEN_DOCUMENT = "status = 'posted'"


class LedgerError(Exception):
    """A domain rule refused the command. `code` is stable and safe to return to a client."""

    def __init__(self, code: str, http_status: int = 400, **details):
        super().__init__(code)
        self.code = code
        self.status = http_status
        self.details = details


BUSINESS_TIMEZONE = ZoneInfo('Asia/Tashkent')


def business_date(value: date | datetime) -> date:
    """Derive the academy's business date from an absolute instant."""
    if isinstance(value, datetime):
        aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return aware.astimezone(BUSINESS_TIMEZONE).date()
    return value


def period_key(value: date | datetime | str) -> str:
    """The academy's YYYY-MM financial period, using Asia/Tashkent business dates."""
    if isinstance(value, str):
        value = date.fromisoformat(value[:10])
    local_day = business_date(value)
    return f'{local_day.year:04d}-{local_day.month:02d}'


def _require(condition: bool, code: str, http_status: int = 400, **details):
    if not condition:
        raise LedgerError(code, http_status, **details)


#: FIN-09: the financial semantic keys that decide whether a replayed reference is the same
#: event. Anything outside this set is cosmetic and must not change the answer.
IDENTITY_KEYS = ('studentUserId', 'amountMinor', 'currency', 'method', 'provider',
                 'providerTransactionId', 'occurredAt')


def identity_fingerprint(*, student_user_id, amount_minor, currency, method, provider=None,
                         provider_transaction_id=None, occurred_at=None) -> str:
    """Canonical hash of one financial event's identity.

    Two calls with the same idempotency key are the same event only when every key here
    matches. Comparing a stored hash rather than a handful of ad-hoc fields means a new
    semantic key cannot be forgotten at one call site and silently swallowed at another.
    """
    moment = occurred_at
    if isinstance(moment, datetime):
        moment = business_date(moment).isoformat()
    elif moment is not None:
        moment = str(moment)[:10]
    canonical = {
        'studentUserId': str(student_user_id),
        'amountMinor': int(amount_minor),
        'currency': currency,
        'method': method,
        'provider': provider,
        'providerTransactionId': provider_transaction_id,
        'occurredAt': moment,
    }
    payload = json.dumps(canonical, sort_keys=True, separators=(',', ':')).encode()
    return sha256(payload).hexdigest()


def identity_mismatch(existing_row, *, student_user_id, amount_minor, method, provider=None,
                      provider_transaction_id=None, occurred_at=None) -> list[str]:
    """The semantic keys a replayed reference disagrees about. Empty means identical."""
    moment = occurred_at
    if isinstance(moment, datetime):
        moment = business_date(moment)
    checks = (
        ('studentUserId', str(existing_row['student_user_id']) == str(student_user_id)),
        ('amountMinor', int(existing_row['amount_minor']) == int(amount_minor)),
        ('currency', existing_row['currency_code'] == CURRENCY),
        ('method', existing_row['method'] == method),
        ('provider', (existing_row['provider'] or None) == (provider or None)),
        ('providerTransactionId',
         (existing_row['provider_transaction_id'] or None) == (provider_transaction_id or None)),
        ('occurredAt', moment is None or business_date(existing_row['occurred_at']) == moment),
    )
    return [name for name, matches in checks if not matches]


#: Set by the application at startup. A refused money command must still leave a trace, but
#: its own transaction is rolling back, so the record has to be written by someone else on
#: another connection. Kept as an injectable sink so the ledger stays free of pool/HTTP
#: concerns and a test can prove the behaviour without standing up the app.
REFUSAL_AUDIT_SINK = None


def install_refusal_audit(sink) -> None:
    """Register the sink used for audit records that must survive a rolled-back command."""
    global REFUSAL_AUDIT_SINK
    REFUSAL_AUDIT_SINK = sink


async def _audit_refusal(*, actor_user_id, action, subject_type, subject_id=None, period=None,
                         amount_minor=None, reason=None, request_id=None, detail=None):
    """Record a REFUSED sensitive action on a transaction that will not roll back.

    Deliberately separate from `_audit`: a refusal raises, the caller's transaction unwinds,
    and an audit row written inside it would vanish - which is exactly the evidence an owner
    needs when someone replays a payment reference with a different amount.
    """
    if REFUSAL_AUDIT_SINK is None:
        return
    await REFUSAL_AUDIT_SINK({
        'actorUserId': str(actor_user_id) if actor_user_id else None, 'action': action,
        'subjectType': subject_type, 'subjectId': str(subject_id) if subject_id else None,
        'periodKey': period, 'amountMinor': amount_minor, 'currency': CURRENCY,
        'reason': (reason or '')[:300] or None,
        'requestId': (str(request_id) if request_id else '')[:80] or None,
        'detail': detail or {},
    })


async def audit_event(conn, *, actor_user_id, action, subject_type, subject_id=None, period=None,
                      amount_minor=None, reason=None, request_id=None, detail=None):
    """Public entry point for the sensitive-action audit trail (FIN-11/FIN-12).

    Same transaction as the money it describes, so an audit row can never outlive the change
    it records.
    """
    await _audit(conn, actor_user_id=actor_user_id, action=action, subject_type=subject_type,
                 subject_id=subject_id, period=period, amount_minor=amount_minor, reason=reason,
                 request_id=request_id, detail=detail)


async def _audit(conn, *, actor_user_id, action, subject_type, subject_id=None, period=None,
                 amount_minor=None, reason=None, request_id=None, detail=None):
    """Append an immutable audit record for a sensitive financial action.

    Written inside the caller's transaction, so an audit row can never describe money that
    rolled back, and money can never move without its audit row.
    """
    await conn.execute(
        'INSERT INTO finance_audit_events (actor_user_id, action, subject_type, subject_id,'
        ' period_key, amount_minor, currency_code, reason, request_id, detail)'
        ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',
        actor_user_id, action, subject_type, subject_id, period, amount_minor, CURRENCY,
        (reason or '')[:300] or None, (request_id or '')[:80] or None,
        json.dumps(detail or {}, sort_keys=True, default=str))



def transactional(command):
    """Every money command is one atomic unit.

    The balanced-journal check is a DEFERRED constraint trigger, so it is evaluated when
    the transaction commits; a command that wrote its debit and credit in two separate
    implicit transactions would look unbalanced. Wrapping here also means an exception
    halfway through a command can never leave a payment without its journal lines. Inside
    an already-open transaction this is a savepoint, so callers keep control of the
    surrounding unit of work.
    """
    @wraps(command)
    async def wrapped(conn, *args, **kwargs):
        async with conn.transaction():
            return await command(conn, *args, **kwargs)
    return wrapped


def _minor(value) -> int:
    """Reject floats for money at the boundary instead of rounding them silently."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise LedgerError('amount_must_be_integer_minor_units')
    _require(-(2**63) <= value < 2**63, 'amount_out_of_range', 422)
    return value


async def account_id(conn, code: str) -> UUID:
    row = await conn.fetchval('SELECT id FROM finance_accounts WHERE code=$1 AND is_active', code)
    _require(row is not None, 'account_not_configured', 500, account=code)
    return row


async def _post_journal(conn, *, source_type: str, source_id, student_user_id=None,
                        actor_user_id=None, memo: str | None = None, period: str | None = None,
                        lines, occurred_at=None) -> UUID:
    """Write one balanced journal transaction.

    `lines` is a sequence of ``(account_code, 'debit'|'credit', amount_minor)``. Zero
    amounts are skipped so callers can express "and the surplus leg if any" without
    branching on every call site.
    """
    rows = [(code, direction, _minor(amount)) for code, direction, amount in lines if amount]
    _require(bool(rows), 'empty_journal_transaction')
    for code, direction, amount in rows:
        _require(code in ACCOUNT_CODES, 'unknown_account', account=code)
        _require(direction in ('debit', 'credit'), 'unknown_direction', direction=direction)
        _require(amount > 0, 'journal_line_must_be_positive', amount=amount)
    transaction_id = uuid4()
    entry = await conn.fetchrow(
        '''INSERT INTO finance_journal_entries
             (transaction_id, source_type, source_id, student_user_id, actor_user_id,
              memo, period_key, occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,coalesce($8, now())) RETURNING id''',
        transaction_id, source_type, source_id, student_user_id, actor_user_id, memo, period,
        occurred_at)
    for code, direction, amount in rows:
        await conn.execute(
            '''INSERT INTO finance_journal_lines
                 (transaction_id, entry_id, account_id, direction, amount_minor, currency_code)
               VALUES ($1,$2,$3,$4,$5,$6)''',
            transaction_id, entry['id'], await account_id(conn, code), direction, amount, CURRENCY)
    return transaction_id


async def _lock_period(conn, period: str, *, closing: bool = False) -> None:
    lock = 'pg_advisory_xact_lock' if closing else 'pg_advisory_xact_lock_shared'
    await conn.execute(
        f"SELECT {lock}(hashtext(current_schema() || ':finance-period'),"
        " hashtext($1::text))", period)


async def _assert_period_open(conn, period: str):
    closed = await conn.fetchval('SELECT 1 FROM finance_closed_periods WHERE period_key=$1', period)
    _require(not closed, 'period_closed', 409, periodKey=period)


async def _lock_cash_day(conn, day: date) -> None:
    await conn.execute(
        "SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':finance-day'), $1::integer)",
        day.toordinal())


async def _assert_day_open(conn, business_date: date):
    await _lock_cash_day(conn, business_date)
    closed = await conn.fetchval('SELECT 1 FROM cash_day_closes WHERE business_date=$1', business_date)
    _require(not closed, 'day_closed', 409, businessDate=business_date.isoformat())


async def _student_exists(conn, student_user_id) -> None:
    """The established student-record contract: the payer must BE a student.

    Money movements use this and not the stricter check below: a suspended student may still
    settle an existing debt, and refusing that would leave a receivable uncollectable.
    """
    found = await conn.fetchval("SELECT 1 FROM users WHERE id=$1 AND role='student'", student_user_id)
    _require(bool(found), 'student_not_found', 404)


async def _active_student(conn, student_user_id) -> None:
    """An enrolment act additionally needs an ACTIVE student.

    Billing a staff account would push a salary line into the receivable ledger, and billing
    a suspended account would open a receivable against someone who is not enrolled. A
    non-student is reported exactly like a missing id, so the endpoint cannot be probed to
    discover which accounts exist.
    """
    row = await conn.fetchrow('SELECT role, account_status FROM users WHERE id=$1', student_user_id)
    _require(row is not None and row['role'] == 'student', 'student_not_found', 404)
    _require(row['account_status'] == 'active', 'student_not_active', 409,
             accountStatus=row['account_status'])


async def _next_receipt_no(conn, period: str) -> str:
    """Server-owned receipt sequence: two operators can never issue the same number."""
    value = await conn.fetchval(
        '''INSERT INTO cash_receipt_sequences(period_key, next_value) VALUES ($1, 2)
           ON CONFLICT (period_key) DO UPDATE
             SET next_value = cash_receipt_sequences.next_value + 1, updated_at = now()
           RETURNING next_value - 1''', period)
    return f'RC-{period.replace("-", "")}-{int(value):06d}'


# ─────────────────────────────── contracts ───────────────────────────────
@transactional
async def create_contract(conn, *, actor_user_id, student_user_id, monthly_amount_minor,
                          starts_on, term_months=1, course_id=None, ends_on=None, note=None):
    await _active_student(conn, student_user_id)
    amount = _minor(monthly_amount_minor)
    _require(amount >= 0, 'amount_must_be_non_negative')
    _require(isinstance(term_months, int) and not isinstance(term_months, bool)
             and 1 <= term_months <= 120, 'invalid_term')
    _require(ends_on is None or ends_on >= starts_on, 'invalid_contract_dates', 422)
    if course_id is not None:
        _require(await conn.fetchval('SELECT 1 FROM courses WHERE id=$1', course_id),
                 'course_not_found', 404)
    row = await conn.fetchrow(
        '''INSERT INTO tuition_contracts
             (student_user_id, course_id, monthly_amount_minor, currency_code, term_months,
              starts_on, ends_on, note, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *''',
        student_user_id, course_id, amount, CURRENCY, term_months, starts_on, ends_on, note,
        actor_user_id)
    await _audit(conn, actor_user_id=actor_user_id, action='contract_created',
                 subject_type='tuition_contract', subject_id=row['id'], amount_minor=amount,
                 reason=note, detail={'studentUserId': str(student_user_id),
                                      'termMonths': term_months,
                                      'startsOn': str(starts_on)})
    return dict(row)


@transactional
async def approve_contract(conn, *, actor_user_id, contract_id):
    row = await conn.fetchrow('SELECT * FROM tuition_contracts WHERE id=$1 FOR UPDATE', contract_id)
    _require(row is not None, 'contract_not_found', 404)
    _require(row['status'] == 'draft', 'invalid_state', 409, status=row['status'])
    if row.get('service_policy_id'):
        from .prepaid_services import approve_for_contract
        await approve_for_contract(conn,actor_user_id,row)
    updated = await conn.fetchrow(
        '''UPDATE tuition_contracts SET status='approved', approved_by=$2, approved_at=now(),
             updated_at=now() WHERE id=$1 RETURNING *''', contract_id, actor_user_id)
    await _audit(conn, actor_user_id=actor_user_id, action='contract_approved',
                 subject_type='tuition_contract', subject_id=contract_id,
                 amount_minor=updated['monthly_amount_minor'],
                 detail={'studentUserId': str(updated['student_user_id'])})
    return dict(updated)


@transactional
async def activate_contract(conn, *, actor_user_id, contract_id):
    row = await conn.fetchrow('SELECT * FROM tuition_contracts WHERE id=$1 FOR UPDATE', contract_id)
    _require(row is not None, 'contract_not_found', 404)
    _require(row['status'] in ('approved', 'active'), 'invalid_state', 409, status=row['status'])
    if row.get('service_policy_id'):
        from .prepaid_services import validate_activation
        await validate_activation(conn,row)
    updated = await conn.fetchrow(
        "UPDATE tuition_contracts SET status='active', updated_at=now() WHERE id=$1 RETURNING *",
        contract_id)
    await _audit(conn, actor_user_id=actor_user_id, action='contract_activated',
                 subject_type='tuition_contract', subject_id=contract_id,
                 amount_minor=updated['monthly_amount_minor'])
    return dict(updated)


@transactional
async def add_discount(conn, *, actor_user_id, contract_id, period, amount_minor, reason):
    """Register an approved discount as its own document. One document per contract+period."""
    amount = _minor(amount_minor)
    _require(amount > 0, 'amount_must_be_positive')
    _require(bool(reason and reason.strip()), 'reason_required')
    contract = await conn.fetchrow('SELECT * FROM tuition_contracts WHERE id=$1', contract_id)
    _require(contract is not None, 'contract_not_found', 404)
    _require(contract['status'] in ('approved', 'active'), 'invalid_state', 409,
             status=contract['status'])
    _require(amount <= contract['monthly_amount_minor'], 'discount_exceeds_fee')
    posted = await conn.fetchval(
        'SELECT count(*) FROM tuition_charges WHERE contract_id=$1 AND period_key=$2'
        " AND is_reversal=false AND status='posted'", contract_id, period)
    # FIN-05: the posted net IS the obligation. A discount added after posting would
    # understate a receivable that is already in the journal with no entry explaining the
    # difference. Relief after posting is a credit note.
    _require(not posted, 'charge_already_posted', 409, period=period, remedy='credit_note')
    try:
        row = await conn.fetchrow(
            '''INSERT INTO tuition_contract_discounts
                 (contract_id, period_key, amount_minor, reason, approved_by)
               VALUES ($1,$2,$3,$4,$5) RETURNING *''',
            contract_id, period, amount, reason.strip()[:200], actor_user_id)
        await _audit(conn, actor_user_id=actor_user_id, action='discount_added',
                     subject_type='tuition_contract_discount', subject_id=row['id'],
                     period=period, amount_minor=amount, reason=reason.strip()[:300],
                     detail={'contractId': str(contract_id)})
    except Exception as exc:  # UNIQUE (contract_id, period_key)
        if getattr(exc, 'sqlstate', None) == '23505':
            raise LedgerError('discount_already_approved_for_period', 409, periodKey=period) from exc
        raise
    return dict(row)


# ─────────────────────────────── charges ───────────────────────────────
@transactional
async def create_charge(conn, *, actor_user_id, student_user_id, period, due_date,
                        gross_amount_minor, contract_id=None, adjustment_reason=None):
    """Draft a receivable. An approved discount document reduces it exactly once.

    FIN-11: when the charge belongs to a contract, the contract's approved monthly price is
    the price. Billing something else is not a rounding matter - it is a change of commercial
    terms - so it needs an explicit ``adjustment_reason``, and that reason is audited next to
    the charge. A silent price difference between contract and invoice is how a centre ends up
    unable to explain its own receivables.
    """
    await _active_student(conn, student_user_id)
    gross = _minor(gross_amount_minor)
    _require(gross >= 0, 'amount_must_be_non_negative')
    discount = 0
    if contract_id is not None:
        contract = await conn.fetchrow('SELECT * FROM tuition_contracts WHERE id=$1', contract_id)
        _require(contract is not None, 'contract_not_found', 404)
        _require(contract['student_user_id'] == student_user_id, 'contract_student_mismatch', 403)
        _require(not contract.get('service_policy_id'),'service_consumption_required')
        _require(contract['status'] in ('approved', 'active'), 'invalid_state', 409,
                 status=contract['status'])
        if gross != contract['monthly_amount_minor']:
            _require(bool(adjustment_reason and adjustment_reason.strip()),
                     'charge_amount_conflicts_with_contract', 409,
                     contractMinor=contract['monthly_amount_minor'], chargeMinor=gross)
            await _audit(conn, actor_user_id=actor_user_id, action='contract_price_adjustment',
                         subject_type='tuition_contract', subject_id=contract_id, period=period,
                         amount_minor=gross, reason=adjustment_reason.strip()[:300],
                         detail={'contractMinor': contract['monthly_amount_minor'],
                                 'chargeMinor': gross})
        discount = await conn.fetchval(
            'SELECT coalesce(sum(amount_minor),0) FROM tuition_contract_discounts'
            ' WHERE contract_id=$1 AND period_key=$2', contract_id, period) or 0
    _require(gross - discount >= 0, 'discount_exceeds_fee')
    try:
        row = await conn.fetchrow(
            '''INSERT INTO tuition_charges
                 (contract_id, student_user_id, period_key, currency_code, gross_amount_minor,
                  discount_amount_minor, net_amount_minor, due_date, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *''',
            contract_id, student_user_id, period, CURRENCY, gross, discount, gross - discount,
            due_date, actor_user_id)
        await _audit(conn, actor_user_id=actor_user_id, action='charge_created',
                     subject_type='tuition_charge', subject_id=row['id'], period=period,
                     amount_minor=gross - discount,
                     detail={'grossMinor': gross, 'discountMinor': discount,
                             'contractId': str(contract_id) if contract_id else None,
                             'dueDate': str(due_date)})
    except asyncpg.UniqueViolationError:
        # The partial unique index on (contract_id, period_key) is the real guard: two
        # schedulers racing the same monthly job cannot both insert. Reporting it as a
        # duplicate rather than a 500 keeps the scheduler retry-safe.
        raise LedgerError('charge_already_exists_for_period', 409, contractId=str(contract_id),
                          period=period)
    return dict(row)


@transactional
async def generate_installment(conn, *, actor_user_id, contract_id, period, due_date):
    """Idempotently produce the ONE tuition installment for a contract and billing period.

    Returns ``(charge, created)``. A retry of the monthly job returns the existing charge
    instead of billing the family twice; the price comes from the approved contract, not from
    the caller. A charge that already exists with a different gross is a conflict, because it
    means either the contract changed after billing or someone hand-edited a draft - both
    need an explicit, authorized adjustment rather than a silent second document.
    """
    contract = await conn.fetchrow('SELECT * FROM tuition_contracts WHERE id=$1', contract_id)
    _require(contract is not None, 'contract_not_found', 404)
    _require(not contract.get('service_policy_id'),'service_contract_has_no_monthly_invoice')
    _require(contract['status'] in ('approved', 'active'), 'invalid_state', 409,
             status=contract['status'])
    monthly = contract['monthly_amount_minor']
    existing = await conn.fetchrow(
        'SELECT * FROM tuition_charges WHERE contract_id=$1 AND period_key=$2'
        " AND is_reversal=false AND status NOT IN ('reversed','credited')"
        ' LIMIT 1 FOR UPDATE', contract_id, period)
    if existing is not None:
        _require(existing['gross_amount_minor'] == monthly, 'installment_amount_mismatch', 409,
                 contractMinor=monthly, chargeMinor=existing['gross_amount_minor'])
        return dict(existing), False
    try:
        charge = await create_charge(conn, actor_user_id=actor_user_id,
                                     student_user_id=contract['student_user_id'], period=period,
                                     due_date=due_date, gross_amount_minor=monthly,
                                     contract_id=contract_id)
    except LedgerError as exc:
        if exc.code != 'charge_already_exists_for_period':
            raise
        # Lost the race with a concurrent generator: the winner's row is the answer.
        winner = await conn.fetchrow(
            'SELECT * FROM tuition_charges WHERE contract_id=$1 AND period_key=$2'
            " AND is_reversal=false AND status NOT IN ('reversed','credited') LIMIT 1",
            contract_id, period)
        _require(winner is not None, 'charge_already_exists_for_period', 409, period=period)
        return dict(winner), False
    return charge, True


@transactional
async def approve_charge(conn, *, actor_user_id, charge_id):
    """Owner approval of a drafted receivable.

    Two controls, both enforced here rather than only in the HTTP layer, because they have to
    hold for a scheduler, an import job and a test just as much as for a browser: only an
    owner may approve, and the drafter may not approve their own document.
    """
    charge = await conn.fetchrow('SELECT * FROM tuition_charges WHERE id=$1 FOR UPDATE', charge_id)
    _require(charge is not None, 'charge_not_found', 404)
    _require(charge['status'] == 'draft', 'invalid_state', 409, status=charge['status'])
    _require(charge['is_reversal'] is False, 'reversal_charge_cannot_be_approved')
    _require(await _actor_role(conn, actor_user_id) == 'owner', 'approval_requires_owner', 403)
    _require(charge['created_by'] is None or str(actor_user_id) != str(charge['created_by']),
             'approver_must_differ_from_drafter', 403)
    updated = await conn.fetchrow(
        "UPDATE tuition_charges SET status='approved', approved_by=$2, approved_at=now()"
        ' WHERE id=$1 RETURNING *', charge_id, actor_user_id)
    await _audit(conn, actor_user_id=actor_user_id, action='charge_approved',
                 subject_type='tuition_charge', subject_id=charge_id,
                 period=updated['period_key'], amount_minor=updated['net_amount_minor'],
                 detail={'draftedBy': str(charge['created_by']) if charge['created_by'] else None})
    return dict(updated)


@transactional
async def post_charge(conn, *, actor_user_id, charge_id):
    """Post the receivable: debit A/R, credit deferred tuition revenue (net presentation)."""
    charge = await conn.fetchrow('SELECT * FROM tuition_charges WHERE id=$1 FOR UPDATE', charge_id)
    _require(charge is not None, 'charge_not_found', 404)
    _require(not charge['is_reversal'], 'reversal_charge_cannot_be_posted')
    # FIN-06: draft -> approved -> posted. A receivable may not reach the journal on the
    # word of the person who drafted it, so 'draft' is not a postable state.
    _require(charge['status'] != 'draft', 'charge_not_approved', 409, status=charge['status'])
    _require(charge['status'] == 'approved', 'invalid_state', 409, status=charge['status'])
    _require(charge['approved_at'] is not None, 'charge_not_approved', 409,
             status=charge['status'])
    await _assert_period_open(conn, charge['period_key'])
    net = charge['net_amount_minor']
    if net:
        await _post_journal(
            conn, source_type='charge', source_id=charge['id'],
            student_user_id=charge['student_user_id'], actor_user_id=actor_user_id,
            memo=f'Tuition charge {charge["period_key"]}', period=charge['period_key'],
            lines=[('accounts_receivable', 'debit', net),
                   ('deferred_tuition_revenue', 'credit', net)])
    updated = await conn.fetchrow(
        "UPDATE tuition_charges SET status='posted', posted_at=now(), posted_by=$2,"
        ' discount_locked_at=now(), discount_locked_minor=discount_amount_minor'
        ' WHERE id=$1 RETURNING *', charge_id, actor_user_id)
    await _audit(conn, actor_user_id=actor_user_id, action='charge_posted',
                 subject_type='tuition_charge', subject_id=charge_id,
                 period=updated['period_key'], amount_minor=updated['net_amount_minor'],
                 detail={'approvedBy': str(charge['approved_by']) if charge['approved_by'] else None})
    return dict(updated)


async def _actor_role(conn, user_id) -> str | None:
    """The role of an actor, for separation-of-duties checks that must hold in the ledger.

    `tuition_port.py` authorizes *who may call a route*; this answers a narrower question
    that has to be true no matter which client called: relief of a posted obligation needs a
    different person than the one who drafted it.
    """
    if user_id is None:
        return None
    return await conn.fetchval('SELECT role FROM users WHERE id=$1', user_id)


@transactional
async def create_credit_note(conn, *, actor_user_id, charge_id, amount_minor, reason):
    """Draft relief against a charge that is already posted.

    A credit note is its own document: it never edits the charge, and it only touches the
    ledger once it has been approved by an owner and posted. One live note per charge and
    period, so a repeated request cannot stack relief.
    """
    amount = _minor(amount_minor)
    _require(amount > 0, 'amount_must_be_positive')
    _require(bool(reason and reason.strip()), 'reason_required')
    charge = await conn.fetchrow('SELECT * FROM tuition_charges WHERE id=$1 FOR UPDATE', charge_id)
    _require(charge is not None, 'charge_not_found', 404)
    _require(charge['status'] == 'posted', 'invalid_state', 409, status=charge['status'])
    _require(not charge['is_reversal'], 'reversal_cannot_be_credited')
    already = await conn.fetchval(
        'SELECT coalesce(sum(amount_minor),0) FROM tuition_credit_notes'
        " WHERE charge_id=$1 AND status NOT IN ('reversed')", charge_id)
    _require(already + amount <= charge['net_amount_minor'], 'credit_exceeds_charge', 409,
             netMinor=charge['net_amount_minor'], alreadyCreditedMinor=already,
             requestedMinor=amount)
    applied = await conn.fetchval(
        'SELECT coalesce(sum(amount_minor),0) FROM tuition_payment_allocations'
        ' WHERE charge_id=$1', charge_id) or 0
    _require(already + applied + amount <= charge['net_amount_minor'],
             'credit_exceeds_unallocated_charge', 409,
             unallocatedMinor=max(charge['net_amount_minor'] - already - applied, 0),
             appliedMinor=applied, requestedMinor=amount)
    try:
        row = await conn.fetchrow(
            'INSERT INTO tuition_credit_notes (charge_id, contract_id, student_user_id,'
            ' period_key, currency_code, amount_minor, reason, requested_by)'
            ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
            charge['id'], charge['contract_id'], charge['student_user_id'], charge['period_key'],
            charge['currency_code'], amount, reason.strip()[:300], actor_user_id)
    except asyncpg.UniqueViolationError as exc:
        raise LedgerError('credit_note_already_exists', 409, chargeId=str(charge['id']),
                          period=charge['period_key']) from exc
    return dict(row)


@transactional
async def approve_credit_note(conn, *, actor_user_id, credit_note_id):
    """Owner approval. The drafter cannot approve their own note."""
    note = await conn.fetchrow('SELECT * FROM tuition_credit_notes WHERE id=$1 FOR UPDATE',
                               credit_note_id)
    _require(note is not None, 'credit_note_not_found', 404)
    _require(note['status'] == 'draft', 'invalid_state', 409, status=note['status'])
    _require(await _actor_role(conn, actor_user_id) == 'owner', 'approval_requires_owner', 403)
    _require(str(actor_user_id) != str(note['requested_by']), 'approver_must_differ_from_drafter',
             403)
    updated = await conn.fetchrow(
        "UPDATE tuition_credit_notes SET status='approved', approved_by=$2, approved_at=now()"
        ' WHERE id=$1 RETURNING *', credit_note_id, actor_user_id)
    return dict(updated)


@transactional
async def post_credit_note(conn, *, actor_user_id, credit_note_id):
    """Post approved relief: debit scholarship discounts, credit accounts receivable.

    The charge document is untouched, so the audit trail reads "billed 800000, relieved
    200000" instead of a receivable that quietly changed shape.
    """
    note = await conn.fetchrow('SELECT * FROM tuition_credit_notes WHERE id=$1 FOR UPDATE',
                               credit_note_id)
    _require(note is not None, 'credit_note_not_found', 404)
    _require(note['status'] == 'approved', 'credit_note_not_approved', 409, status=note['status'])
    moment = datetime.now(timezone.utc)
    posting_period = period_key(moment)
    await _assert_period_open(conn, posting_period)
    # Serialize credit posting with payment allocation on the same charge.
    charge = await conn.fetchrow('SELECT * FROM tuition_charges WHERE id=$1 FOR UPDATE',
                                 note['charge_id'])
    _require(charge is not None and charge['status'] == 'posted',
             'credit_note_charge_not_open', 409)
    credited = await conn.fetchval(
        'SELECT coalesce(sum(amount_minor),0) FROM tuition_credit_notes'
        " WHERE charge_id=$1 AND status='posted'", note['charge_id'])
    _require(credited + note['amount_minor'] <= charge['net_amount_minor'],
             'credit_exceeds_charge', 409, netMinor=charge['net_amount_minor'])
    applied = await conn.fetchval(
        'SELECT coalesce(sum(amount_minor),0) FROM tuition_payment_allocations'
        ' WHERE charge_id=$1', note['charge_id']) or 0
    _require(credited + applied + note['amount_minor'] <= charge['net_amount_minor'],
             'credit_note_conflicts_with_allocations', 409,
             unallocatedMinor=max(charge['net_amount_minor'] - credited - applied, 0),
             appliedMinor=applied)
    await _post_journal(
        conn, source_type='credit_note', source_id=note['id'],
        student_user_id=note['student_user_id'], actor_user_id=actor_user_id,
        memo=note['reason'], period=posting_period, occurred_at=moment,
        lines=[('scholarship_discounts', 'debit', note['amount_minor']),
               ('accounts_receivable', 'credit', note['amount_minor'])])
    updated = await conn.fetchrow(
        "UPDATE tuition_credit_notes SET status='posted', posted_at=$2 WHERE id=$1 RETURNING *",
        credit_note_id, moment)
    await _audit(conn, actor_user_id=actor_user_id, action='credit_note_posted',
                 subject_type='tuition_credit_note', subject_id=credit_note_id,
                 period=posting_period, amount_minor=note['amount_minor'], reason=note['reason'],
                 detail={'chargeId': str(charge['id']), 'chargePeriod': note['period_key']})
    return dict(updated)


@transactional
async def reverse_charge(conn, *, actor_user_id, charge_id, reason):
    """Correct a posted charge with a NEW reversing document; the original is never edited."""
    _require(bool(reason and reason.strip()), 'reason_required')
    charge = await conn.fetchrow('SELECT * FROM tuition_charges WHERE id=$1 FOR UPDATE', charge_id)
    _require(charge is not None, 'charge_not_found', 404)
    _require(charge['status'] == 'posted', 'invalid_state', 409, status=charge['status'])
    _require(not charge['is_reversal'], 'reversal_cannot_be_reversed')
    _require(not charge.get('service_policy_id'),'service_charge_requires_credit_note')
    applied = await conn.fetchval(
        'SELECT coalesce(sum(amount_minor),0) FROM tuition_payment_allocations WHERE charge_id=$1',
        charge_id) or 0
    _require(applied == 0, 'charge_has_allocations', 409, appliedMinor=applied)
    credited = await conn.fetchval(
        'SELECT coalesce(sum(amount_minor),0) FROM tuition_credit_notes'
        " WHERE charge_id=$1 AND status='posted'", charge_id) or 0
    _require(credited == 0, 'charge_has_credit_notes', 409, creditedMinor=credited)
    today = business_date(datetime.now(timezone.utc))
    await _assert_period_open(conn, period_key(today))
    # period_key is the accounting period of the correction (today); due_date is inherited
    # from the original so aging and overdue windows see the pair cancel wherever they look.
    reversing = await conn.fetchrow(
        '''INSERT INTO tuition_charges
             (contract_id, student_user_id, period_key, currency_code, gross_amount_minor,
              discount_amount_minor, net_amount_minor, status, is_reversal, original_charge_id,
              reversal_reason, due_date, posted_at, posted_by, created_by)
           VALUES ($1,$2,$3,$4,$5,0,$6,'posted',true,$7,$8,$9,now(),$10,$10) RETURNING *''',
        charge['contract_id'], charge['student_user_id'], period_key(today), CURRENCY,
        -charge['net_amount_minor'], -charge['net_amount_minor'], charge['id'],
        reason.strip()[:200], charge['due_date'], actor_user_id)
    if charge['net_amount_minor']:
        await _post_journal(
            conn, source_type='charge_reversal', source_id=reversing['id'],
            student_user_id=charge['student_user_id'], actor_user_id=actor_user_id,
            memo=f'Reversal of charge {charge["period_key"]}', period=period_key(today),
            lines=[('deferred_tuition_revenue', 'debit', charge['net_amount_minor']),
                   ('accounts_receivable', 'credit', charge['net_amount_minor'])])
    await conn.execute(
        "UPDATE tuition_charges SET status='reversed', reversal_reason=$2 WHERE id=$1",
        charge_id, reason.strip()[:200])
    return dict(reversing)


# ─────────────────────────────── payments ───────────────────────────────
@transactional
async def record_payment(conn, *, actor_user_id, student_user_id, amount_minor, method='cash',
                         provider=None, provider_transaction_id=None, idempotency_key=None,
                         receipt_purpose=None, payer_name=None, occurred_at=None, confirm=True,service_policy_id=None,
                         new_service_purchase=False):
    """Record money in, allocate it to open charges and write the balanced journal.

    Returns ``(payment_row, allocations, duplicate)``. A repeated provider callback or a
    retried browser submit resolves to the SAME payment row and writes nothing twice.

    Must be called inside an open transaction: payment, allocations and journal lines are
    one atomic unit, and the duplicate-callback recovery relies on a savepoint.
    """
    amount = _minor(amount_minor)
    _require(amount > 0, 'amount_must_be_positive')
    from .prepaid_services import finance_lock,for_payment,payment_changed
    await finance_lock(conn,student_user_id)
    if service_policy_id:await for_payment(conn,service_policy_id,student_user_id)
    _require(method in CASH_METHODS, 'unknown_method', method=method)
    _require(provider is None or provider_transaction_id, 'provider_transaction_id_required')
    if method == 'provider':
        # A staff session, a browser redirect and this function are all untrusted about
        # whether a provider was paid. Provider money only settles through
        # confirm_provider_payment() with an adapter-produced proof.
        confirm = False
    await _student_exists(conn, student_user_id)
    moment = occurred_at or datetime.now(timezone.utc)
    if isinstance(moment, str):
        moment = datetime.fromisoformat(moment)
    await _lock_cash_day(conn, business_date(moment))

    async def check_identity(existing):
        mismatched = identity_mismatch(
            existing, student_user_id=student_user_id, amount_minor=amount, method=method,
            provider=provider, provider_transaction_id=provider_transaction_id,
            occurred_at=moment)
        if existing.get('service_policy_id')!=service_policy_id:mismatched.append('servicePolicyId')
        if mismatched:
            # FIN-09: the same key describing a different event. Returning the old row here
            # would silently swallow this one - the family pays and nothing is recorded.
            await _audit_refusal(actor_user_id=actor_user_id, action='idempotency_conflict',
                                 subject_type='tuition_payment', subject_id=existing['id'],
                                 period=period_key(moment), amount_minor=amount,
                                 reason='replayed reference with different financial semantic keys',
                                 detail={'mismatched': mismatched,
                                         'idempotencyKey': idempotency_key,
                                         'provider': provider,
                                         'providerTransactionId': provider_transaction_id})
            raise LedgerError('idempotency_conflict', 409, mismatched=mismatched,
                              existingPaymentId=str(existing['id']))

    # Lock any existing row first so two concurrent callbacks serialise instead of both
    # trying to insert and one losing to the unique index mid-flight.
    existing = await conn.fetchrow(
        '''SELECT * FROM tuition_payments
           WHERE ($1::varchar IS NOT NULL AND idempotency_key = $1)
              OR ($2::varchar IS NOT NULL AND provider = $2 AND provider_transaction_id = $3)
           LIMIT 1 FOR UPDATE''', idempotency_key, provider, provider_transaction_id)
    if existing is not None:
        await check_identity(existing)
        return dict(existing), [], True

    if service_policy_id and new_service_purchase:
        from .prepaid_services import validate_purchase_amount
        policy=await for_payment(conn,service_policy_id,student_user_id,new_purchase=True)
        await validate_purchase_amount(conn,policy,amount)
    await _assert_day_open(conn, business_date(moment))
    await _assert_period_open(conn, period_key(moment))
    payment = None
    try:
        # A savepoint, not a new transaction: the caller owns the atomic unit. Two
        # concurrent identical callbacks race on the unique index; the loser rolls back to
        # the savepoint and reports the winner instead of raising a duplicate error.
        async with conn.transaction():
            policy_column=',service_policy_id' if service_policy_id else ''
            policy_value=',$13' if service_policy_id else ''
            parameters=[student_user_id,CURRENCY,amount,method,provider,provider_transaction_id,
                idempotency_key,'confirmed' if confirm else 'pending_provider',receipt_purpose,actor_user_id,payer_name,moment]
            if service_policy_id:parameters.append(service_policy_id)
            payment = await conn.fetchrow(
                f'''INSERT INTO tuition_payments
                     (student_user_id, currency_code, amount_minor, method, provider,
                      provider_transaction_id, idempotency_key, status, receipt_purpose,
                      operator_user_id, payer_name, occurred_at, confirmed_at{policy_column})
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,
                           CASE WHEN $8::varchar = 'confirmed' THEN $12::timestamptz END{policy_value})
                   RETURNING *''',
                *parameters)
    except Exception as exc:
        if getattr(exc, 'sqlstate', None) != '23505':
            raise
        winner = await conn.fetchrow(
            '''SELECT * FROM tuition_payments
               WHERE ($1::varchar IS NOT NULL AND idempotency_key = $1)
                  OR ($2::varchar IS NOT NULL AND provider = $2 AND provider_transaction_id = $3)
               LIMIT 1''', idempotency_key, provider, provider_transaction_id)
        if winner is None:
            raise
        await check_identity(winner)
        return dict(winner), [], True

    await _audit(conn, actor_user_id=actor_user_id, action='payment_recorded',
                 subject_type='tuition_payment', subject_id=payment['id'],
                 period=period_key(moment), amount_minor=amount, reason=receipt_purpose,
                 detail={'method': method, 'provider': provider,
                         'providerTransactionId': provider_transaction_id,
                         'status': payment['status'],
                         'idempotencyKey': idempotency_key})
    if not confirm:
        # Unconfirmed provider intent: no allocation, no journal. A redirect is not money.
        return dict(payment), [], False

    allocations = await _allocate(conn, payment)
    allocated = sum(row['amount_minor'] for row in allocations)
    surplus = amount - allocated
    receipt_no = None
    if method in ('cash', 'bank'):
        receipt_no = await _next_receipt_no(conn, period_key(moment))
        payment = dict(await conn.fetchrow(
            'UPDATE tuition_payments SET receipt_no=$2 WHERE id=$1 RETURNING *',
            payment['id'], receipt_no))
    else:
        payment = dict(payment)
    lines = [(CASH_METHODS[method], 'debit', amount)]
    if allocated:
        lines.append(('accounts_receivable', 'credit', allocated))
    if surplus:
        lines.append(('customer_advance', 'credit', surplus))
    await _post_journal(
        conn, source_type='payment', source_id=payment['id'], student_user_id=student_user_id,
        actor_user_id=actor_user_id, memo=receipt_purpose or 'Tuition payment',
        period=period_key(moment), lines=lines, occurred_at=moment)
    payment['allocations'] = [dict(row) for row in allocations]
    await payment_changed(conn,payment,allocations=allocations)
    return payment, [dict(row) for row in allocations], False


# Provider settlement. The proof is produced by a provider adapter that verified the
# vendor's own authentication; the ledger re-checks every financial semantic key against
# the pending intent, because a valid signature on a different order is still wrong.
PAID_PROOF_STATUSES = ('paid', 'success', 'completed')
INTENT_CLOSED_STATES = ('rejected', 'expired', 'cancelled')


def provider_proof(*, amount_minor, currency, status, order_ref=None, student_user_id=None):
    """Canonical settlement proof handed to the ledger by a provider adapter."""
    return {'amountMinor': _minor(amount_minor), 'currency': currency, 'status': status,
            'orderRef': order_ref, 'studentUserId': student_user_id}


@transactional
async def confirm_provider_payment(conn, *, provider, provider_transaction_id, proof,
                                   actor_user_id=None):
    """Settle a pending provider intent exactly once, on verified proof.

    Returns ``(payment_row, allocations, duplicate)``. A repeated callback resolves to the
    same row and writes nothing twice; a proof that disagrees with the intent about amount,
    currency, customer, order or status settles nothing.
    """
    from .prepaid_services import finance_lock,for_payment,payment_changed
    initial=await conn.fetchrow('SELECT * FROM tuition_payments WHERE provider=$1 AND provider_transaction_id=$2 LIMIT 1',provider,provider_transaction_id)
    _require(initial is not None,'provider_intent_not_found',404)
    await finance_lock(conn,initial['student_user_id'])
    if initial.get('service_policy_id'):await for_payment(conn,initial['service_policy_id'],initial['student_user_id'])
    payment = await conn.fetchrow(
        'SELECT * FROM tuition_payments WHERE provider=$1 AND provider_transaction_id=$2'
        ' LIMIT 1 FOR UPDATE', provider, provider_transaction_id)
    _require(payment is not None, 'provider_intent_not_found', 404)
    if payment['status'] in SETTLED_PAYMENT_STATES:
        return dict(payment), [], True
    _require(payment['status'] == 'pending_provider', 'intent_not_settleable', 409,
             status=payment['status'])
    _require(str(proof.get('status') or '').lower() in PAID_PROOF_STATUSES, 'proof_not_paid',
             409, status=proof.get('status'))
    _require(proof.get('amountMinor') == payment['amount_minor'], 'proof_amount_mismatch', 409,
             expectedMinor=payment['amount_minor'], proofMinor=proof.get('amountMinor'))
    _require((proof.get('currency') or payment['currency_code']) == payment['currency_code'],
             'proof_currency_mismatch', 409, expected=payment['currency_code'],
             proof=proof.get('currency'))
    if proof.get('studentUserId') is not None:
        _require(str(proof['studentUserId']) == str(payment['student_user_id']),
                 'proof_student_mismatch', 409)
    if proof.get('orderRef') is not None and payment['idempotency_key'] is not None:
        _require(str(proof['orderRef']) == str(payment['idempotency_key']),
                 'proof_order_mismatch', 409)
    moment = datetime.now(timezone.utc)
    await _assert_period_open(conn, period_key(moment))
    settled = await conn.fetchrow(
        "UPDATE tuition_payments SET status='confirmed', confirmed_at=$2"
        ' WHERE id=$1 RETURNING *', payment['id'], moment)
    allocations = await _allocate(conn, settled)
    allocated = sum(row['amount_minor'] for row in allocations)
    surplus = settled['amount_minor'] - allocated
    lines = [('provider_clearing', 'debit', settled['amount_minor'])]
    if allocated:
        lines.append(('accounts_receivable', 'credit', allocated))
    if surplus:
        lines.append(('customer_advance', 'credit', surplus))
    await _post_journal(
        conn, source_type='provider_payment', source_id=settled['id'],
        student_user_id=settled['student_user_id'], actor_user_id=actor_user_id,
        memo=f'{provider} settlement {provider_transaction_id}',
        period=period_key(settled['confirmed_at']), lines=lines,
        occurred_at=settled['confirmed_at'])
    # The money is real now, so anything that must happen outside this process is queued in
    # the same transaction. Delivery is a separate worker's job and is never reported as done
    # here: an unverified provider job must not look like a success.
    await _publish_outbox(conn, topic='provider.settled', aggregate_type='tuition_payment',
                          aggregate_id=settled['id'],
                          payload={'studentUserId': str(settled['student_user_id']),
                                   'amountMinor': settled['amount_minor'],
                                   'currency': settled['currency_code'], 'provider': provider,
                                   'providerTransactionId': provider_transaction_id,
                                   'settledAt': str(settled['confirmed_at'])})
    await _audit(conn, actor_user_id=actor_user_id, action='provider_payment_settled',
                 subject_type='tuition_payment', subject_id=settled['id'],
                 period=period_key(settled['confirmed_at']),
                 amount_minor=settled['amount_minor'],
                 detail={'provider': provider,
                         'providerTransactionId': provider_transaction_id})
    await payment_changed(conn,settled,allocations=allocations)
    return dict(settled), [dict(row) for row in allocations], False


@transactional
async def close_provider_intent(conn, *, provider, provider_transaction_id, to_status,
                                reason=None, actor_user_id=None):
    """Move an unsettled provider intent to rejected/expired/cancelled. Never settles it."""
    _require(to_status in INTENT_CLOSED_STATES, 'invalid_intent_state', to_status=to_status)
    payment = await conn.fetchrow(
        'SELECT * FROM tuition_payments WHERE provider=$1 AND provider_transaction_id=$2'
        ' LIMIT 1 FOR UPDATE', provider, provider_transaction_id)
    _require(payment is not None, 'provider_intent_not_found', 404)
    _require(payment['status'] == 'pending_provider', 'intent_not_settleable', 409,
             status=payment['status'])
    closed = await conn.fetchrow(
        'UPDATE tuition_payments SET status=$2 WHERE id=$1 RETURNING *', payment['id'], to_status)
    return dict(closed)


async def _allocate(conn, payment):
    """Apply payment to remaining posted obligations, oldest first.

    Locks serialize allocation with credit-note posting. A fresh balance query
    after acquiring the locks observes the latest committed credits and payments.
    """
    query="""SELECT id, student_user_id, net_amount_minor FROM tuition_charges
            WHERE student_user_id=$1 AND currency_code=$2 AND status='posted'
            {policy_filter} ORDER BY due_date, created_at, id FOR UPDATE"""
    policy_filter='AND service_policy_id=$3' if payment.get('service_policy_id') else ''
    parameters=[payment['student_user_id'],payment['currency_code']]
    if payment.get('service_policy_id'):parameters.append(payment['service_policy_id'])
    charges = await conn.fetch(query.format(policy_filter=policy_filter),*parameters)
    if not charges:
        return []
    open_rows = await conn.fetch(
        """SELECT c.id,
                  c.net_amount_minor
                    - (SELECT coalesce(sum(x.amount_minor),0)
                         FROM tuition_payment_allocations x WHERE x.charge_id=c.id)
                    - (SELECT coalesce(sum(n.amount_minor),0)
                         FROM tuition_credit_notes n
                        WHERE n.charge_id=c.id AND n.status='posted') AS open_minor
             FROM tuition_charges c WHERE c.id=ANY($1::uuid[])""",
        [charge['id'] for charge in charges])
    open_by_charge = {row['id']: max(int(row['open_minor']), 0) for row in open_rows}
    remaining = payment['amount_minor']
    written = []
    for charge in charges:
        if remaining <= 0:
            break
        if charge['student_user_id'] != payment['student_user_id']:
            raise LedgerError('cross_student_allocation', 403)
        take = min(remaining, open_by_charge[charge['id']])
        if take <= 0:
            continue
        written.append(await conn.fetchrow(
            """INSERT INTO tuition_payment_allocations(payment_id, charge_id, amount_minor)
               VALUES ($1,$2,$3) RETURNING *""", payment['id'], charge['id'], take))
        remaining -= take
    return written

async def _refund_available(conn, payment_id) -> tuple[int, int, int]:
    """(allocated, refunded_so_far, still_refundable) for one payment."""
    allocated = await conn.fetchval(
        'SELECT coalesce(sum(amount_minor),0) FROM tuition_payment_allocations'
        ' WHERE payment_id=$1', payment_id) or 0
    refunded = await conn.fetchval(
        'SELECT coalesce(sum(amount_minor),0) FROM tuition_refunds WHERE payment_id=$1'
        " AND status IN ('requested','approved','settled')", payment_id) or 0
    amount = await conn.fetchval('SELECT amount_minor FROM tuition_payments WHERE id=$1',
                                 payment_id)
    return int(allocated), int(refunded), int(amount) - allocated - refunded


@transactional
async def request_refund(conn, *, actor_user_id, payment_id, amount_minor, reason, method=None,
                         provider_refund_id=None):
    """Open a refund request. Money has not moved and the old cash day is not touched.

    FIN-08: a refund is a NEW outgoing payment dated today, in today's open period. It never
    reopens or rewrites the day the original receipt was taken, so a 45-day-old receipt can be
    refunded after that day was closed and the history still reconciles.
    """
    amount = _minor(amount_minor)
    _require(amount > 0, 'amount_must_be_positive')
    _require(bool(reason and reason.strip()), 'reason_required')
    payment = await conn.fetchrow('SELECT * FROM tuition_payments WHERE id=$1 FOR UPDATE', payment_id)
    _require(payment is not None, 'payment_not_found', 404)
    if provider_refund_id:
        existing = await conn.fetchrow(
            'SELECT * FROM tuition_refunds WHERE provider_refund_id=$1', provider_refund_id)
        if existing is not None:
            mismatched = [name for name, matches in (
                ('studentUserId', str(existing['student_user_id'])
                 == str(payment['student_user_id'])),
                ('amountMinor', int(existing['amount_minor']) == int(amount)),
                ('currency', existing['currency_code'] == payment['currency_code']),
                ('method', existing['method'] == (method or payment['method'])),
                ('paymentId', str(existing['payment_id']) == str(payment['id'])),
            ) if not matches]
            if mismatched:
                await _audit_refusal(actor_user_id=actor_user_id, action='idempotency_conflict',
                                     subject_type='tuition_refund', subject_id=existing['id'],
                                     amount_minor=amount,
                                     reason='replayed provider refund id with different'
                                            ' semantic keys',
                                     detail={'mismatched': mismatched,
                                             'providerRefundId': provider_refund_id})
                raise LedgerError('idempotency_conflict', 409, mismatched=mismatched,
                                  existingRefundId=str(existing['id']))
            return dict(existing), True
    _require(payment['status'] in ('confirmed', 'partially_refunded'), 'invalid_state', 409,
             status=payment['status'])
    moment = datetime.now(timezone.utc)
    _, _, available = await _refund_available(conn, payment_id)
    _require(amount <= available, 'refund_exceeds_available_funds', 409, availableMinor=available,
             requestedMinor=amount)
    row = await conn.fetchrow(
        'INSERT INTO tuition_refunds (payment_id, student_user_id, currency_code, amount_minor,'
        ' method, reason, authorized_by, provider_refund_id, provider_refund_state, status,'
        ' effective_on, effective_period) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)'
        ' RETURNING *',
        payment_id, payment['student_user_id'], payment['currency_code'], amount,
        method or payment['method'], reason.strip()[:200], actor_user_id, provider_refund_id,
        'internal', 'requested', business_date(moment), period_key(moment))
    await _audit(conn, actor_user_id=actor_user_id, action='refund_requested',
                 subject_type='tuition_refund', subject_id=row['id'],
                 period=period_key(moment), amount_minor=amount, reason=reason.strip()[:300],
                 detail={'paymentId': str(payment_id), 'effectiveOn': str(business_date(moment))})
    return dict(row), False


@transactional
async def approve_refund(conn, *, actor_user_id, refund_id):
    """Owner authorization. The requester cannot authorize their own refund."""
    row = await conn.fetchrow('SELECT * FROM tuition_refunds WHERE id=$1 FOR UPDATE', refund_id)
    _require(row is not None, 'refund_not_found', 404)
    _require(row['status'] == 'requested', 'invalid_state', 409, status=row['status'])
    _require(await _actor_role(conn, actor_user_id) == 'owner', 'approval_requires_owner', 403)
    _require(str(actor_user_id) != str(row['authorized_by']),
             'approver_must_differ_from_requester', 403)
    updated = await conn.fetchrow(
        "UPDATE tuition_refunds SET status='approved', approved_by=$2, approved_at=now()"
        ' WHERE id=$1 RETURNING *', refund_id, actor_user_id)
    await _audit(conn, actor_user_id=actor_user_id, action='refund_approved',
                 subject_type='tuition_refund', subject_id=refund_id,
                 amount_minor=updated['amount_minor'], reason=updated['reason'],
                 detail={'requestedBy': str(row['authorized_by'])})
    return dict(updated)


@transactional
async def settle_refund(conn, *, actor_user_id, refund_id):
    """Move the money, in the refund's OWN period, never in the original receipt's day.

    The only gate on timing is that TODAY is open: the historical day the receipt belongs to
    stays closed and unchanged.
    """
    from .prepaid_services import finance_lock,for_payment,payment_changed
    initial=await conn.fetchrow('SELECT * FROM tuition_refunds WHERE id=$1',refund_id)
    _require(initial is not None,'refund_not_found',404)
    await finance_lock(conn,initial['student_user_id'])
    original=await conn.fetchrow('SELECT * FROM tuition_payments WHERE id=$1',initial['payment_id'])
    if original.get('service_policy_id'):await for_payment(conn,original['service_policy_id'],initial['student_user_id'])
    row = await conn.fetchrow('SELECT * FROM tuition_refunds WHERE id=$1 FOR UPDATE', refund_id)
    _require(row is not None, 'refund_not_found', 404)
    # An already-settled refund says so plainly: "not approved" would send the cashier
    # looking for a missing signature when the money has in fact already left.
    _require(row['status'] != 'settled', 'refund_already_settled', 409,
             settledAt=str(row['settled_at']))
    _require(row['status'] == 'approved', 'refund_not_approved', 409, status=row['status'])
    moment = datetime.now(timezone.utc)
    effective_day = business_date(moment)
    effective_period = period_key(effective_day)
    await _assert_day_open(conn, effective_day)
    await _assert_period_open(conn, effective_period)
    payment = await conn.fetchrow(
        'SELECT amount_minor FROM tuition_payments WHERE id=$1 FOR UPDATE', row['payment_id'])
    allocated, _, available = await _refund_available(conn, row['payment_id'])
    _require(available >= 0, 'refund_exceeds_available_funds', 409)
    await _post_journal(
        conn, source_type='refund', source_id=row['id'],
        student_user_id=row['student_user_id'], actor_user_id=actor_user_id,
        memo=f'Refund {row["reason"][:120]}', period=effective_period, occurred_at=moment,
        lines=[('customer_advance', 'debit', row['amount_minor']),
               (CASH_METHODS[row['method']], 'credit', row['amount_minor'])])
    updated = await conn.fetchrow(
        "UPDATE tuition_refunds SET status='settled', settled_at=$2,"
        " effective_on=$3, effective_period=$4 WHERE id=$1 RETURNING *",
        refund_id, moment, effective_day, effective_period)
    await _audit(conn, actor_user_id=actor_user_id, action='refund_settled',
                 subject_type='tuition_refund', subject_id=refund_id,
                 period=effective_period, amount_minor=row['amount_minor'],
                 reason=row['reason'], detail={'method': row['method'],
                                               'effectiveOn': str(effective_day)})
    settled_total = await conn.fetchval(
        'SELECT coalesce(sum(amount_minor),0) FROM tuition_refunds'
        " WHERE payment_id=$1 AND status='settled'", row['payment_id']) or 0
    remaining_net = int(payment['amount_minor']) - int(settled_total)
    await conn.execute(
        'UPDATE tuition_payments SET status=$2 WHERE id=$1', row['payment_id'],
        'refunded' if remaining_net == 0 and allocated == 0 else 'partially_refunded')
    await payment_changed(conn,original,reason='refund',source=row['id'])
    return dict(updated)


@transactional
async def reject_refund(conn, *, actor_user_id, refund_id, reason):
    """Owner declines a request. No money moves and the request stays on the record."""
    _require(bool(reason and reason.strip()), 'reason_required')
    row = await conn.fetchrow('SELECT * FROM tuition_refunds WHERE id=$1 FOR UPDATE', refund_id)
    _require(row is not None, 'refund_not_found', 404)
    _require(row['status'] == 'requested', 'invalid_state', 409, status=row['status'])
    _require(await _actor_role(conn, actor_user_id) == 'owner', 'approval_requires_owner', 403)
    updated = await conn.fetchrow(
        "UPDATE tuition_refunds SET status='rejected', failure_reason=$2 WHERE id=$1 RETURNING *",
        refund_id, reason.strip()[:300])
    return dict(updated)


@transactional
async def fail_refund(conn, *, actor_user_id, refund_id, reason):
    """Record that an authorized refund could not be paid (e.g. the provider declined).

    Distinct from rejection and from settlement: the authorization stands, the money did not
    move, and the reason is kept so the next attempt is explainable.
    """
    _require(bool(reason and reason.strip()), 'reason_required')
    row = await conn.fetchrow('SELECT * FROM tuition_refunds WHERE id=$1 FOR UPDATE', refund_id)
    _require(row is not None, 'refund_not_found', 404)
    _require(row['status'] == 'approved', 'invalid_state', 409, status=row['status'])
    updated = await conn.fetchrow(
        "UPDATE tuition_refunds SET status='failed', failure_reason=$2 WHERE id=$1 RETURNING *",
        refund_id, reason.strip()[:300])
    return dict(updated)


@transactional
async def add_cash_adjustment(conn, *, actor_user_id, business_date, amount_minor, reason):
    """An approved intraday cash movement that is neither a receipt nor a refund."""
    amount = _minor(amount_minor)
    _require(amount != 0, 'amount_must_be_non_zero')
    _require(bool(reason and reason.strip()), 'reason_required')
    await _assert_day_open(conn, business_date)
    row = await conn.fetchrow(
        'INSERT INTO cash_day_adjustments (business_date, amount_minor, reason, requested_by,'
        ' approved_by, approved_at) VALUES ($1,$2,$3,$4,$4,now()) RETURNING *',
        business_date, amount, reason.strip()[:300], actor_user_id)
    await _audit(conn, actor_user_id=actor_user_id, action='cash_adjustment_added',
                 subject_type='cash_day_adjustment', subject_id=row['id'],
                 amount_minor=amount, reason=reason.strip()[:300],
                 detail={'businessDate': str(business_date)})
    return dict(row)


# ─────────────────────────── revenue recognition ───────────────────────────
@transactional
async def recognize_revenue(conn, *, actor_user_id, student_user_id, amount_minor, period=None,
                            memo=None):
    """Recognise earned tuition under the configured policy. Never automatic, never a
    side effect of collecting cash."""
    amount = _minor(amount_minor)
    _require(amount > 0, 'amount_must_be_positive')
    target_period = period or period_key(datetime.now(timezone.utc))
    await conn.execute("SELECT 1 FROM users WHERE id=$1 AND role='student' FOR NO KEY UPDATE",
                       student_user_id)
    await _student_exists(conn, student_user_id)
    await _lock_period(conn, target_period)
    await _assert_period_open(conn, target_period)
    deferred = await conn.fetchval(
        '''SELECT coalesce(sum(amount_minor) FILTER (WHERE direction='credit'),0)
                - coalesce(sum(amount_minor) FILTER (WHERE direction='debit'),0)
             FROM finance_journal_lines l
             JOIN finance_journal_entries e ON e.transaction_id = l.transaction_id
            WHERE l.account_id = (SELECT id FROM finance_accounts WHERE code='deferred_tuition_revenue')
              AND e.student_user_id = $1''', student_user_id) or 0
    _require(amount <= deferred, 'insufficient_deferred_revenue', 409, deferredMinor=deferred,
             requestedMinor=amount)
    document_id = uuid4()
    transaction_id = await _post_journal(
        conn, source_type='revenue_recognition', source_id=document_id,
        student_user_id=student_user_id, actor_user_id=actor_user_id,
        memo=memo or f'Tuition revenue recognised {target_period}', period=target_period,
        lines=[('deferred_tuition_revenue', 'debit', amount), ('tuition_revenue', 'credit', amount)])
    await _audit(conn, actor_user_id=actor_user_id, action='revenue_recognized',
                 subject_type='tuition_revenue', subject_id=document_id, period=target_period,
                 amount_minor=amount, detail={'studentUserId': student_user_id})
    return {'documentId': str(document_id), 'transactionId': str(transaction_id),
            'amountMinor': amount, 'periodKey': target_period}


# ─────────────────────────────── read models ───────────────────────────────
async def student_position(conn, student_user_id) -> dict:
    """The single authoritative receivable position, derived from source transactions.

    ``receivable = posted charges (net, reversals included) - applied allocations``
    ``balance_due = max(receivable, 0)`` and the surplus stays visible as an advance.
    """
    # One PostgreSQL statement gives every component the same MVCC snapshot.
    # Separate READ COMMITTED queries could straddle a settlement/refund commit,
    # and six network round trips held a scarce pool lease for every account read.
    row = await conn.fetchrow(
        f"""WITH charges AS MATERIALIZED (
            SELECT c.net_amount_minor,c.posted_at,c.due_date,
              (SELECT coalesce(sum(a.amount_minor),0) FROM tuition_payment_allocations a
                WHERE a.charge_id=c.id) AS applied,
              (SELECT coalesce(sum(n.amount_minor),0) FROM tuition_credit_notes n
                WHERE n.charge_id=c.id AND n.status='posted') AS relieved
            FROM tuition_charges c WHERE c.student_user_id=$1
        ) SELECT
            coalesce(sum(net_amount_minor) FILTER(WHERE {POSTED_EVENT}),0) AS charged,
            coalesce(sum(applied),0) AS allocated,
            (SELECT coalesce(sum(amount_minor),0) FROM tuition_credit_notes
              WHERE student_user_id=$1 AND status='posted') AS credited,
            (SELECT coalesce(sum(amount_minor),0) FROM tuition_payments
              WHERE student_user_id=$1 AND status=ANY($2::varchar[])) AS collected,
            (SELECT coalesce(sum(amount_minor),0) FROM tuition_refunds
              WHERE student_user_id=$1 AND status='settled') AS refunded,
            greatest(coalesce(sum(net_amount_minor-relieved-applied)
              FILTER(WHERE {POSTED_EVENT}
                AND due_date<(now() AT TIME ZONE 'Asia/Tashkent')::date),0),0) AS overdue
          FROM charges""", student_user_id, list(SETTLED_PAYMENT_STATES))
    charged, allocated, credited = row['charged'], row['allocated'], row['credited']
    collected, refunded, overdue = row['collected'], row['refunded'], row['overdue']
    receivable = charged - credited - allocated
    return {
        'studentUserId': str(student_user_id),
        'currency': CURRENCY,
        'chargedMinor': int(charged),
        'creditedMinor': int(credited),
        'allocatedMinor': int(allocated),
        'receivableMinor': int(receivable),
        'balanceDueMinor': int(max(receivable, 0)),
        'collectedMinor': int(collected),
        'refundedMinor': int(refunded),
        'advanceMinor': int(collected - allocated - refunded),
        'overdueMinor': int(overdue),
        'asOf': datetime.now(timezone.utc).isoformat(),
    }


async def student_statement(conn, student_user_id, limit: int = 100) -> dict:
    charges = await conn.fetch(
        '''SELECT id, contract_id, created_by, period_key, gross_amount_minor, discount_amount_minor, net_amount_minor,
                  status, is_reversal, original_charge_id, due_date, posted_at,
                  to_jsonb(tuition_charges)->>'service_policy_id' AS service_policy_id
             FROM tuition_charges WHERE student_user_id=$1
            ORDER BY due_date DESC, created_at DESC LIMIT $2''', student_user_id, limit)
    payments = await conn.fetch(
        '''SELECT p.id, p.amount_minor, p.method, p.provider, p.status, p.receipt_no,
                  p.occurred_at, coalesce(sum(a.amount_minor),0)::bigint AS allocated_minor
             FROM tuition_payments p
             LEFT JOIN tuition_payment_allocations a ON a.payment_id = p.id
            WHERE p.student_user_id=$1
            GROUP BY p.id ORDER BY p.occurred_at DESC LIMIT $2''', student_user_id, limit)
    refunds = await conn.fetch(
        '''SELECT id, payment_id, authorized_by, method, amount_minor, reason, status, provider_refund_state,
                  created_at, settled_at, effective_on
             FROM tuition_refunds WHERE student_user_id=$1 ORDER BY created_at DESC LIMIT $2''',
        student_user_id, limit)
    contracts = await conn.fetch(
        '''SELECT id, course_id, status, monthly_amount_minor, term_months, starts_on, ends_on,
                  to_jsonb(tuition_contracts)->>'service_policy_id' AS service_policy_id
             FROM tuition_contracts WHERE student_user_id=$1
            ORDER BY created_at DESC, id LIMIT $2''', student_user_id, limit)
    discounts = await conn.fetch(
        '''SELECT d.id, d.contract_id, d.period_key, d.amount_minor, d.reason
             FROM tuition_contract_discounts d JOIN tuition_contracts c ON c.id=d.contract_id
            WHERE c.student_user_id=$1 ORDER BY d.created_at DESC, d.id LIMIT $2''',
        student_user_id, limit)
    notes = await conn.fetch(
        '''SELECT id, charge_id, period_key, status, amount_minor, reason, requested_by
             FROM tuition_credit_notes WHERE student_user_id=$1
            ORDER BY created_at DESC, id LIMIT $2''', student_user_id, limit)
    return {
        'position': await student_position(conn, student_user_id),
        'contracts': [dict(row) for row in contracts],
        'discounts': [dict(row) for row in discounts],
        'creditNotes': [dict(row) for row in notes],
        'charges': [dict(row) for row in charges],
        'payments': [dict(row) for row in payments],
        'refunds': [dict(row) for row in refunds],
    }


#: FIN-10: the calendar the owner reads reports in. Storage stays UTC; only the day boundary
#: used to bucket a report moves, and it moves in exactly one place so every figure agrees.
REPORT_TIMEZONE = 'Asia/Tashkent'

#: What each reported figure actually means. Reported next to the numbers because "invoiced"
#: and "collected" and "recognized" are three different questions about three different dates.
SUMMARY_SEMANTICS = {
    'collectedCashMinor': 'settled cash receipts, by receipt date (Asia/Tashkent)',
    'collectedBankMinor': 'settled bank transfers, by receipt date (Asia/Tashkent)',
    'collectedProviderMinor': 'provider-settled money, by settlement date (Asia/Tashkent)',
    'collectedTotalMinor': 'sum of the three method totals, gross of refunds',
    'collectedNetMinor': 'collectedTotalMinor minus refunds settled in the same window',
    'refundsMinor': 'refunds SETTLED with an effective date in the window',
    'invoicedTuitionMinor': 'posted charges net of discount and relief, by DUE date',
    'creditedTuitionMinor': 'posted credit notes, by posting date (Asia/Tashkent)',
    'recognizedRevenueMinor': 'tuition revenue credited in the journal, by entry date',
    'providerFeesMinor': 'provider commission expensed, by entry date',
    'outstandingReceivableMinor': 'point-in-time balance, NOT windowed',
    'overdueReceivableMinor': 'point-in-time balance, NOT windowed',
    'customerAdvanceMinor': 'point-in-time balance, NOT windowed',
}


async def _collected_by_method(conn, start, end) -> dict[str, int]:
    rows = await conn.fetch(
        """SELECT method, coalesce(sum(amount_minor),0) AS total FROM tuition_payments
            WHERE status = ANY($3::varchar[])
              AND ((CASE WHEN method='provider' THEN confirmed_at ELSE occurred_at END)
                   AT TIME ZONE 'Asia/Tashkent')::date BETWEEN $1 AND $2
            GROUP BY method""", start, end, list(SETTLED_PAYMENT_STATES))
    return {row['method']: int(row['total']) for row in rows}


async def _journal_total(conn, account_code, direction, start, end) -> int:
    return await conn.fetchval(
        '''SELECT coalesce(sum(l.amount_minor),0) FROM finance_journal_lines l
             JOIN finance_journal_entries e ON e.transaction_id = l.transaction_id
            WHERE l.account_id = (SELECT id FROM finance_accounts WHERE code=$3)
              AND l.direction = $4
              AND (e.occurred_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN $1 AND $2''',
        start, end, account_code, direction) or 0


@transactional
async def record_provider_fee(conn, *, actor_user_id, amount_minor, provider=None, memo=None):
    """Expense a provider's commission against the money it cleared for us.

    A fee is an expense, not a collection: it must never appear in `collected*` and it must
    never reduce a student's payment. Posted as debit payment_fees_expense, credit
    provider_clearing, so the net of what the provider owes us stays visible.
    """
    amount = _minor(amount_minor)
    _require(amount > 0, 'amount_must_be_positive')
    moment = datetime.now(timezone.utc)
    await _assert_period_open(conn, period_key(moment))
    entry = await _post_journal(
        conn, source_type='provider_fee', source_id=uuid4(), actor_user_id=actor_user_id,
        memo=memo or (f'{provider} commission' if provider else 'Payment provider commission'),
        period=period_key(moment), occurred_at=moment,
        lines=[('payment_fees_expense', 'debit', amount),
               ('provider_clearing', 'credit', amount)])
    return {'transactionId': str(entry), 'amountMinor': amount, 'provider': provider}


async def receivable_aging(conn, *, as_of: date) -> dict:
    """Age each outstanding obligation by its current contractual due date."""
    rows = await conn.fetch(
        f"""SELECT bucket, sum(balance) AS amount FROM (
               SELECT CASE WHEN $1::date-c.due_date<=0 THEN 'current'
                           WHEN $1::date-c.due_date<=30 THEN 'days1To30'
                           WHEN $1::date-c.due_date<=60 THEN 'days31To60'
                           WHEN $1::date-c.due_date<=90 THEN 'days61To90'
                           ELSE 'over90' END AS bucket,
                      c.net_amount_minor-coalesce(a.allocated,0)-coalesce(n.credited,0) AS balance
                 FROM tuition_charges c
                 LEFT JOIN (SELECT charge_id,sum(amount_minor) AS allocated
                            FROM tuition_payment_allocations GROUP BY charge_id) a ON a.charge_id=c.id
                 LEFT JOIN (SELECT charge_id,sum(amount_minor) AS credited
                            FROM tuition_credit_notes WHERE status='posted' GROUP BY charge_id) n
                      ON n.charge_id=c.id
                WHERE c.{OPEN_DOCUMENT} AND c.posted_at IS NOT NULL AND NOT c.is_reversal
              ) balances WHERE balance>0 GROUP BY bucket""", as_of)
    totals = dict.fromkeys(('current', 'days1To30', 'days31To60', 'days61To90', 'over90'), 0)
    for row in rows:
        totals[row['bucket']] = int(row['amount'])
    return {'asOf': as_of.isoformat(), 'bucketsMinor': totals}


#: Owner dashboard metrics. These are DIFFERENT numbers and must never be conflated.
async def finance_summary(conn, *, start: date, end: date) -> dict:
    """Collection split by method, accrual, recognition and point-in-time balances.

    Date semantics are stated in `SUMMARY_SEMANTICS` and returned with the payload, because
    "how much did we invoice" (due date) and "how much did we collect" (receipt date) and
    "how much did we earn" (journal entry date) answer three different questions. Day
    boundaries follow Asia/Tashkent, which is the calendar the centre operates on.
    """
    by_method = await _collected_by_method(conn, start, end)
    collected_cash = by_method.get('cash', 0)
    collected_bank = by_method.get('bank', 0)
    collected_provider = by_method.get('provider', 0)
    collected_total = collected_cash + collected_bank + collected_provider
    # Net accrual in the window: a charge and its reversal cancel when both fall inside it,
    # and a reversal dated in a later window correctly moves the accrual there.
    invoiced = await conn.fetchval(
        f'''SELECT coalesce(sum(net_amount_minor),0) FROM tuition_charges
            WHERE {POSTED_EVENT} AND due_date BETWEEN $1 AND $2''', start, end) or 0
    recognized = await _journal_total(conn, 'tuition_revenue', 'credit', start, end)
    fees = await _journal_total(conn, 'payment_fees_expense', 'debit', start, end)
    # Only SETTLED refunds, matched by their effective date: a request that was refused or a
    # provider that declined the reversal never took cash out of the drawer.
    refunds = await conn.fetchval(
        "SELECT coalesce(sum(amount_minor),0) FROM tuition_refunds"
        " WHERE status='settled' AND effective_on BETWEEN $1 AND $2", start, end) or 0
    credited = await conn.fetchval(
        "SELECT coalesce(sum(amount_minor),0) FROM tuition_credit_notes"
        " WHERE status='posted' AND (posted_at AT TIME ZONE 'Asia/Tashkent')::date"
        ' BETWEEN $1 AND $2', start, end) or 0
    outstanding = await conn.fetchval(
        f'''SELECT coalesce(sum(balance),0) FROM (
             SELECT c.student_user_id,
                    sum(c.net_amount_minor - coalesce(n.credited,0))
                      - coalesce(sum(a.applied),0) AS balance
               FROM tuition_charges c
               LEFT JOIN (SELECT charge_id, sum(amount_minor) AS applied
                            FROM tuition_payment_allocations GROUP BY charge_id) a
                 ON a.charge_id = c.id
               LEFT JOIN (SELECT charge_id, sum(amount_minor) AS credited
                            FROM tuition_credit_notes WHERE status='posted'
                           GROUP BY charge_id) n
                 ON n.charge_id = c.id
              WHERE c.{POSTED_EVENT}
              GROUP BY c.student_user_id) t WHERE balance > 0''') or 0
    overdue = await conn.fetchval(
        f'''SELECT coalesce(sum(balance),0) FROM (
             SELECT c.student_user_id,
                    sum(c.net_amount_minor - coalesce(n.credited,0)
                        - coalesce(a.applied,0)) AS balance
               FROM tuition_charges c
               LEFT JOIN (SELECT charge_id, sum(amount_minor) AS applied
                            FROM tuition_payment_allocations GROUP BY charge_id) a
                 ON a.charge_id = c.id
               LEFT JOIN (SELECT charge_id, sum(amount_minor) AS credited
                            FROM tuition_credit_notes WHERE status='posted'
                           GROUP BY charge_id) n
                 ON n.charge_id = c.id
              WHERE c.{POSTED_EVENT} AND c.due_date < (now() AT TIME ZONE 'Asia/Tashkent')::date
              GROUP BY c.student_user_id) t WHERE balance > 0''') or 0
    advances = await conn.fetchval(
        '''SELECT coalesce(sum(balance),0) FROM (
             SELECT p.student_user_id, sum(p.amount_minor)
                    - coalesce(sum(a.applied),0) - coalesce(sum(r.refunded),0) AS balance
               FROM tuition_payments p
               LEFT JOIN (SELECT payment_id, sum(amount_minor) AS applied
                            FROM tuition_payment_allocations GROUP BY payment_id) a
                 ON a.payment_id = p.id
               LEFT JOIN (SELECT payment_id, sum(amount_minor) AS refunded
                            FROM tuition_refunds WHERE status='settled' GROUP BY payment_id) r
                 ON r.payment_id = p.id
              WHERE p.status = ANY($1::varchar[])
              GROUP BY p.student_user_id) t WHERE balance > 0''',
        list(SETTLED_PAYMENT_STATES)) or 0
    return {
        'currency': CURRENCY,
        'calendar': REPORT_TIMEZONE,
        'range': {'start': start.isoformat(), 'end': end.isoformat()},
        'semantics': SUMMARY_SEMANTICS,
        'collectedCashMinor': int(collected_cash),
        'collectedBankMinor': int(collected_bank),
        'collectedProviderMinor': int(collected_provider),
        'collectedTotalMinor': int(collected_total),
        'collectedNetMinor': int(collected_total - refunds),
        'invoicedTuitionMinor': int(invoiced),
        'creditedTuitionMinor': int(credited),
        'recognizedRevenueMinor': int(recognized),
        'providerFeesMinor': int(fees),
        'outstandingReceivableMinor': int(outstanding),
        'overdueReceivableMinor': int(overdue),
        'customerAdvanceMinor': int(advances),
        'refundsMinor': int(refunds),
        'asOf': datetime.now(timezone.utc).isoformat(),
    }


async def reconcile_summary(conn, *, start: date, end: date) -> dict:
    """Check every reported figure against an INDEPENDENT source.

    A dashboard that recomputes money from its own arithmetic can drift from the ledger and
    nobody notices. Each check below compares the operational table against the journal (or
    the other way round), so a figure that cannot be explained by both is reported as broken
    rather than displayed.
    """
    summary = await finance_summary(conn, start=start, end=end)
    checks = []

    def check(field, reported, independent, source):
        checks.append({'field': field, 'reported': int(reported),
                       'independent': int(independent), 'source': source,
                       'matches': int(reported) == int(independent)})

    for method, account in (('cash', 'cash_on_hand'), ('bank', 'bank_clearing'),
                            ('provider', 'provider_clearing')):
        field = f'collected{method.capitalize()}Minor'
        check(field, summary[field], await _journal_total(conn, account, 'debit', start, end),
              f'journal {account} debits')
    check('collectedTotalMinor', summary['collectedTotalMinor'],
          summary['collectedCashMinor'] + summary['collectedBankMinor']
          + summary['collectedProviderMinor'], 'sum of the method totals')
    check('refundsMinor', summary['refundsMinor'],
          await conn.fetchval(
              '''SELECT coalesce(sum(l.amount_minor),0) FROM finance_journal_lines l
                   JOIN finance_journal_entries e ON e.transaction_id = l.transaction_id
                  WHERE e.source_type='refund' AND l.direction='credit'
                    AND (e.occurred_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN $1 AND $2''',
              start, end) or 0,
          'journal refund credits')
    check('invoicedTuitionMinor', summary['invoicedTuitionMinor'],
          await conn.fetchval(
              '''SELECT coalesce(sum(net_amount_minor),0) FROM tuition_charges
                  WHERE posted_at IS NOT NULL AND due_date BETWEEN $1 AND $2''',
              start, end) or 0,
          'posted charge documents')
    check('creditedTuitionMinor', summary['creditedTuitionMinor'],
          await _journal_total(conn, 'scholarship_discounts', 'debit', start, end),
          'journal scholarship_discounts debits')
    check('recognizedRevenueMinor', summary['recognizedRevenueMinor'],
          await conn.fetchval(
              '''SELECT coalesce(sum(l.amount_minor),0) FROM finance_journal_lines l
                   JOIN finance_journal_entries e ON e.transaction_id = l.transaction_id
                  WHERE l.account_id=(SELECT id FROM finance_accounts
                                       WHERE code='tuition_revenue')
                    AND l.direction='credit'
                    AND (e.occurred_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN $1 AND $2''',
              start, end) or 0,
          'journal tuition_revenue credits')
    # Balances are point-in-time, so they reconcile against the sum of the per-student
    # positions the same screen can drill into - the same filters, not a parallel formula.
    # Every student who can hold a balance: one who was billed AND one who merely paid in
    # advance. Deriving the list from charges alone would make an unallocated payment
    # invisible to its own reconciliation.
    students = [row['student_user_id'] for row in await conn.fetch(
        'SELECT DISTINCT student_user_id FROM tuition_charges WHERE posted_at IS NOT NULL'
        ' UNION SELECT DISTINCT student_user_id FROM tuition_payments'
        ' WHERE status = ANY($1::varchar[])', list(SETTLED_PAYMENT_STATES))]
    positions = [await student_position(conn, sid) for sid in students]
    check('outstandingReceivableMinor', summary['outstandingReceivableMinor'],
          sum(p['balanceDueMinor'] for p in positions), 'sum of per-student balances')
    check('overdueReceivableMinor', summary['overdueReceivableMinor'],
          sum(p['overdueMinor'] for p in positions), 'sum of per-student overdue')
    check('customerAdvanceMinor', summary['customerAdvanceMinor'],
          sum(max(p['advanceMinor'], 0) for p in positions), 'sum of per-student advances')
    return {'ok': all(item['matches'] for item in checks), 'checks': checks,
            'calendar': REPORT_TIMEZONE,
            'range': {'start': start.isoformat(), 'end': end.isoformat()}}


# ─────────────────────────────── cash controls ───────────────────────────────
@transactional
async def close_day(conn, *, actor_user_id, business_date, counted_minor, reason=None,
                    opening_minor=0):
    """Lock a cash day: expected vs counted, variance with a reason, no later postings."""
    counted = _minor(counted_minor)
    opening = _minor(opening_minor)
    _require(counted >= 0, 'amount_must_be_non_negative')
    _require(opening >= 0, 'amount_must_be_non_negative')
    await _lock_cash_day(conn, business_date)
    already = await conn.fetchval('SELECT 1 FROM cash_day_closes WHERE business_date=$1', business_date)
    _require(not already, 'day_already_closed', 409)
    receipts = await conn.fetchval(
        '''SELECT coalesce(sum(amount_minor),0) FROM tuition_payments
            WHERE method='cash' AND status = ANY($2::varchar[])
              AND (occurred_at AT TIME ZONE 'Asia/Tashkent')::date = $1''',
        business_date, list(SETTLED_PAYMENT_STATES)) or 0
    # FIN-08: a day closes against what the drawer should hold, not against gross receipts.
    # Refunds are matched by THEIR effective date, so a refund of last month's receipt lands
    # in the day the cash actually left - and only settled ones count.
    refunds = await conn.fetchval(
        "SELECT coalesce(sum(amount_minor),0) FROM tuition_refunds"
        " WHERE method='cash' AND status='settled' AND effective_on = $1", business_date) or 0
    adjustments = await conn.fetchval(
        'SELECT coalesce(sum(amount_minor),0) FROM cash_day_adjustments'
        ' WHERE business_date=$1 AND approved_by IS NOT NULL', business_date) or 0
    expected = opening + receipts - refunds + adjustments
    row = await conn.fetchrow(
        '''INSERT INTO cash_day_closes
             (business_date, expected_minor, counted_minor, variance_minor, reason, closed_by,
              opening_minor, receipts_minor, refunds_minor, adjustments_minor)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *''',
        business_date, expected, counted, counted - expected, reason, actor_user_id,
        opening, receipts, refunds, adjustments)
    await _audit(conn, actor_user_id=actor_user_id, action='day_closed',
                 subject_type='cash_day_close', subject_id=None,
                 period=period_key(business_date), amount_minor=expected, reason=reason,
                 detail={'countedMinor': counted, 'openingMinor': opening,
                         'receiptsMinor': receipts, 'refundsMinor': refunds,
                         'adjustmentsMinor': adjustments,
                         'varianceMinor': counted - expected})
    return dict(row)


@transactional
async def close_period(conn, *, actor_user_id, period, reason=None):
    await _lock_period(conn, period, closing=True)
    already = await conn.fetchval('SELECT 1 FROM finance_closed_periods WHERE period_key=$1', period)
    _require(not already, 'period_already_closed', 409)
    row = await conn.fetchrow(
        'INSERT INTO finance_closed_periods(period_key, closed_by, reason) VALUES ($1,$2,$3) RETURNING *',
        period, actor_user_id, reason)
    await _audit(conn, actor_user_id=actor_user_id, action='period_closed',
                 subject_type='finance_closed_period', subject_id=None, period=period,
                 reason=reason)
    return dict(row)


async def journal_is_balanced(conn) -> dict:
    """Reconciliation receipt: every journal transaction balances, within each currency.

    Three things that a mixed-currency sum would hide are reported explicitly, because
    "the totals matched" is not evidence that anything was recorded correctly:

    * a transaction whose debits and credits only agree once different currencies are added
      together;
    * an entry with no lines at all - a posted document that recorded nothing;
    * a line whose ``transaction_id`` does not match the entry it hangs off, so it is not part
      of any reconcilable group.
    """
    rows = await conn.fetch(
        '''SELECT e.id AS entry_id, e.transaction_id AS entry_txn, l.transaction_id AS line_txn,
                  l.currency_code, l.direction, l.amount_minor
             FROM finance_journal_entries e
             LEFT JOIN finance_journal_lines l ON l.entry_id = e.id''')
    totals: dict = {}
    detail = []
    seen = set()
    for row in rows:
        if row['entry_id'] in seen:
            pass
        seen.add(row['entry_id'])
        if row['line_txn'] is None:
            detail.append({'transactionId': str(row['entry_txn']), 'currency': None,
                           'reason': 'no_lines'})
            continue
        if row['line_txn'] != row['entry_txn']:
            detail.append({'transactionId': str(row['entry_txn']), 'currency': None,
                           'reason': 'line_transaction_mismatch'})
            continue
        bucket = totals.setdefault((row['entry_txn'], row['currency_code']),
                                   {'debit': 0, 'credit': 0})
        bucket[row['direction']] += int(row['amount_minor'])
    unbalanced = []
    for (transaction_id, currency), sides in sorted(totals.items(), key=str):
        if sides['debit'] != sides['credit']:
            unbalanced.append(str(transaction_id))
            detail.append({'transactionId': str(transaction_id), 'currency': currency,
                           'reason': 'currency_not_balanced', 'debits': sides['debit'],
                           'credits': sides['credit']})
    # A transaction can also be unbalanced because one currency balances and another does
    # not; report the transaction once per offending currency, and list it once overall.
    unbalanced = sorted(set(unbalanced) | {item['transactionId'] for item in detail})
    return {'transactions': len({txn for txn, _ in totals} | {row['entry_txn'] for row in rows}),
            'currencies': sorted({currency for _, currency in totals}),
            'unbalanced': unbalanced, 'balanced': not unbalanced and not detail,
            'detail': detail}


async def _publish_outbox(conn, *, topic, aggregate_type, aggregate_id=None, payload=None):
    """Queue an external side effect in the SAME transaction as the money it describes.

    A provider settlement that has to notify a parent, update a projection or reconcile with
    the vendor is published here rather than fired from the request handler: if the money
    commits the event exists, and if it rolls back the event never existed. Delivery is a
    separate concern and must never be reported as done from inside this call.
    """
    await conn.execute(
        'INSERT INTO finance_outbox_events (topic, aggregate_type, aggregate_id, payload)'
        ' VALUES ($1,$2,$3,$4::jsonb)', topic, aggregate_type, aggregate_id,
        json.dumps(payload or {}, sort_keys=True, default=str))
