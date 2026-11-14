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

from datetime import date, datetime, timezone
from functools import wraps
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
)

CONTRACT_STATES = ('draft', 'approved', 'active', 'completed', 'cancelled')
CHARGE_STATES = ('draft', 'approved', 'posted', 'reversed', 'credited')
PAYMENT_STATES = ('initiated', 'pending_provider', 'confirmed', 'rejected', 'expired',
                  'cancelled', 'partially_refunded', 'refunded')
SETTLED_PAYMENT_STATES = ('confirmed', 'partially_refunded', 'refunded')
CASH_METHODS = {'cash': 'cash_on_hand', 'bank': 'bank_clearing', 'provider': 'bank_clearing'}


class LedgerError(Exception):
    """A domain rule refused the command. `code` is stable and safe to return to a client."""

    def __init__(self, code: str, http_status: int = 400, **details):
        super().__init__(code)
        self.code = code
        self.status = http_status
        self.details = details


def period_key(value: date | datetime | str) -> str:
    """`YYYY-MM` in UTC. Presentation converts to Asia/Tashkent; storage never does."""
    if isinstance(value, str):
        value = date.fromisoformat(value[:10])
    return f'{value.year:04d}-{value.month:02d}'


def _require(condition: bool, code: str, http_status: int = 400, **details):
    if not condition:
        raise LedgerError(code, http_status, **details)


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


async def _assert_period_open(conn, period: str):
    closed = await conn.fetchval('SELECT 1 FROM finance_closed_periods WHERE period_key=$1', period)
    _require(not closed, 'period_closed', 409, periodKey=period)


async def _assert_day_open(conn, business_date: date):
    closed = await conn.fetchval('SELECT 1 FROM cash_day_closes WHERE business_date=$1', business_date)
    _require(not closed, 'day_closed', 409, businessDate=business_date.isoformat())


async def _student_exists(conn, student_user_id) -> None:
    found = await conn.fetchval("SELECT 1 FROM users WHERE id=$1 AND role='student'", student_user_id)
    _require(bool(found), 'student_not_found', 404)


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
    _student_exists_ok = await conn.fetchval('SELECT 1 FROM users WHERE id=$1', student_user_id)
    _require(bool(_student_exists_ok), 'student_not_found', 404)
    amount = _minor(monthly_amount_minor)
    _require(amount >= 0, 'amount_must_be_non_negative')
    _require(isinstance(term_months, int) and 1 <= term_months <= 120, 'invalid_term')
    row = await conn.fetchrow(
        '''INSERT INTO tuition_contracts
             (student_user_id, course_id, monthly_amount_minor, currency_code, term_months,
              starts_on, ends_on, note, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *''',
        student_user_id, course_id, amount, CURRENCY, term_months, starts_on, ends_on, note,
        actor_user_id)
    return dict(row)


@transactional
async def approve_contract(conn, *, actor_user_id, contract_id):
    row = await conn.fetchrow('SELECT * FROM tuition_contracts WHERE id=$1 FOR UPDATE', contract_id)
    _require(row is not None, 'contract_not_found', 404)
    _require(row['status'] == 'draft', 'invalid_state', 409, status=row['status'])
    updated = await conn.fetchrow(
        '''UPDATE tuition_contracts SET status='approved', approved_by=$2, approved_at=now(),
             updated_at=now() WHERE id=$1 RETURNING *''', contract_id, actor_user_id)
    return dict(updated)


@transactional
async def activate_contract(conn, *, actor_user_id, contract_id):
    row = await conn.fetchrow('SELECT * FROM tuition_contracts WHERE id=$1 FOR UPDATE', contract_id)
    _require(row is not None, 'contract_not_found', 404)
    _require(row['status'] in ('approved', 'active'), 'invalid_state', 409, status=row['status'])
    updated = await conn.fetchrow(
        "UPDATE tuition_contracts SET status='active', updated_at=now() WHERE id=$1 RETURNING *",
        contract_id)
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
    try:
        row = await conn.fetchrow(
            '''INSERT INTO tuition_contract_discounts
                 (contract_id, period_key, amount_minor, reason, approved_by)
               VALUES ($1,$2,$3,$4,$5) RETURNING *''',
            contract_id, period, amount, reason.strip()[:200], actor_user_id)
    except Exception as exc:  # UNIQUE (contract_id, period_key)
        if getattr(exc, 'sqlstate', None) == '23505':
            raise LedgerError('discount_already_approved_for_period', 409, periodKey=period) from exc
        raise
    return dict(row)


# ─────────────────────────────── charges ───────────────────────────────
@transactional
async def create_charge(conn, *, actor_user_id, student_user_id, period, due_date,
                        gross_amount_minor, contract_id=None):
    """Draft a receivable. An approved discount document reduces it exactly once."""
    gross = _minor(gross_amount_minor)
    _require(gross >= 0, 'amount_must_be_non_negative')
    discount = 0
    if contract_id is not None:
        contract = await conn.fetchrow('SELECT * FROM tuition_contracts WHERE id=$1', contract_id)
        _require(contract is not None, 'contract_not_found', 404)
        _require(contract['student_user_id'] == student_user_id, 'contract_student_mismatch', 403)
        _require(contract['status'] in ('approved', 'active'), 'invalid_state', 409,
                 status=contract['status'])
        discount = await conn.fetchval(
            'SELECT coalesce(sum(amount_minor),0) FROM tuition_contract_discounts'
            ' WHERE contract_id=$1 AND period_key=$2', contract_id, period) or 0
    _require(gross - discount >= 0, 'discount_exceeds_fee')
    row = await conn.fetchrow(
        '''INSERT INTO tuition_charges
             (contract_id, student_user_id, period_key, currency_code, gross_amount_minor,
              discount_amount_minor, net_amount_minor, due_date, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *''',
        contract_id, student_user_id, period, CURRENCY, gross, discount, gross - discount, due_date,
        actor_user_id)
    return dict(row)


@transactional
async def post_charge(conn, *, actor_user_id, charge_id):
    """Post the receivable: debit A/R, credit deferred tuition revenue (net presentation)."""
    charge = await conn.fetchrow('SELECT * FROM tuition_charges WHERE id=$1 FOR UPDATE', charge_id)
    _require(charge is not None, 'charge_not_found', 404)
    _require(not charge['is_reversal'], 'reversal_charge_cannot_be_posted')
    _require(charge['status'] in ('draft', 'approved'), 'invalid_state', 409,
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
        "UPDATE tuition_charges SET status='posted', posted_at=now(), posted_by=$2"
        ' WHERE id=$1 RETURNING *', charge_id, actor_user_id)
    return dict(updated)


@transactional
async def reverse_charge(conn, *, actor_user_id, charge_id, reason):
    """Correct a posted charge with a NEW reversing document; the original is never edited."""
    _require(bool(reason and reason.strip()), 'reason_required')
    charge = await conn.fetchrow('SELECT * FROM tuition_charges WHERE id=$1 FOR UPDATE', charge_id)
    _require(charge is not None, 'charge_not_found', 404)
    _require(charge['status'] == 'posted', 'invalid_state', 409, status=charge['status'])
    _require(not charge['is_reversal'], 'reversal_cannot_be_reversed')
    applied = await conn.fetchval(
        'SELECT coalesce(sum(amount_minor),0) FROM tuition_payment_allocations WHERE charge_id=$1',
        charge_id) or 0
    _require(applied == 0, 'charge_has_allocations', 409, appliedMinor=applied)
    today = datetime.now(timezone.utc).date()
    reversing = await conn.fetchrow(
        '''INSERT INTO tuition_charges
             (contract_id, student_user_id, period_key, currency_code, gross_amount_minor,
              discount_amount_minor, net_amount_minor, status, is_reversal, original_charge_id,
              reversal_reason, due_date, posted_at, posted_by, created_by)
           VALUES ($1,$2,$3,$4,$5,0,$6,'posted',true,$7,$8,$9,now(),$10,$10) RETURNING *''',
        charge['contract_id'], charge['student_user_id'], period_key(today), CURRENCY,
        -charge['net_amount_minor'], -charge['net_amount_minor'], charge['id'],
        reason.strip()[:200], today, actor_user_id)
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
                         receipt_purpose=None, payer_name=None, occurred_at=None, confirm=True):
    """Record money in, allocate it to open charges and write the balanced journal.

    Returns ``(payment_row, allocations, duplicate)``. A repeated provider callback or a
    retried browser submit resolves to the SAME payment row and writes nothing twice.

    Must be called inside an open transaction: payment, allocations and journal lines are
    one atomic unit, and the duplicate-callback recovery relies on a savepoint.
    """
    amount = _minor(amount_minor)
    _require(amount > 0, 'amount_must_be_positive')
    _require(method in CASH_METHODS, 'unknown_method', method=method)
    _require(provider is None or provider_transaction_id, 'provider_transaction_id_required')
    _student_exists_ok = await conn.fetchval('SELECT 1 FROM users WHERE id=$1', student_user_id)
    _require(bool(_student_exists_ok), 'student_not_found', 404)
    moment = occurred_at or datetime.now(timezone.utc)
    if isinstance(moment, str):
        moment = datetime.fromisoformat(moment)
    await _assert_day_open(conn, moment.date())
    await _assert_period_open(conn, period_key(moment))

    # Lock any existing row first so two concurrent callbacks serialise instead of both
    # trying to insert and one losing to the unique index mid-flight.
    existing = await conn.fetchrow(
        '''SELECT * FROM tuition_payments
           WHERE ($1::varchar IS NOT NULL AND idempotency_key = $1)
              OR ($2::varchar IS NOT NULL AND provider = $2 AND provider_transaction_id = $3)
           LIMIT 1 FOR UPDATE''', idempotency_key, provider, provider_transaction_id)
    if existing is not None:
        return dict(existing), [], True

    payment = None
    try:
        # A savepoint, not a new transaction: the caller owns the atomic unit. Two
        # concurrent identical callbacks race on the unique index; the loser rolls back to
        # the savepoint and reports the winner instead of raising a duplicate error.
        async with conn.transaction():
            payment = await conn.fetchrow(
                '''INSERT INTO tuition_payments
                     (student_user_id, currency_code, amount_minor, method, provider,
                      provider_transaction_id, idempotency_key, status, receipt_purpose,
                      operator_user_id, payer_name, occurred_at, confirmed_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,
                           CASE WHEN $8::varchar = 'confirmed' THEN $12::timestamptz END)
                   RETURNING *''',
                student_user_id, CURRENCY, amount, method, provider, provider_transaction_id,
                idempotency_key, 'confirmed' if confirm else 'pending_provider', receipt_purpose,
                actor_user_id, payer_name, moment)
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
        return dict(winner), [], True

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
    return payment, [dict(row) for row in allocations], False


async def _allocate(conn, payment):
    """Apply a confirmed payment to this student's open charges, oldest due date first."""
    rows = await conn.fetch(
        '''SELECT c.id, c.student_user_id, c.net_amount_minor,
                  c.net_amount_minor - a.applied AS open_minor
             FROM tuition_charges c
             JOIN LATERAL (SELECT coalesce(sum(x.amount_minor),0) AS applied
                             FROM tuition_payment_allocations x WHERE x.charge_id = c.id) a ON true
            WHERE c.student_user_id = $1 AND c.currency_code = $2 AND c.status = 'posted'
              AND c.net_amount_minor - a.applied > 0
            ORDER BY c.due_date, c.created_at, c.id
            FOR UPDATE OF c''', payment['student_user_id'], payment['currency_code'])
    remaining = payment['amount_minor']
    written = []
    for row in rows:
        if remaining <= 0:
            break
        # Object-level guard: an allocation may never cross student boundaries, even if a
        # caller hands us a charge id that belongs to somebody else.
        if row['student_user_id'] != payment['student_user_id']:
            raise LedgerError('cross_student_allocation', 403)
        take = min(remaining, row['open_minor'])
        written.append(await conn.fetchrow(
            '''INSERT INTO tuition_payment_allocations(payment_id, charge_id, amount_minor)
               VALUES ($1,$2,$3) RETURNING *''', payment['id'], row['id'], take))
        remaining -= take
    return written


@transactional
async def refund_payment(conn, *, actor_user_id, payment_id, amount_minor, reason, method=None,
                         provider_refund_id=None, provider_refund_state='internal'):
    """Refund unallocated (advance) funds with an authorised reversal document.

    Refunds are limited to money that is still unallocated. Refunding an amount that is
    already applied to a charge requires reversing that charge first, which is a documented
    correction rather than an automatic side effect here.
    """
    amount = _minor(amount_minor)
    _require(amount > 0, 'amount_must_be_positive')
    _require(bool(reason and reason.strip()), 'reason_required')
    payment = await conn.fetchrow('SELECT * FROM tuition_payments WHERE id=$1 FOR UPDATE', payment_id)
    _require(payment is not None, 'payment_not_found', 404)
    _require(payment['status'] in ('confirmed', 'partially_refunded'), 'invalid_state', 409,
             status=payment['status'])
    if provider_refund_id:
        existing = await conn.fetchrow(
            'SELECT * FROM tuition_refunds WHERE provider_refund_id=$1', provider_refund_id)
        if existing is not None:
            return dict(existing), True
    await _assert_day_open(conn, payment['occurred_at'].date())
    allocated = await conn.fetchval(
        '''SELECT coalesce(sum(a.amount_minor),0) FROM tuition_payment_allocations a
           WHERE a.payment_id=$1''', payment_id) or 0
    refunded = await conn.fetchval(
        'SELECT coalesce(sum(amount_minor),0) FROM tuition_refunds WHERE payment_id=$1',
        payment_id) or 0
    available = payment['amount_minor'] - allocated - refunded
    _require(amount <= available, 'refund_exceeds_available_funds', 409,
             availableMinor=available, requestedMinor=amount)
    refund = await conn.fetchrow(
        '''INSERT INTO tuition_refunds
             (payment_id, student_user_id, currency_code, amount_minor, method, reason,
              authorized_by, provider_refund_id, provider_refund_state)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *''',
        payment_id, payment['student_user_id'], payment['currency_code'], amount,
        method or payment['method'], reason.strip()[:200], actor_user_id, provider_refund_id,
        provider_refund_state)
    await _post_journal(
        conn, source_type='refund', source_id=refund['id'],
        student_user_id=payment['student_user_id'], actor_user_id=actor_user_id,
        memo=f'Refund {reason.strip()[:120]}', period=period_key(refund['created_at']),
        lines=[('customer_advance', 'debit', amount),
               (CASH_METHODS[payment['method']], 'credit', amount)])
    remaining_advance = available - amount
    await conn.execute(
        'UPDATE tuition_payments SET status=$2 WHERE id=$1', payment_id,
        'refunded' if remaining_advance == 0 and allocated == 0 else 'partially_refunded')
    return dict(refund), False


# ─────────────────────────── revenue recognition ───────────────────────────
@transactional
async def recognize_revenue(conn, *, actor_user_id, student_user_id, amount_minor, period=None,
                            memo=None):
    """Recognise earned tuition under the configured policy. Never automatic, never a
    side effect of collecting cash."""
    amount = _minor(amount_minor)
    _require(amount > 0, 'amount_must_be_positive')
    target_period = period or period_key(datetime.now(timezone.utc))
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
    return {'documentId': str(document_id), 'transactionId': str(transaction_id),
            'amountMinor': amount, 'periodKey': target_period}


# ─────────────────────────────── read models ───────────────────────────────
async def student_position(conn, student_user_id) -> dict:
    """The single authoritative receivable position, derived from source transactions.

    ``receivable = posted charges (net, reversals included) - applied allocations``
    ``balance_due = max(receivable, 0)`` and the surplus stays visible as an advance.
    """
    charged = await conn.fetchval(
        "SELECT coalesce(sum(net_amount_minor),0) FROM tuition_charges"
        " WHERE student_user_id=$1 AND status='posted'", student_user_id) or 0
    # LATERAL, not a grouped join over the whole allocations table: a per-student read must
    # touch this student's rows only, or it degrades linearly with total centre history.
    allocated = await conn.fetchval(
        '''SELECT coalesce(sum(a.applied),0) FROM tuition_charges c
             JOIN LATERAL (SELECT sum(x.amount_minor) AS applied
                             FROM tuition_payment_allocations x WHERE x.charge_id = c.id) a ON true
            WHERE c.student_user_id=$1''', student_user_id) or 0
    collected = await conn.fetchval(
        '''SELECT coalesce(sum(amount_minor),0) FROM tuition_payments
            WHERE student_user_id=$1 AND status = ANY($2::varchar[])''',
        student_user_id, list(SETTLED_PAYMENT_STATES)) or 0
    refunded = await conn.fetchval(
        'SELECT coalesce(sum(amount_minor),0) FROM tuition_refunds WHERE student_user_id=$1',
        student_user_id) or 0
    overdue = await conn.fetchval(
        '''SELECT coalesce(sum(c.net_amount_minor - coalesce(a.applied,0)),0)
             FROM tuition_charges c
             JOIN LATERAL (SELECT coalesce(sum(x.amount_minor),0) AS applied
                             FROM tuition_payment_allocations x WHERE x.charge_id = c.id) a ON true
            WHERE c.student_user_id=$1 AND c.status='posted' AND c.due_date < CURRENT_DATE
              AND c.net_amount_minor - a.applied > 0''', student_user_id) or 0
    receivable = charged - allocated
    return {
        'studentUserId': str(student_user_id),
        'currency': CURRENCY,
        'chargedMinor': int(charged),
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
        '''SELECT id, period_key, gross_amount_minor, discount_amount_minor, net_amount_minor,
                  status, is_reversal, original_charge_id, due_date, posted_at
             FROM tuition_charges WHERE student_user_id=$1
            ORDER BY due_date DESC, created_at DESC LIMIT $2''', student_user_id, limit)
    payments = await conn.fetch(
        '''SELECT p.id, p.amount_minor, p.method, p.provider, p.status, p.receipt_no,
                  p.occurred_at, coalesce(sum(a.amount_minor),0) AS allocated_minor
             FROM tuition_payments p
             LEFT JOIN tuition_payment_allocations a ON a.payment_id = p.id
            WHERE p.student_user_id=$1
            GROUP BY p.id ORDER BY p.occurred_at DESC LIMIT $2''', student_user_id, limit)
    refunds = await conn.fetch(
        '''SELECT id, amount_minor, reason, provider_refund_state, created_at
             FROM tuition_refunds WHERE student_user_id=$1 ORDER BY created_at DESC LIMIT $2''',
        student_user_id, limit)
    return {
        'position': await student_position(conn, student_user_id),
        'charges': [dict(row) for row in charges],
        'payments': [dict(row) for row in payments],
        'refunds': [dict(row) for row in refunds],
    }


#: Owner dashboard metrics. These are DIFFERENT numbers and must never be conflated.
async def finance_summary(conn, *, start: date, end: date) -> dict:
    collected = await conn.fetchval(
        '''SELECT coalesce(sum(amount_minor),0) FROM tuition_payments
            WHERE status = ANY($3::varchar[]) AND occurred_at::date BETWEEN $1 AND $2''',
        start, end, list(SETTLED_PAYMENT_STATES)) or 0
    invoiced = await conn.fetchval(
        '''SELECT coalesce(sum(net_amount_minor),0) FROM tuition_charges
            WHERE status='posted' AND NOT is_reversal AND due_date BETWEEN $1 AND $2''',
        start, end) or 0
    recognized = await conn.fetchval(
        '''SELECT coalesce(sum(amount_minor),0) FROM finance_journal_lines l
             JOIN finance_journal_entries e ON e.transaction_id = l.transaction_id
            WHERE l.account_id = (SELECT id FROM finance_accounts WHERE code='tuition_revenue')
              AND l.direction='credit' AND e.occurred_at::date BETWEEN $1 AND $2''',
        start, end) or 0
    refunds = await conn.fetchval(
        'SELECT coalesce(sum(amount_minor),0) FROM tuition_refunds WHERE created_at::date BETWEEN $1 AND $2',
        start, end) or 0
    outstanding = await conn.fetchval(
        '''SELECT coalesce(sum(balance),0) FROM (
             SELECT c.student_user_id,
                    sum(c.net_amount_minor) - coalesce(sum(a.applied),0) AS balance
               FROM tuition_charges c
               LEFT JOIN (SELECT charge_id, sum(amount_minor) AS applied
                            FROM tuition_payment_allocations GROUP BY charge_id) a
                 ON a.charge_id = c.id
              WHERE c.status='posted'
              GROUP BY c.student_user_id) t WHERE balance > 0''') or 0
    overdue = await conn.fetchval(
        '''SELECT coalesce(sum(c.net_amount_minor - coalesce(a.applied,0)),0)
             FROM tuition_charges c
             LEFT JOIN (SELECT charge_id, sum(amount_minor) AS applied
                          FROM tuition_payment_allocations GROUP BY charge_id) a
               ON a.charge_id = c.id
            WHERE c.status='posted' AND c.due_date < CURRENT_DATE
              AND c.net_amount_minor - coalesce(a.applied,0) > 0''') or 0
    advances = await conn.fetchval(
        '''SELECT coalesce(sum(balance),0) FROM (
             SELECT p.student_user_id, sum(p.amount_minor)
                    - coalesce(sum(a.applied),0) - coalesce(sum(r.refunded),0) AS balance
               FROM tuition_payments p
               LEFT JOIN (SELECT payment_id, sum(amount_minor) AS applied
                            FROM tuition_payment_allocations GROUP BY payment_id) a
                 ON a.payment_id = p.id
               LEFT JOIN (SELECT payment_id, sum(amount_minor) AS refunded
                            FROM tuition_refunds GROUP BY payment_id) r
                 ON r.payment_id = p.id
              WHERE p.status = ANY($1::varchar[])
              GROUP BY p.student_user_id) t WHERE balance > 0''',
        list(SETTLED_PAYMENT_STATES)) or 0
    return {
        'currency': CURRENCY,
        'range': {'start': start.isoformat(), 'end': end.isoformat()},
        'collectedCashMinor': int(collected),
        'invoicedTuitionMinor': int(invoiced),
        'recognizedRevenueMinor': int(recognized),
        'outstandingReceivableMinor': int(outstanding),
        'overdueReceivableMinor': int(overdue),
        'customerAdvanceMinor': int(advances),
        'refundsMinor': int(refunds),
        'asOf': datetime.now(timezone.utc).isoformat(),
    }


# ─────────────────────────────── cash controls ───────────────────────────────
@transactional
async def close_day(conn, *, actor_user_id, business_date, counted_minor, reason=None):
    """Lock a cash day: expected vs counted, variance with a reason, no later postings."""
    counted = _minor(counted_minor)
    _require(counted >= 0, 'amount_must_be_non_negative')
    expected = await conn.fetchval(
        '''SELECT coalesce(sum(amount_minor),0) FROM tuition_payments
            WHERE method='cash' AND status = ANY($2::varchar[]) AND occurred_at::date = $1''',
        business_date, list(SETTLED_PAYMENT_STATES)) or 0
    already = await conn.fetchval('SELECT 1 FROM cash_day_closes WHERE business_date=$1', business_date)
    _require(not already, 'day_already_closed', 409)
    row = await conn.fetchrow(
        '''INSERT INTO cash_day_closes
             (business_date, expected_minor, counted_minor, variance_minor, reason, closed_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *''',
        business_date, expected, counted, counted - expected, reason, actor_user_id)
    return dict(row)


@transactional
async def close_period(conn, *, actor_user_id, period, reason=None):
    already = await conn.fetchval('SELECT 1 FROM finance_closed_periods WHERE period_key=$1', period)
    _require(not already, 'period_already_closed', 409)
    row = await conn.fetchrow(
        'INSERT INTO finance_closed_periods(period_key, closed_by, reason) VALUES ($1,$2,$3) RETURNING *',
        period, actor_user_id, reason)
    return dict(row)


async def journal_is_balanced(conn) -> dict:
    """Reconciliation receipt: every journal transaction balances, across all history."""
    rows = await conn.fetch(
        '''SELECT transaction_id,
                  sum(amount_minor) FILTER (WHERE direction='debit')  AS debits,
                  sum(amount_minor) FILTER (WHERE direction='credit') AS credits
             FROM finance_journal_lines GROUP BY transaction_id''')
    unbalanced = [str(row['transaction_id']) for row in rows
                  if row['debits'] != row['credits']]
    return {'transactions': len(rows), 'unbalanced': unbalanced, 'balanced': not unbalanced}
