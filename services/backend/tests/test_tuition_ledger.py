"""Tuition subledger invariants, exercised against a disposable local PostgreSQL.

These are the money rules from the delivery brief turned into executable proof: the four
worked examples (A–D), the ledger invariants, duplicate-callback idempotency, a real
concurrency race and the cash controls. No production database and no real student data
is touched; every fixture identity is a generated UUID in a throwaway schema.
"""
from __future__ import annotations

import asyncio
import os
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio

from _finance_schema import apply_finance_migrations, create_disposable_schema
from app import tuition_ledger as ledger
from app.tuition_ledger import LedgerError

DSN = "postgresql://coin_qa:coin_qa_local@127.0.0.1:55439/coin_qa"
TODAY: date
PERIOD: str


@pytest.fixture(autouse=True)
def _business_day_at_test_start(monkeypatch):
    day = ledger.business_date(datetime.now(timezone.utc))
    monkeypatch.setitem(globals(), 'TODAY', day)
    monkeypatch.setitem(globals(), 'PERIOD', ledger.period_key(day))


@pytest_asyncio.fixture
async def database():
    try:
        con = await asyncpg.connect(DSN)
    except OSError as exc:
        if os.getenv('CI'):
            raise
        pytest.xfail(f'Disposable Postgres at 127.0.0.1:55439 unavailable: {type(exc).__name__}')
    schema = 'tuition_test_' + uuid4().hex
    await create_disposable_schema(con, schema)
    await apply_finance_migrations(con)

    async def make(role):
        return await con.fetchval("INSERT INTO users(role) VALUES($1) RETURNING id", role)

    people = {'owner': await make('owner'), 'admin': await make('admin'),
              'teacher': await make('teacher'), 'student': await make('student'),
              'other_student': await make('student')}
    try:
        yield con, schema, people
    finally:
        await con.execute('SET search_path TO public')
        await con.execute(f'DROP SCHEMA "{schema}" CASCADE')
        await con.close()


async def approved_contract(con, people, *, monthly=800_000):
    contract = await ledger.create_contract(
        con, actor_user_id=people['owner'], student_user_id=people['student'],
        monthly_amount_minor=monthly, starts_on=TODAY)
    contract = await ledger.approve_contract(con, actor_user_id=people['owner'],
                                             contract_id=contract['id'])
    return await ledger.activate_contract(con, actor_user_id=people['owner'],
                                          contract_id=contract['id'])


async def posted_charge(con, people, *, student=None, gross=800_000, discount=None, due=None,
                        contract=None):
    student = student or people['student']
    if discount:
        await ledger.add_discount(con, actor_user_id=people['owner'], contract_id=contract['id'],
                                  period=PERIOD, amount_minor=discount, reason='Sibling discount')
    charge = await ledger.create_charge(
        con, actor_user_id=people['admin'], student_user_id=student, period=PERIOD,
        due_date=due or TODAY, gross_amount_minor=gross, contract_id=contract['id'] if contract else None)
    # FIN-06: the owner approves before the receivable can reach the journal.
    await ledger.approve_charge(con, actor_user_id=people['owner'], charge_id=charge['id'])
    return await ledger.post_charge(con, actor_user_id=people['admin'], charge_id=charge['id'])


async def balances(con, code):
    return await con.fetchval(
        """SELECT coalesce(sum(amount_minor) FILTER (WHERE direction='debit'),0)
                - coalesce(sum(amount_minor) FILTER (WHERE direction='credit'),0)
             FROM finance_journal_lines l
            WHERE l.account_id = (SELECT id FROM finance_accounts WHERE code=$1)""", code)


# ───────────────────── worked example A: one student, one month ─────────────────────
@pytest.mark.asyncio
async def test_worked_example_a_discount_partial_payment_and_recognition(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    await ledger.add_discount(con, actor_user_id=people['owner'], contract_id=contract['id'],
                              period=PERIOD, amount_minor=200_000, reason='Sibling discount')
    charge = await ledger.create_charge(
        con, actor_user_id=people['admin'], student_user_id=people['student'], period=PERIOD,
        due_date=TODAY, gross_amount_minor=800_000, contract_id=contract['id'])
    assert charge['discount_amount_minor'] == 200_000 and charge['net_amount_minor'] == 600_000
    charge = await ledger.approve_charge(con, actor_user_id=people['owner'],
                                         charge_id=charge['id'])
    charge = await ledger.post_charge(con, actor_user_id=people['admin'], charge_id=charge['id'])

    # Debit A/R 600,000; credit deferred tuition 600,000.
    assert await balances(con, 'accounts_receivable') == 600_000
    assert await balances(con, 'deferred_tuition_revenue') == -600_000

    # First cash receipt 250,000: debit cash, credit A/R. Revenue is NOT recognised yet.
    payment, allocations, duplicate = await ledger.record_payment(
        con, actor_user_id=people['admin'], student_user_id=people['student'],
        amount_minor=250_000, receipt_purpose='Tuition November (part 1)')
    assert not duplicate and payment['status'] == 'confirmed'
    assert payment['receipt_no'].startswith('RC-')
    assert [row['amount_minor'] for row in allocations] == [250_000]
    position = await ledger.student_position(con, people['student'])
    assert position['balanceDueMinor'] == 350_000
    assert position['advanceMinor'] == 0
    assert await balances(con, 'tuition_revenue') == 0, 'collection must not recognise revenue'
    assert await balances(con, 'cash_on_hand') == 250_000

    # Half the contracted service is delivered: move 300,000 from deferred to earned.
    await ledger.recognize_revenue(con, actor_user_id=people['owner'],
                                   student_user_id=people['student'], amount_minor=300_000)
    assert await balances(con, 'tuition_revenue') == -300_000
    assert await balances(con, 'deferred_tuition_revenue') == -300_000

    # Second payment clears the receivable to zero; recognition stays independent.
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=350_000)
    position = await ledger.student_position(con, people['student'])
    assert position['balanceDueMinor'] == 0 and position['collectedMinor'] == 600_000
    assert await balances(con, 'accounts_receivable') == 0
    assert (await ledger.journal_is_balanced(con))['balanced'] is True


# ───────────────────── worked example B: overpayment ─────────────────────
@pytest.mark.asyncio
async def test_overpayment_becomes_a_visible_customer_advance(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=700_000)
    position = await ledger.student_position(con, people['student'])
    assert position['balanceDueMinor'] == 0, 'a surplus is never a negative debt'
    assert position['advanceMinor'] == 100_000
    assert await balances(con, 'customer_advance') == -100_000
    assert await balances(con, 'tuition_revenue') == 0, 'a surplus is never revenue'


# ───────────────────── worked example C: refund ─────────────────────
@pytest.mark.asyncio
async def test_refund_is_an_authorized_reversal_that_never_erases_the_receipt(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    payment, _, _ = await ledger.record_payment(
        con, actor_user_id=people['admin'], student_user_id=people['student'], amount_minor=700_000,
        provider='click', provider_transaction_id='CLICK-1')

    refund, duplicate = await ledger.request_refund(
        con, actor_user_id=people['admin'], payment_id=payment['id'], amount_minor=100_000,
        reason='Overpayment returned to family', provider_refund_id='CLICK-R1')
    assert not duplicate and refund['amount_minor'] == 100_000
    await ledger.approve_refund(con, actor_user_id=people['owner'], refund_id=refund['id'])
    refund = await ledger.settle_refund(con, actor_user_id=people['admin'],
                                        refund_id=refund['id'])
    # The original receipt is still there, unchanged, and the cash leg moved out.
    assert await con.fetchval('SELECT amount_minor FROM tuition_payments WHERE id=$1',
                              payment['id']) == 700_000
    assert await balances(con, 'cash_on_hand') + await balances(con, 'bank_clearing') == 600_000
    assert await balances(con, 'customer_advance') == 0

    # A repeated provider refund callback produces no second refund.
    _, duplicate = await ledger.request_refund(
        con, actor_user_id=people['admin'], payment_id=payment['id'], amount_minor=100_000,
        reason='Overpayment returned to family', provider_refund_id='CLICK-R1')
    assert duplicate is True
    assert await con.fetchval('SELECT count(*) FROM tuition_refunds') == 1

    # Refunding money that is already applied to a charge is refused, not silently done.
    with pytest.raises(LedgerError) as refused:
        await ledger.request_refund(con, actor_user_id=people['admin'], payment_id=payment['id'],
                                    amount_minor=600_000, reason='Refund allocated money')
    assert refused.value.code == 'refund_exceeds_available_funds'


# ───────────────────── worked example D: charge correction ─────────────────────
@pytest.mark.asyncio
async def test_charge_correction_uses_reversing_documents_and_history_is_immutable(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    charge = await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    reversal = await ledger.reverse_charge(con, actor_user_id=people['owner'],
                                           charge_id=charge['id'], reason='Wrong group, re-issued')
    assert reversal['is_reversal'] is True and reversal['net_amount_minor'] == -600_000
    original = await con.fetchrow('SELECT status, net_amount_minor FROM tuition_charges WHERE id=$1',
                                  charge['id'])
    assert original['status'] == 'reversed' and original['net_amount_minor'] == 600_000
    assert await balances(con, 'accounts_receivable') == 0
    assert await con.fetchval("SELECT count(*) FROM finance_journal_entries") == 2

    # Posted journal history cannot be rewritten; corrections are new documents.
    with pytest.raises(asyncpg.PostgresError):
        await con.execute("UPDATE finance_journal_lines SET amount_minor = 1")
    with pytest.raises(asyncpg.PostgresError):
        await con.execute("DELETE FROM finance_journal_lines")
    with pytest.raises(asyncpg.PostgresError):
        await con.execute("DELETE FROM finance_journal_entries")


@pytest.mark.asyncio
async def test_reversal_leaves_every_receivable_projection_at_zero(database):
    """FIN-01: a reversal must zero the receivable in EVERY projection, not just the journal.

    The original document and its reversing document are both posted accounting events; the
    `reversed` lifecycle marker is for display and must not remove the original from the
    money maths. Clamping a negative balance to zero would hide this, so the raw
    `receivableMinor` is asserted directly.
    """
    con, schema, people = database
    contract = await approved_contract(con, people)
    charge = await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    await ledger.reverse_charge(con, actor_user_id=people['owner'], charge_id=charge['id'],
                                reason='Issued against the wrong cohort')

    assert await balances(con, 'accounts_receivable') == 0
    assert await balances(con, 'deferred_tuition_revenue') == 0

    position = await ledger.student_position(con, people['student'])
    assert position['chargedMinor'] == 0, 'the two posted documents must cancel out'
    assert position['receivableMinor'] == 0
    assert position['balanceDueMinor'] == 0
    assert position['overdueMinor'] == 0

    summary = await ledger.finance_summary(con, start=TODAY - timedelta(days=60),
                                           end=TODAY + timedelta(days=60))
    assert summary['outstandingReceivableMinor'] == 0
    assert summary['overdueReceivableMinor'] == 0

    # Both source documents survive intact; nothing was edited away.
    original = await con.fetchrow('SELECT status, net_amount_minor FROM tuition_charges WHERE id=$1',
                                  charge['id'])
    assert original['status'] == 'reversed' and original['net_amount_minor'] == 600_000
    assert await con.fetchval('SELECT count(*) FROM tuition_charges') == 2
    assert (await ledger.journal_is_balanced(con))['balanced'] is True


@pytest.mark.asyncio
async def test_reversal_and_reissue_reconcile_for_two_students(database):
    """FIN-01: per-student isolation holds after reversal, and a re-issued charge is additive."""
    con, schema, people = database
    contract = await approved_contract(con, people)
    mine = await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    theirs = await posted_charge(con, people, student=people['other_student'], gross=500_000)
    await ledger.reverse_charge(con, actor_user_id=people['owner'], charge_id=mine['id'],
                                reason='Wrong cohort')
    reissued = await posted_charge(con, people, gross=400_000, due=TODAY + timedelta(days=10))

    mine_position = await ledger.student_position(con, people['student'])
    assert mine_position['receivableMinor'] == 400_000 and mine_position['balanceDueMinor'] == 400_000
    theirs_position = await ledger.student_position(con, people['other_student'])
    assert theirs_position['receivableMinor'] == 500_000
    summary = await ledger.finance_summary(con, start=TODAY - timedelta(days=60),
                                           end=TODAY + timedelta(days=60))
    assert summary['outstandingReceivableMinor'] == 900_000
    assert reissued['net_amount_minor'] == 400_000


@pytest.mark.asyncio
async def test_a_reversal_cannot_be_reversed_twice(database):
    """FIN-01: no accidental double reversal through the reversing document."""
    con, schema, people = database
    contract = await approved_contract(con, people)
    charge = await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    reversal = await ledger.reverse_charge(con, actor_user_id=people['owner'],
                                           charge_id=charge['id'], reason='Wrong cohort')
    with pytest.raises(LedgerError) as refused:
        await ledger.reverse_charge(con, actor_user_id=people['owner'],
                                    charge_id=reversal['id'], reason='Try again')
    assert refused.value.code == 'reversal_cannot_be_reversed'
    with pytest.raises(LedgerError) as again:
        await ledger.reverse_charge(con, actor_user_id=people['owner'], charge_id=charge['id'],
                                    reason='Already reversed')
    assert again.value.code == 'invalid_state'
    assert await con.fetchval('SELECT count(*) FROM tuition_charges') == 2


@pytest.mark.asyncio
async def test_reversal_is_refused_while_a_payment_is_allocated(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    charge = await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=250_000)
    with pytest.raises(LedgerError) as refused:
        await ledger.reverse_charge(con, actor_user_id=people['owner'], charge_id=charge['id'],
                                    reason='Try to reverse a partly paid charge')
    assert refused.value.code == 'charge_has_allocations'


# ───────────────────── ledger invariants ─────────────────────
@pytest.mark.asyncio
async def test_unbalanced_journal_transaction_cannot_commit(database):
    con, schema, people = database
    account = await con.fetchval("SELECT id FROM finance_accounts WHERE code='cash_on_hand'")
    entry = await con.fetchval("SELECT id FROM finance_accounts WHERE code='accounts_receivable'")
    transaction_id = uuid4()
    with pytest.raises(asyncpg.PostgresError) as caught:
        async with con.transaction():
            row = await con.fetchrow(
                """INSERT INTO finance_journal_entries(transaction_id, source_type, source_id)
                   VALUES ($1,'test',$2) RETURNING id""", transaction_id, uuid4())
            await con.execute(
                """INSERT INTO finance_journal_lines(transaction_id, entry_id, account_id,
                     direction, amount_minor) VALUES ($1,$2,$3,'debit',100)""",
                transaction_id, row['id'], account)
            await con.execute(
                """INSERT INTO finance_journal_lines(transaction_id, entry_id, account_id,
                     direction, amount_minor) VALUES ($1,$2,$3,'credit',99)""",
                transaction_id, row['id'], entry)
    assert 'unbalanced_journal_entry' in str(caught.value)
    assert await con.fetchval('SELECT count(*) FROM finance_journal_lines') == 0


@pytest.mark.asyncio
async def test_duplicate_provider_callback_has_exactly_one_effect(database):
    """100 identical provider events create one intent, and one settlement, and one posting."""
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    created = 0
    for _ in range(100):
        payment, _, duplicate = await ledger.record_payment(
            con, actor_user_id=people['admin'], student_user_id=people['student'],
            amount_minor=600_000, method='provider', provider='payme',
            provider_transaction_id='PAYME-77', idempotency_key='idem-77')
        created += 0 if duplicate else 1
    assert created == 1
    assert payment['status'] == 'pending_provider'
    assert await con.fetchval('SELECT count(*) FROM tuition_payments') == 1
    # Nothing has moved yet: an intent is not money.
    assert await con.fetchval('SELECT count(*) FROM tuition_payment_allocations') == 0
    assert await con.fetchval('SELECT count(*) FROM finance_journal_entries') == 1

    proof = ledger.provider_proof(amount_minor=600_000, currency='UZS', order_ref='idem-77',
                                  student_user_id=people['student'], status='paid')
    settled_count = 0
    for _ in range(100):
        _, _, duplicate = await ledger.confirm_provider_payment(
            con, provider='payme', provider_transaction_id='PAYME-77', proof=proof)
        settled_count += 0 if duplicate else 1
    assert settled_count == 1
    assert await con.fetchval('SELECT count(*) FROM tuition_payments') == 1
    assert await con.fetchval('SELECT count(*) FROM tuition_payment_allocations') == 1
    assert await con.fetchval('SELECT count(*) FROM finance_journal_entries') == 2
    position = await ledger.student_position(con, people['student'])
    assert position['collectedMinor'] == 600_000 and position['balanceDueMinor'] == 0
    assert (await ledger.journal_is_balanced(con))['balanced'] is True


@pytest.mark.asyncio
async def test_parallel_duplicate_callbacks_create_one_payment(database):
    """A real race: 20 connections submit the same provider confirmation at once."""
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)

    proof = ledger.provider_proof(amount_minor=600_000, currency='UZS', order_ref='idem-race',
                                  student_user_id=people['student'], status='paid')

    async def submit():
        other = await asyncpg.connect(DSN)
        try:
            await other.execute(f'SET search_path TO "{schema}", public')
            async with other.transaction():
                await ledger.record_payment(
                    other, actor_user_id=people['admin'], student_user_id=people['student'],
                    amount_minor=600_000, method='provider', provider='payme',
                    provider_transaction_id='PAYME-RACE', idempotency_key='idem-race')
                _, _, duplicate = await ledger.confirm_provider_payment(
                    other, provider='payme', provider_transaction_id='PAYME-RACE', proof=proof)
                return duplicate
        finally:
            await other.close()

    results = await asyncio.gather(*(submit() for _ in range(20)), return_exceptions=True)
    failures = [row for row in results if isinstance(row, Exception)]
    assert failures == [], f'concurrent duplicates must resolve, not raise: {failures[:2]}'
    assert results.count(False) == 1, 'exactly one submitter creates the payment'
    assert results.count(True) == 19, 'every retry reports the same payment as a duplicate'
    assert await con.fetchval('SELECT count(*) FROM tuition_payments') == 1
    assert await con.fetchval('SELECT count(*) FROM finance_journal_entries') == 2
    assert (await ledger.journal_is_balanced(con))['balanced'] is True


@pytest.mark.asyncio
async def test_allocation_never_crosses_students(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    mine = await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    theirs = await posted_charge(con, people, student=people['other_student'], gross=500_000)
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=600_000)
    # The other student's charge is untouched by my payment.
    other = await ledger.student_position(con, people['other_student'])
    assert other['balanceDueMinor'] == 500_000 and other['allocatedMinor'] == 0
    assert await con.fetchval('SELECT amount_minor FROM tuition_payment_allocations WHERE charge_id=$1',
                              theirs['id']) is None
    assert await con.fetchval('SELECT amount_minor FROM tuition_payment_allocations WHERE charge_id=$1',
                              mine['id']) == 600_000


@pytest.mark.asyncio
async def test_revenue_recognition_is_bounded_by_the_deferred_balance(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    with pytest.raises(LedgerError) as refused:
        await ledger.recognize_revenue(con, actor_user_id=people['owner'],
                                       student_user_id=people['student'], amount_minor=600_001)
    assert refused.value.code == 'insufficient_deferred_revenue'
    await ledger.recognize_revenue(con, actor_user_id=people['owner'],
                                   student_user_id=people['student'], amount_minor=600_000)
    assert await balances(con, 'deferred_tuition_revenue') == 0
    assert await balances(con, 'tuition_revenue') == -600_000


@pytest.mark.asyncio
async def test_closed_period_rejects_new_postings(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    charge = await ledger.create_charge(con, actor_user_id=people['admin'],
                                        student_user_id=people['student'], period=PERIOD,
                                        due_date=TODAY, gross_amount_minor=800_000,
                                        contract_id=contract['id'])
    # Approve first (FIN-06), so the refusal below is about the closed period and not about
    # a missing approval.
    await ledger.approve_charge(con, actor_user_id=people['owner'], charge_id=charge['id'])
    await ledger.close_period(con, actor_user_id=people['owner'], period=PERIOD,
                              reason='Month closed by owner')
    with pytest.raises(LedgerError) as refused:
        await ledger.post_charge(con, actor_user_id=people['admin'], charge_id=charge['id'])
    assert refused.value.code == 'period_closed'
    with pytest.raises(LedgerError) as closed:
        await ledger.close_period(con, actor_user_id=people['owner'], period=PERIOD)
    assert closed.value.code == 'period_already_closed'


@pytest.mark.asyncio
async def test_day_close_records_variance_and_locks_the_day(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=250_000)
    close = await ledger.close_day(con, actor_user_id=people['owner'], business_date=TODAY,
                                   counted_minor=245_000, reason='5,000 short in the drawer')
    assert close['expected_minor'] == 250_000 and close['variance_minor'] == -5_000
    with pytest.raises(LedgerError) as refused:
        await ledger.record_payment(con, actor_user_id=people['admin'],
                                    student_user_id=people['student'], amount_minor=10_000)
    assert refused.value.code == 'day_closed'


@pytest.mark.asyncio
async def test_receipt_numbers_are_unique_and_sequential(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    receipts = []
    for _ in range(5):
        payment, _, _ = await ledger.record_payment(
            con, actor_user_id=people['admin'], student_user_id=people['student'],
            amount_minor=10_000)
        receipts.append(payment['receipt_no'])
    assert len(set(receipts)) == 5
    assert receipts == sorted(receipts)
    assert receipts[0].endswith('000001') and receipts[-1].endswith('000005')


@pytest.mark.asyncio
async def test_discount_is_a_single_approved_document(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    await ledger.add_discount(con, actor_user_id=people['owner'], contract_id=contract['id'],
                              period=PERIOD, amount_minor=200_000, reason='Sibling discount')
    with pytest.raises(LedgerError) as refused:
        await ledger.add_discount(con, actor_user_id=people['owner'], contract_id=contract['id'],
                                  period=PERIOD, amount_minor=50_000, reason='Second attempt')
    assert refused.value.code == 'discount_already_approved_for_period'
    charge = await ledger.create_charge(con, actor_user_id=people['admin'],
                                        student_user_id=people['student'], period=PERIOD,
                                        due_date=TODAY, gross_amount_minor=800_000,
                                        contract_id=contract['id'])
    assert charge['net_amount_minor'] == 600_000, 'the discount applies exactly once'


@pytest.mark.asyncio
async def test_contract_price_change_never_rewrites_an_existing_obligation(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    first = await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    # A new catalogue price is a NEW contract version; the signed obligation is untouched.
    renewed = await ledger.create_contract(con, actor_user_id=people['owner'],
                                           student_user_id=people['student'],
                                           monthly_amount_minor=950_000, starts_on=TODAY)
    renewed = await ledger.approve_contract(con, actor_user_id=people['owner'],
                                            contract_id=renewed['id'])
    await con.execute('UPDATE tuition_contracts SET supersedes_contract_id=$2 WHERE id=$1',
                      renewed['id'], contract['id'])
    stored = await con.fetchrow('SELECT monthly_amount_minor, status FROM tuition_contracts WHERE id=$1',
                                contract['id'])
    assert stored['monthly_amount_minor'] == 800_000
    assert first['net_amount_minor'] == 600_000


@pytest.mark.asyncio
async def test_statement_and_owner_summary_reconcile_to_the_ledger(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    await posted_charge(con, people, student=people['other_student'], gross=500_000,
                        due=TODAY - timedelta(days=40))
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=250_000)
    await ledger.recognize_revenue(con, actor_user_id=people['owner'],
                                   student_user_id=people['student'], amount_minor=300_000)
    statement = await ledger.student_statement(con, people['student'])
    summary = await ledger.finance_summary(con, start=TODAY - timedelta(days=60),
                                           end=TODAY + timedelta(days=60))
    assert statement['position']['balanceDueMinor'] == 350_000
    assert summary['collectedCashMinor'] == 250_000
    assert summary['invoicedTuitionMinor'] == 1_100_000
    assert summary['recognizedRevenueMinor'] == 300_000
    assert summary['outstandingReceivableMinor'] == 350_000 + 500_000
    assert summary['overdueReceivableMinor'] == 500_000
    assert summary['customerAdvanceMinor'] == 0
    assert summary['refundsMinor'] == 0
    # Cash collected, tuition invoiced and revenue recognised are three different numbers.
    assert len({summary['collectedCashMinor'], summary['invoicedTuitionMinor'],
                summary['recognizedRevenueMinor']}) == 3
    assert (await ledger.journal_is_balanced(con))['balanced'] is True


@pytest.mark.asyncio
async def test_pending_provider_intent_moves_no_money(database):
    """A browser redirect is not a payment: nothing posts until the provider confirms."""
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    payment, allocations, duplicate = await ledger.record_payment(
        con, actor_user_id=people['admin'], student_user_id=people['student'],
        amount_minor=600_000, method='provider', provider='payme',
        provider_transaction_id='PAYME-PENDING', confirm=False)
    assert payment['status'] == 'pending_provider' and allocations == []
    position = await ledger.student_position(con, people['student'])
    assert position['balanceDueMinor'] == 600_000 and position['collectedMinor'] == 0
    assert await con.fetchval('SELECT count(*) FROM finance_journal_entries') == 1


@pytest.mark.asyncio
async def test_a_caller_cannot_confirm_provider_money_by_asking(database):
    """FIN-03: `confirm=True` from a staff/browser request must never settle provider money."""
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    payment, allocations, _ = await ledger.record_payment(
        con, actor_user_id=people['admin'], student_user_id=people['student'],
        amount_minor=600_000, method='provider', provider='payme',
        provider_transaction_id='PAYME-ATTACK', confirm=True)
    assert payment['status'] == 'pending_provider', 'a privileged caller forged a settlement'
    assert allocations == []
    assert await con.fetchval('SELECT count(*) FROM finance_journal_entries') == 1
    assert (await ledger.student_position(con, people['student']))['collectedMinor'] == 0


@pytest.mark.asyncio
async def test_provider_proof_settles_a_pending_intent_exactly_once(database):
    """FIN-02: pending -> confirmed is an atomic, exactly-once transition on real proof."""
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=600_000,
                                method='provider', provider='payme',
                                provider_transaction_id='PAYME-SETTLE')
    proof = ledger.provider_proof(amount_minor=600_000, currency='UZS', order_ref=None,
                                  student_user_id=people['student'], status='paid')
    settled, allocations, duplicate = await ledger.confirm_provider_payment(
        con, provider='payme', provider_transaction_id='PAYME-SETTLE', proof=proof)
    assert not duplicate and settled['status'] == 'confirmed'
    assert [row['amount_minor'] for row in allocations] == [600_000]
    position = await ledger.student_position(con, people['student'])
    assert position['collectedMinor'] == 600_000 and position['balanceDueMinor'] == 0

    for _ in range(100):
        _, _, again = await ledger.confirm_provider_payment(
            con, provider='payme', provider_transaction_id='PAYME-SETTLE', proof=proof)
        assert again is True
    assert await con.fetchval('SELECT count(*) FROM tuition_payments') == 1
    assert await con.fetchval('SELECT count(*) FROM tuition_payment_allocations') == 1
    assert await con.fetchval('SELECT count(*) FROM finance_journal_entries') == 2
    assert (await ledger.journal_is_balanced(con))['balanced'] is True


@pytest.mark.asyncio
async def test_concurrent_provider_confirmations_settle_once(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=600_000,
                                method='provider', provider='payme',
                                provider_transaction_id='PAYME-RACE2')
    proof = ledger.provider_proof(amount_minor=600_000, currency='UZS', order_ref=None,
                                  student_user_id=people['student'], status='paid')

    async def settle():
        other = await asyncpg.connect(DSN)
        try:
            await other.execute(f'SET search_path TO "{schema}", public')
            async with other.transaction():
                _, _, duplicate = await ledger.confirm_provider_payment(
                    other, provider='payme', provider_transaction_id='PAYME-RACE2', proof=proof)
                return duplicate
        finally:
            await other.close()

    results = await asyncio.gather(*(settle() for _ in range(20)), return_exceptions=True)
    assert [r for r in results if isinstance(r, Exception)] == []
    assert results.count(False) == 1 and results.count(True) == 19
    assert await con.fetchval('SELECT count(*) FROM finance_journal_entries') == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('tamper,expected', [
    ({'amount_minor': 599_999}, 'proof_amount_mismatch'),
    ({'currency': 'USD'}, 'proof_currency_mismatch'),
    ({'status': 'failed'}, 'proof_not_paid'),
    ({'status': 'created'}, 'proof_not_paid'),
])
async def test_provider_proof_is_checked_against_the_pending_intent(database, tamper, expected):
    """FIN-02: amount, currency, customer and status are all bound to the intent."""
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=600_000,
                                method='provider', provider='payme',
                                provider_transaction_id='PAYME-TAMPER')
    kwargs = dict(amount_minor=600_000, currency='UZS', order_ref=None,
                  student_user_id=people['student'], status='paid')
    kwargs.update(tamper)
    with pytest.raises(LedgerError) as refused:
        await ledger.confirm_provider_payment(con, provider='payme',
                                              provider_transaction_id='PAYME-TAMPER',
                                              proof=ledger.provider_proof(**kwargs))
    assert refused.value.code == expected
    stored = await con.fetchrow("SELECT status FROM tuition_payments WHERE provider_transaction_id='PAYME-TAMPER'")
    assert stored['status'] == 'pending_provider', 'a bad proof must not settle anything'
    assert await con.fetchval('SELECT count(*) FROM finance_journal_entries') == 1


@pytest.mark.asyncio
async def test_provider_proof_for_another_student_is_refused(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=600_000,
                                method='provider', provider='payme',
                                provider_transaction_id='PAYME-WRONGUSER')
    proof = ledger.provider_proof(amount_minor=600_000, currency='UZS', order_ref=None,
                                  student_user_id=people['other_student'], status='paid')
    with pytest.raises(LedgerError) as refused:
        await ledger.confirm_provider_payment(con, provider='payme',
                                              provider_transaction_id='PAYME-WRONGUSER',
                                              proof=proof)
    assert refused.value.code == 'proof_student_mismatch'


@pytest.mark.asyncio
async def test_cancelled_and_expired_intents_cannot_settle(database):
    con, schema, people = database
    for state, txn in (('cancelled', 'PAYME-CANCELLED'), ('expired', 'PAYME-EXPIRED')):
        await ledger.record_payment(con, actor_user_id=people['admin'],
                                    student_user_id=people['student'], amount_minor=600_000,
                                    method='provider', provider='payme',
                                    provider_transaction_id=txn)
        await ledger.close_provider_intent(con, provider='payme', provider_transaction_id=txn,
                                           to_status=state, reason='test')
        proof = ledger.provider_proof(amount_minor=600_000, currency='UZS', order_ref=None,
                                      student_user_id=people['student'], status='paid')
        with pytest.raises(LedgerError) as refused:
            await ledger.confirm_provider_payment(con, provider='payme',
                                                  provider_transaction_id=txn, proof=proof)
        assert refused.value.code == 'intent_not_settleable'
    assert await con.fetchval('SELECT count(*) FROM finance_journal_entries') == 0


# ────────────── FIN-04: one tuition installment per contract and period ──────────────
@pytest.mark.asyncio
async def test_one_installment_per_contract_and_period(database):
    """A second normal charge for the same contract/period is a duplicate, not a document."""
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    await ledger.create_charge(con, actor_user_id=people['admin'],
                               student_user_id=people['student'], period=PERIOD,
                               due_date=TODAY, gross_amount_minor=800_000,
                               contract_id=contract['id'])
    with pytest.raises(LedgerError) as exc:
        await ledger.create_charge(con, actor_user_id=people['admin'],
                                   student_user_id=people['student'], period=PERIOD,
                                   due_date=TODAY, gross_amount_minor=800_000,
                                   contract_id=contract['id'])
    assert exc.value.code == 'charge_already_exists_for_period'
    assert exc.value.status == 409
    assert await con.fetchval('SELECT count(*) FROM tuition_charges') == 1


@pytest.mark.asyncio
async def test_concurrent_monthly_charge_generation_creates_one_charge(database):
    """Two schedulers running the same monthly job at the same instant cannot double-bill."""
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    next_period = ledger.period_key(TODAY.replace(day=1) + timedelta(days=32))

    async def generate():
        other = await asyncpg.connect(DSN)
        try:
            await other.execute(f'SET search_path TO "{schema}", public')
            async with other.transaction():
                charge, created = await ledger.generate_installment(
                    other, actor_user_id=people['admin'], contract_id=contract['id'],
                    period=next_period, due_date=TODAY.replace(day=1))
                return charge['id'], created
        finally:
            await other.close()

    results = await asyncio.gather(*(generate() for _ in range(6)), return_exceptions=True)
    ids = {row[0] for row in results if not isinstance(row, Exception)}
    assert len(ids) == 1, f'concurrent generation produced {len(ids)} charges'
    assert await con.fetchval('SELECT count(*) FROM tuition_charges') == 1


@pytest.mark.asyncio
async def test_installment_generation_is_idempotent_on_retry(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    first, created = await ledger.generate_installment(
        con, actor_user_id=people['admin'], contract_id=contract['id'], period=PERIOD,
        due_date=TODAY)
    assert created is True
    second, created = await ledger.generate_installment(
        con, actor_user_id=people['admin'], contract_id=contract['id'], period=PERIOD,
        due_date=TODAY)
    assert created is False and second['id'] == first['id']
    assert first['gross_amount_minor'] == 800_000, 'installment must price from the contract'
    assert await con.fetchval('SELECT count(*) FROM tuition_charges') == 1


@pytest.mark.asyncio
async def test_reversal_frees_the_period_for_a_corrected_reissue(database):
    """Corrections are separate documents, but only one of them may remain live."""
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    charge = await posted_charge(con, people, contract=contract)
    await ledger.reverse_charge(con, actor_user_id=people['owner'], charge_id=charge['id'],
                                reason='Wrong month billed')
    reissued, created = await ledger.generate_installment(
        con, actor_user_id=people['admin'], contract_id=contract['id'], period=PERIOD,
        due_date=TODAY)
    assert created is True and reissued['id'] != charge['id']
    # The reissued installment now occupies the period: the generator is idempotent and
    # create_charge, which does not pretend to be a scheduler, refuses a second document.
    again, created = await ledger.generate_installment(
        con, actor_user_id=people['admin'], contract_id=contract['id'], period=PERIOD,
        due_date=TODAY)
    assert created is False and again['id'] == reissued['id']
    with pytest.raises(LedgerError) as exc:
        await ledger.create_charge(con, actor_user_id=people['admin'],
                                   student_user_id=people['student'], period=PERIOD,
                                   due_date=TODAY, gross_amount_minor=800_000,
                                   contract_id=contract['id'])
    assert exc.value.code == 'charge_already_exists_for_period'
    assert await con.fetchval(
        'SELECT count(*) FROM tuition_charges'
        " WHERE is_reversal=false AND status NOT IN ('reversed','credited')") == 1


# ───────── FIN-05: posted terms are frozen; later relief is a credit note ─────────
@pytest.mark.asyncio
async def test_posting_freezes_the_discount_and_the_commercial_terms(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    await ledger.add_discount(con, actor_user_id=people['owner'], contract_id=contract['id'],
                              period=PERIOD, amount_minor=200_000, reason='Sibling discount')
    charge = await posted_charge(con, people, contract=contract)
    assert charge['discount_locked_minor'] == 200_000
    assert charge['discount_locked_at'] is not None


@pytest.mark.asyncio
async def test_a_discount_cannot_be_added_after_the_period_is_posted(database):
    """A late discount would silently understate an obligation that is already on the books."""
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    await posted_charge(con, people, contract=contract)
    with pytest.raises(LedgerError) as exc:
        await ledger.add_discount(con, actor_user_id=people['owner'], contract_id=contract['id'],
                                  period=PERIOD, amount_minor=100_000, reason='Late goodwill')
    assert exc.value.code == 'charge_already_posted'
    assert exc.value.status == 409
    assert exc.value.details['remedy'] == 'credit_note'
    # Nothing was written behind the refusal.
    assert await con.fetchval('SELECT count(*) FROM tuition_contract_discounts') == 0
    position = await ledger.student_position(con, people['student'])
    assert position['balanceDueMinor'] == 800_000


@pytest.mark.asyncio
async def test_credit_note_relieves_a_posted_charge_with_a_balanced_journal(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    charge = await posted_charge(con, people, contract=contract)

    note = await ledger.create_credit_note(con, actor_user_id=people['admin'],
                                           charge_id=charge['id'], amount_minor=200_000,
                                           reason='Scholarship agreed after billing')
    assert note['status'] == 'draft'
    # An unapproved note relieves nothing.
    assert (await ledger.student_position(con, people['student']))['balanceDueMinor'] == 800_000
    note = await ledger.approve_credit_note(con, actor_user_id=people['owner'],
                                            credit_note_id=note['id'])
    assert note['status'] == 'approved'
    note = await ledger.post_credit_note(conn=con, actor_user_id=people['owner'],
                                         credit_note_id=note['id'])
    assert note['status'] == 'posted'

    position = await ledger.student_position(con, people['student'])
    assert position['balanceDueMinor'] == 600_000, 'a posted credit note must reduce the debt'
    assert position['receivableMinor'] == 600_000
    # The billed figure stays what was billed; the relief is reported next to it, not folded
    # into it, so a statement reads "billed 800000, relieved 200000, due 600000".
    assert position['chargedMinor'] == 800_000
    assert position['creditedMinor'] == 200_000
    # The original charge document is immutable: only the credit note records the relief.
    assert await con.fetchval('SELECT net_amount_minor FROM tuition_charges WHERE id=$1',
                              charge['id']) == 800_000
    assert (await ledger.journal_is_balanced(con))['balanced'] is True
    ar = await balances(con, 'accounts_receivable')
    assert ar == 600_000
    assert await balances(con, 'scholarship_discounts') == 200_000


@pytest.mark.asyncio
async def test_credit_note_requires_approval_and_cannot_exceed_the_charge(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    charge = await posted_charge(con, people, contract=contract)

    with pytest.raises(LedgerError) as exc:
        await ledger.create_credit_note(con, actor_user_id=people['admin'],
                                        charge_id=charge['id'], amount_minor=900_000,
                                        reason='Too generous')
    assert exc.value.code == 'credit_exceeds_charge'

    with pytest.raises(LedgerError) as exc:
        await ledger.create_credit_note(con, actor_user_id=people['admin'],
                                        charge_id=charge['id'], amount_minor=100_000, reason='')
    assert exc.value.code == 'reason_required'

    note = await ledger.create_credit_note(con, actor_user_id=people['admin'],
                                           charge_id=charge['id'], amount_minor=100_000,
                                           reason='Goodwill')
    with pytest.raises(LedgerError) as exc:
        await ledger.post_credit_note(conn=con, actor_user_id=people['admin'],
                                      credit_note_id=note['id'])
    assert exc.value.code == 'credit_note_not_approved'
    # An admin cannot self-approve: approval is an owner act.
    with pytest.raises(LedgerError) as exc:
        await ledger.approve_credit_note(con, actor_user_id=people['admin'],
                                         credit_note_id=note['id'])
    assert exc.value.code == 'approval_requires_owner'


@pytest.mark.asyncio
async def test_only_one_live_credit_note_per_charge_and_period(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    charge = await posted_charge(con, people, contract=contract)
    await ledger.create_credit_note(con, actor_user_id=people['admin'], charge_id=charge['id'],
                                    amount_minor=100_000, reason='First relief')
    with pytest.raises(LedgerError) as exc:
        await ledger.create_credit_note(con, actor_user_id=people['admin'],
                                        charge_id=charge['id'], amount_minor=50_000,
                                        reason='Second relief')
    assert exc.value.code == 'credit_note_already_exists'


@pytest.mark.asyncio
async def test_multiple_pre_post_discounts_are_still_one_document_per_period(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    await ledger.add_discount(con, actor_user_id=people['owner'], contract_id=contract['id'],
                              period=PERIOD, amount_minor=100_000, reason='Sibling discount')
    with pytest.raises(LedgerError) as exc:
        await ledger.add_discount(con, actor_user_id=people['owner'], contract_id=contract['id'],
                                  period=PERIOD, amount_minor=50_000, reason='Another one')
    assert exc.value.code == 'discount_already_approved_for_period'
    charge = await posted_charge(con, people, contract=contract)
    assert charge['net_amount_minor'] == 700_000


# ───────── FIN-06: draft -> approved -> posted, and only an owner approves ─────────
@pytest.mark.asyncio
async def test_a_draft_charge_cannot_be_posted(database):
    """The receivable reaches the journal only after a second person has approved it."""
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    charge = await ledger.create_charge(con, actor_user_id=people['admin'],
                                        student_user_id=people['student'], period=PERIOD,
                                        due_date=TODAY, gross_amount_minor=800_000,
                                        contract_id=contract['id'])
    assert charge['status'] == 'draft'
    with pytest.raises(LedgerError) as exc:
        await ledger.post_charge(con, actor_user_id=people['admin'], charge_id=charge['id'])
    assert exc.value.code == 'charge_not_approved'
    assert exc.value.status == 409
    # Nothing reached the ledger: no receivable, no journal entry.
    assert (await ledger.student_position(con, people['student']))['balanceDueMinor'] == 0
    assert await con.fetchval('SELECT count(*) FROM finance_journal_entries') == 0


@pytest.mark.asyncio
async def test_charge_approval_requires_an_owner_who_is_not_the_drafter(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    charge = await ledger.create_charge(con, actor_user_id=people['admin'],
                                        student_user_id=people['student'], period=PERIOD,
                                        due_date=TODAY, gross_amount_minor=800_000,
                                        contract_id=contract['id'])
    for actor in ('admin', 'teacher'):
        with pytest.raises(LedgerError) as exc:
            await ledger.approve_charge(con, actor_user_id=people[actor], charge_id=charge['id'])
        assert exc.value.code == 'approval_requires_owner', actor
    approved = await ledger.approve_charge(con, actor_user_id=people['owner'],
                                           charge_id=charge['id'])
    assert approved['status'] == 'approved' and approved['approved_by'] == people['owner']
    with pytest.raises(LedgerError) as exc:
        await ledger.approve_charge(con, actor_user_id=people['owner'], charge_id=charge['id'])
    assert exc.value.code == 'invalid_state'


@pytest.mark.asyncio
async def test_a_drafter_owner_cannot_approve_their_own_charge(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    charge = await ledger.create_charge(con, actor_user_id=people['owner'],
                                        student_user_id=people['student'], period=PERIOD,
                                        due_date=TODAY, gross_amount_minor=800_000,
                                        contract_id=contract['id'])
    with pytest.raises(LedgerError) as exc:
        await ledger.approve_charge(con, actor_user_id=people['owner'], charge_id=charge['id'])
    assert exc.value.code == 'approver_must_differ_from_drafter'


@pytest.mark.asyncio
async def test_the_full_draft_approve_post_chain_posts_exactly_once(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    charge = await ledger.create_charge(con, actor_user_id=people['admin'],
                                        student_user_id=people['student'], period=PERIOD,
                                        due_date=TODAY, gross_amount_minor=800_000,
                                        contract_id=contract['id'])
    await ledger.approve_charge(con, actor_user_id=people['owner'], charge_id=charge['id'])
    posted = await ledger.post_charge(con, actor_user_id=people['admin'], charge_id=charge['id'])
    assert posted['status'] == 'posted' and posted['posted_at'] is not None
    with pytest.raises(LedgerError) as exc:
        await ledger.post_charge(con, actor_user_id=people['admin'], charge_id=charge['id'])
    assert exc.value.code == 'invalid_state'
    assert (await ledger.student_position(con, people['student']))['balanceDueMinor'] == 800_000
    assert await con.fetchval('SELECT count(*) FROM finance_journal_entries') == 1
    assert (await ledger.journal_is_balanced(con))['balanced'] is True


# ──────────── FIN-07: a contract belongs to a student record, not any user ────────────
@pytest.mark.asyncio
@pytest.mark.parametrize('role', ['owner', 'admin', 'teacher'])
async def test_a_contract_cannot_be_created_for_a_non_student_user(database, role):
    """Billing a staff account would put a salary line into the receivable ledger."""
    con, schema, people = database
    with pytest.raises(LedgerError) as exc:
        await ledger.create_contract(con, actor_user_id=people['owner'],
                                     student_user_id=people[role], monthly_amount_minor=800_000,
                                     starts_on=TODAY)
    assert exc.value.code == 'student_not_found'
    assert exc.value.status == 404, 'a non-student must be indistinguishable from a missing one'
    assert await con.fetchval('SELECT count(*) FROM tuition_contracts') == 0


@pytest.mark.asyncio
async def test_a_contract_cannot_be_created_for_a_suspended_student(database):
    con, schema, people = database
    await con.execute("UPDATE users SET account_status='suspended' WHERE id=$1",
                      people['student'])
    with pytest.raises(LedgerError) as exc:
        await ledger.create_contract(con, actor_user_id=people['owner'],
                                     student_user_id=people['student'],
                                     monthly_amount_minor=800_000, starts_on=TODAY)
    assert exc.value.code == 'student_not_active'
    assert exc.value.status == 409


@pytest.mark.asyncio
async def test_a_suspended_student_may_still_pay_off_what_they_owe(database):
    """Enrolment needs an active student; collecting an existing debt must never be blocked."""
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    await posted_charge(con, people, contract=contract)
    await con.execute("UPDATE users SET account_status='suspended' WHERE id=$1",
                      people['student'])
    payment, allocations, duplicate = await ledger.record_payment(
        con, actor_user_id=people['admin'], student_user_id=people['student'],
        amount_minor=800_000)
    assert duplicate is False and payment['status'] == 'confirmed'
    assert (await ledger.student_position(con, people['student']))['balanceDueMinor'] == 0
    assert (await ledger.journal_is_balanced(con))['balanced'] is True


@pytest.mark.asyncio
async def test_a_payment_cannot_be_recorded_against_a_staff_account(database):
    con, schema, people = database
    with pytest.raises(LedgerError) as exc:
        await ledger.record_payment(con, actor_user_id=people['admin'],
                                    student_user_id=people['admin'], amount_minor=100_000)
    assert exc.value.code == 'student_not_found'
    assert await con.fetchval('SELECT count(*) FROM tuition_payments') == 0


# ──── FIN-08: a refund is a new current-period outgoing payment, never an old edit ────
async def advance_payment(con, people, *, amount=700_000, days_ago=0, method='cash'):
    """A pure customer advance: no open charge, so the whole amount is refundable."""
    moment = datetime.now(timezone.utc) - timedelta(days=days_ago)
    kwargs = {}
    if method == 'provider':
        # A provider payment carries its vendor references, and settles on proof (FIN-02/03).
        kwargs = {'provider': 'payme', 'provider_transaction_id': f'PAYME-{days_ago}-{amount}'}
    payment, _, _ = await ledger.record_payment(
        con, actor_user_id=people['admin'], student_user_id=people['student'],
        amount_minor=amount, method=method, occurred_at=moment, **kwargs)
    if method == 'provider':
        payment, _, _ = await ledger.confirm_provider_payment(
            con, provider=kwargs['provider'],
            provider_transaction_id=kwargs['provider_transaction_id'],
            proof=ledger.provider_proof(amount_minor=amount, currency='UZS', status='paid',
                                        order_ref=payment['idempotency_key'],
                                        student_user_id=people['student']))
    return payment


@pytest.mark.asyncio
async def test_a_45_day_old_payment_can_be_refunded_after_its_cash_day_closed(database):
    """The headline case: history is closed, the refund still happens - in TODAY's period."""
    con, schema, people = database
    payment = await advance_payment(con, people, amount=700_000, days_ago=45)
    old_day = ledger.business_date(payment['occurred_at'])

    # The cashier closed that day weeks ago. It must stay closed and unchanged.
    closed = await ledger.close_day(con, actor_user_id=people['owner'], business_date=old_day,
                                    counted_minor=700_000)
    assert closed['expected_minor'] == 700_000

    refund, duplicate = await ledger.request_refund(con, actor_user_id=people['admin'],
                                                    payment_id=payment['id'], amount_minor=200_000,
                                                    reason='Family withdrew, cash returned')
    assert duplicate is False and refund['status'] == 'requested'
    assert refund['effective_on'] == TODAY, 'a refund belongs to today, not to the old receipt'
    assert refund['effective_period'] == PERIOD
    refund = await ledger.approve_refund(con, actor_user_id=people['owner'],
                                         refund_id=refund['id'])
    assert refund['status'] == 'approved'
    refund = await ledger.settle_refund(con, actor_user_id=people['admin'],
                                        refund_id=refund['id'])
    assert refund['status'] == 'settled' and refund['settled_at'] is not None

    # The old cash day was NOT rewritten: its expectation is still 700,000.
    assert await con.fetchval('SELECT expected_minor FROM cash_day_closes WHERE business_date=$1',
                              old_day) == 700_000
    assert await con.fetchval('SELECT count(*) FROM cash_day_closes') == 1
    assert await balances(con, 'cash_on_hand') == 500_000
    assert (await ledger.journal_is_balanced(con))['balanced'] is True


@pytest.mark.asyncio
async def test_an_unapproved_or_unsettled_refund_moves_no_money(database):
    con, schema, people = database
    payment = await advance_payment(con, people, amount=700_000)

    refund, _ = await ledger.request_refund(con, actor_user_id=people['admin'],
                                            payment_id=payment['id'], amount_minor=100_000,
                                            reason='Withdrawal')
    assert await balances(con, 'cash_on_hand') == 700_000, 'a request is not money out'
    with pytest.raises(LedgerError) as exc:
        await ledger.settle_refund(con, actor_user_id=people['admin'], refund_id=refund['id'])
    assert exc.value.code == 'refund_not_approved'
    with pytest.raises(LedgerError) as exc:
        await ledger.approve_refund(con, actor_user_id=people['admin'], refund_id=refund['id'])
    assert exc.value.code == 'approval_requires_owner'

    await ledger.approve_refund(con, actor_user_id=people['owner'], refund_id=refund['id'])
    assert await balances(con, 'cash_on_hand') == 700_000, 'approval is not money out either'
    await ledger.settle_refund(con, actor_user_id=people['admin'], refund_id=refund['id'])
    assert await balances(con, 'cash_on_hand') == 600_000
    # Settling twice is refused, so the drawer cannot be drained by a double click.
    with pytest.raises(LedgerError) as exc:
        await ledger.settle_refund(con, actor_user_id=people['admin'], refund_id=refund['id'])
    assert exc.value.code == 'refund_already_settled'


@pytest.mark.asyncio
async def test_a_failed_or_rejected_refund_leaves_the_cash_in_the_drawer(database):
    con, schema, people = database
    payment = await advance_payment(con, people, amount=700_000, method='provider')

    rejected, _ = await ledger.request_refund(con, actor_user_id=people['admin'],
                                              payment_id=payment['id'], amount_minor=100_000,
                                              reason='Withdrawal')
    rejected = await ledger.reject_refund(con, actor_user_id=people['owner'],
                                          refund_id=rejected['id'], reason='Policy: no refunds')
    assert rejected['status'] == 'rejected'

    failed, _ = await ledger.request_refund(con, actor_user_id=people['admin'],
                                            payment_id=payment['id'], amount_minor=50_000,
                                            reason='Card reversal')
    await ledger.approve_refund(con, actor_user_id=people['owner'], refund_id=failed['id'])
    failed = await ledger.fail_refund(con, actor_user_id=people['admin'], refund_id=failed['id'],
                                      reason='Provider declined the reversal')
    assert failed['status'] == 'failed'
    assert failed['failure_reason'] == 'Provider declined the reversal'
    assert await con.fetchval(
        "SELECT count(*) FROM finance_journal_entries WHERE source_type='refund'") == 0
    # The only journal activity is the original receipt: two lines, cash in and advance up.
    assert await con.fetchval('SELECT count(*) FROM finance_journal_lines') == 2
    assert await balances(con, 'provider_clearing') == 700_000


@pytest.mark.asyncio
async def test_cash_day_close_reconciles_opening_receipts_refunds_and_adjustments(database):
    con, schema, people = database
    await advance_payment(con, people, amount=500_000)          # cash receipt today
    payment2 = await advance_payment(con, people, amount=300_000)
    refund, _ = await ledger.request_refund(con, actor_user_id=people['admin'],
                                            payment_id=payment2['id'], amount_minor=200_000,
                                            reason='Returned to family')
    await ledger.approve_refund(con, actor_user_id=people['owner'], refund_id=refund['id'])
    await ledger.settle_refund(con, actor_user_id=people['admin'], refund_id=refund['id'])
    await ledger.add_cash_adjustment(con, actor_user_id=people['owner'], business_date=TODAY,
                                     amount_minor=-50_000, reason='Till correction, short count')

    # opening 100000 + receipts 800000 - refunds 200000 + adjustments (-50000) = 650000
    close = await ledger.close_day(con, actor_user_id=people['owner'], business_date=TODAY,
                                   counted_minor=650_000, opening_minor=100_000)
    assert close['opening_minor'] == 100_000
    assert close['receipts_minor'] == 800_000
    assert close['refunds_minor'] == 200_000
    assert close['adjustments_minor'] == -50_000
    assert close['expected_minor'] == 650_000
    assert close['variance_minor'] == 0


# ──── FIN-09: a replay is a replay only when every semantic key matches ────
@pytest.mark.asyncio
async def test_identical_retry_of_a_payment_is_a_duplicate(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    await posted_charge(con, people, contract=contract)
    first, _, dup = await ledger.record_payment(
        con, actor_user_id=people['admin'], student_user_id=people['student'],
        amount_minor=600_000, idempotency_key='KEY-1')
    assert dup is False
    second, _, dup = await ledger.record_payment(
        con, actor_user_id=people['admin'], student_user_id=people['student'],
        amount_minor=600_000, idempotency_key='KEY-1')
    assert dup is True and second['id'] == first['id']
    assert await con.fetchval('SELECT count(*) FROM tuition_payments') == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('changed,expected', [
    ({'amount_minor': 100_000}, 'amountMinor'),
    ({'student': 'other_student'}, 'studentUserId'),
    ({'method': 'bank'}, 'method'),
    ({'occurred': 'other_period'}, 'occurredAt'),
])
async def test_reusing_an_idempotency_key_for_a_different_event_is_refused(database, changed,
                                                                           expected):
    """A retry that is not the same event must not be silently swallowed."""
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    await posted_charge(con, people, contract=contract)
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=600_000,
                                idempotency_key='KEY-REUSE')
    kwargs = {'student_user_id': people[changed['student']] if 'student' in changed
              else people['student'],
              'amount_minor': changed.get('amount_minor', 600_000),
              'method': changed.get('method', 'cash')}
    if changed.get('occurred') == 'other_period':
        kwargs['occurred_at'] = datetime.now(timezone.utc) - timedelta(days=400)
    with pytest.raises(LedgerError) as exc:
        await ledger.record_payment(con, actor_user_id=people['admin'],
                                    idempotency_key='KEY-REUSE', **kwargs)
    assert exc.value.code == 'idempotency_conflict'
    assert exc.value.status == 409
    assert expected in exc.value.details['mismatched'], exc.value.details
    # The original payment is untouched and no second row appeared.
    assert await con.fetchval('SELECT count(*) FROM tuition_payments') == 1
    assert await con.fetchval('SELECT count(*) FROM tuition_payment_allocations') == 1


@pytest.mark.asyncio
async def test_a_provider_reference_cannot_be_reused_for_a_different_amount(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    await posted_charge(con, people, contract=contract)
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=600_000,
                                method='provider', provider='payme',
                                provider_transaction_id='PAYME-DUP', idempotency_key='IDEM-DUP')
    with pytest.raises(LedgerError) as exc:
        await ledger.record_payment(con, actor_user_id=people['admin'],
                                    student_user_id=people['student'], amount_minor=999_999,
                                    method='provider', provider='payme',
                                    provider_transaction_id='PAYME-DUP', idempotency_key='IDEM-DUP')
    assert exc.value.code == 'idempotency_conflict'
    assert 'amountMinor' in exc.value.details['mismatched']
    assert await con.fetchval('SELECT count(*) FROM tuition_payments') == 1


@pytest.mark.asyncio
async def test_a_replayed_provider_refund_id_with_a_different_amount_is_refused(database):
    con, schema, people = database
    payment = await advance_payment(con, people, amount=700_000)
    first, duplicate = await ledger.request_refund(
        con, actor_user_id=people['admin'], payment_id=payment['id'], amount_minor=100_000,
        reason='Withdrawal', provider_refund_id='CLICK-R9')
    assert duplicate is False
    again, duplicate = await ledger.request_refund(
        con, actor_user_id=people['admin'], payment_id=payment['id'], amount_minor=100_000,
        reason='Withdrawal', provider_refund_id='CLICK-R9')
    assert duplicate is True and again['id'] == first['id']
    with pytest.raises(LedgerError) as exc:
        await ledger.request_refund(con, actor_user_id=people['admin'],
                                    payment_id=payment['id'], amount_minor=250_000,
                                    reason='Withdrawal', provider_refund_id='CLICK-R9')
    assert exc.value.code == 'idempotency_conflict'
    assert 'amountMinor' in exc.value.details['mismatched']
    assert await con.fetchval('SELECT count(*) FROM tuition_refunds') == 1


# ────────── FIN-10: every reported figure reconciles to its own source ──────────
@pytest.mark.asyncio
async def test_collection_is_reported_per_payment_method(database):
    """`collectedCashMinor` means CASH. Bank and provider money are different numbers."""
    con, schema, people = database
    # A 400,000 obligation against 500,000 collected: 100,000 stays an advance so the refund
    # half of this test has something legitimately refundable.
    contract = await approved_contract(con, people, monthly=400_000)
    await posted_charge(con, people, gross=400_000, contract=contract)
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=250_000,
                                method='cash')
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=150_000,
                                method='bank')
    provider = await advance_payment(con, people, amount=100_000, method='provider')

    summary = await ledger.finance_summary(con, start=TODAY - timedelta(days=60),
                                           end=TODAY + timedelta(days=60))
    assert summary['collectedCashMinor'] == 250_000
    assert summary['collectedBankMinor'] == 150_000
    assert summary['collectedProviderMinor'] == 100_000
    assert summary['collectedTotalMinor'] == 500_000
    assert summary['collectedNetMinor'] == 500_000, 'no refunds yet'

    # A settled refund reduces net settled, never the gross method totals.
    refund, _ = await ledger.request_refund(con, actor_user_id=people['admin'],
                                            payment_id=provider['id'], amount_minor=100_000,
                                            reason='Family withdrew')
    await ledger.approve_refund(con, actor_user_id=people['owner'], refund_id=refund['id'])
    await ledger.settle_refund(con, actor_user_id=people['admin'], refund_id=refund['id'])
    summary = await ledger.finance_summary(con, start=TODAY - timedelta(days=60),
                                           end=TODAY + timedelta(days=60))
    assert summary['collectedTotalMinor'] == 500_000
    assert summary['refundsMinor'] == 100_000
    assert summary['collectedNetMinor'] == 400_000


@pytest.mark.asyncio
async def test_provider_fees_are_an_expense_not_a_collection(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    await posted_charge(con, people, contract=contract)
    await advance_payment(con, people, amount=500_000, method='provider')
    await ledger.record_provider_fee(con, actor_user_id=people['owner'], amount_minor=7_500,
                                     provider='payme', memo='Payme commission 1.5%')
    summary = await ledger.finance_summary(con, start=TODAY - timedelta(days=60),
                                           end=TODAY + timedelta(days=60))
    assert summary['providerFeesMinor'] == 7_500
    assert summary['collectedProviderMinor'] == 500_000, 'a fee is not a collection'
    assert await balances(con, 'payment_fees_expense') == 7_500
    assert (await ledger.journal_is_balanced(con))['balanced'] is True


@pytest.mark.asyncio
async def test_summary_day_boundaries_follow_asia_tashkent(database):
    """23:30 UTC on the 13th is 04:30 on the 14th in Tashkent - it belongs to the 14th."""
    con, schema, people = database
    late_utc = datetime(2026, 11, 13, 23, 30, tzinfo=timezone.utc)
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=120_000,
                                occurred_at=late_utc)
    tashkent_day = date(2026, 11, 14)
    summary = await ledger.finance_summary(con, start=tashkent_day, end=tashkent_day)
    assert summary['collectedCashMinor'] == 120_000, summary
    previous = await ledger.finance_summary(con, start=date(2026, 11, 13),
                                            end=date(2026, 11, 13))
    assert previous['collectedCashMinor'] == 0
    assert summary['calendar'] == 'Asia/Tashkent'


@pytest.mark.asyncio
async def test_every_reported_figure_reconciles_to_its_source(database):
    """The dashboard must not be a parallel arithmetic of its own."""
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    await posted_charge(con, people, contract=contract)
    await posted_charge(con, people, student=people['other_student'], gross=500_000,
                        due=TODAY - timedelta(days=40))
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=250_000)
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=150_000,
                                method='bank')
    await ledger.recognize_revenue(con, actor_user_id=people['owner'],
                                   student_user_id=people['student'], amount_minor=300_000)
    start, end = TODAY - timedelta(days=60), TODAY + timedelta(days=60)
    recon = await ledger.reconcile_summary(con, start=start, end=end)
    assert recon['ok'] is True, recon
    assert recon['checks'], 'nothing was actually reconciled'
    assert all(item['matches'] for item in recon['checks']), recon['checks']
    reconciled = {item['field'] for item in recon['checks']}
    for field in ('collectedCashMinor', 'collectedBankMinor', 'collectedProviderMinor',
                  'refundsMinor', 'invoicedTuitionMinor', 'creditedTuitionMinor',
                  'recognizedRevenueMinor', 'outstandingReceivableMinor',
                  'customerAdvanceMinor'):
        assert field in reconciled, f'{field} is reported but never reconciled'


@pytest.mark.asyncio
async def test_owner_debt_and_student_debt_use_the_same_filter(database):
    """The dashboard total must equal the sum of the per-student positions it summarises."""
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    await posted_charge(con, people, contract=contract)
    await posted_charge(con, people, student=people['other_student'], gross=500_000,
                        due=TODAY - timedelta(days=40))
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=250_000)
    note = await ledger.create_credit_note(con, actor_user_id=people['admin'],
                                           charge_id=(await con.fetchval(
                                               'SELECT id FROM tuition_charges LIMIT 1')),
                                           amount_minor=50_000, reason='Goodwill')
    await ledger.approve_credit_note(con, actor_user_id=people['owner'],
                                     credit_note_id=note['id'])
    await ledger.post_credit_note(conn=con, actor_user_id=people['owner'],
                                  credit_note_id=note['id'])
    summary = await ledger.finance_summary(con, start=TODAY - timedelta(days=60),
                                           end=TODAY + timedelta(days=60))
    positions = [await ledger.student_position(con, sid)
                 for sid in (people['student'], people['other_student'])]
    per_student = sum(position['balanceDueMinor'] for position in positions)
    assert summary['outstandingReceivableMinor'] == per_student, (
        summary['outstandingReceivableMinor'], per_student)
    assert summary['overdueReceivableMinor'] == sum(
        position['overdueMinor'] for position in positions)


# ─────── FIN-11: the contract price is the price, and approved terms do not move ───────
@pytest.mark.asyncio
async def test_a_charge_cannot_contradict_the_approved_contract_price(database):
    """800,000 a month is the approved term; billing 900,000 needs an authorized adjustment."""
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    with pytest.raises(LedgerError) as exc:
        await ledger.create_charge(con, actor_user_id=people['admin'],
                                   student_user_id=people['student'], period=PERIOD,
                                   due_date=TODAY, gross_amount_minor=900_000,
                                   contract_id=contract['id'])
    assert exc.value.code == 'charge_amount_conflicts_with_contract'
    assert exc.value.status == 409
    assert exc.value.details['contractMinor'] == 800_000
    assert await con.fetchval('SELECT count(*) FROM tuition_charges') == 0

    # With an explicit, recorded reason the adjustment is allowed and auditable.
    charge = await ledger.create_charge(con, actor_user_id=people['admin'],
                                        student_user_id=people['student'], period=PERIOD,
                                        due_date=TODAY, gross_amount_minor=900_000,
                                        contract_id=contract['id'],
                                        adjustment_reason='Extra intensive module, agreed 12.11')
    assert charge['gross_amount_minor'] == 900_000
    audit = await con.fetchrow(
        "SELECT action, reason FROM finance_audit_events"
        " WHERE action='contract_price_adjustment'")
    assert audit is not None, 'an off-contract price left no audit trail'
    assert 'Extra intensive module' in audit['reason']


@pytest.mark.asyncio
async def test_approved_contract_terms_are_immutable(database):
    """The database refuses a price change after approval; the application cannot opt out."""
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    for column, value in (('monthly_amount_minor', 1_000_000), ('term_months', 24),
                          ('currency_code', 'USD')):
        with pytest.raises(asyncpg.PostgresError):
            await con.execute(f'UPDATE tuition_contracts SET {column}=$2 WHERE id=$1',
                              contract['id'], value)
    row = await con.fetchrow('SELECT monthly_amount_minor, term_months, currency_code'
                             ' FROM tuition_contracts WHERE id=$1', contract['id'])
    assert (row['monthly_amount_minor'], row['term_months'], row['currency_code']) == (
        800_000, 1, 'UZS')
    # A draft is still editable: the freeze starts at approval, not at creation.
    draft = await ledger.create_contract(con, actor_user_id=people['owner'],
                                         student_user_id=people['student'],
                                         monthly_amount_minor=500_000, starts_on=TODAY)
    await con.execute('UPDATE tuition_contracts SET monthly_amount_minor=$2 WHERE id=$1',
                      draft['id'], 550_000)
    assert await con.fetchval('SELECT monthly_amount_minor FROM tuition_contracts WHERE id=$1',
                              draft['id']) == 550_000


# ───── FIN-12: balance is per currency, and an empty entry is not balanced activity ─────
async def _raw_lines(con, entry, lines, transaction_id=None):
    """Insert journal lines as ONE transaction.

    The 1115 balance guard is a DEFERRABLE constraint trigger, so it fires at COMMIT: an
    intermediate half-written entry is legal inside a transaction and illegal outside one.
    Posted lines can never be edited afterwards (append-only trigger), so any broken state a
    test wants to examine has to be created here, at insert time.
    """
    async with con.transaction():
        for account, direction, amount, currency in lines:
            await con.execute(
                'INSERT INTO finance_journal_lines (transaction_id, entry_id, account_id,'
                ' direction, amount_minor, currency_code) VALUES ($1,$2,(SELECT id FROM'
                " finance_accounts WHERE code=$3),$4,$5,$6)",
                transaction_id or entry['transaction_id'], entry['id'], account, direction,
                amount, currency)


async def _raw_entry(con, source_type='manual'):
    # source_id is NOT NULL: a journal entry always names the document behind it, which is
    # itself part of what makes an entry auditable.
    return await con.fetchrow(
        'INSERT INTO finance_journal_entries (transaction_id, source_type, source_id, memo)'
        ' VALUES (gen_random_uuid(),$1,gen_random_uuid(),$2) RETURNING id, transaction_id',
        source_type, 'injected for a balance test')


@pytest.mark.asyncio
async def test_a_journal_entry_must_balance_within_each_currency(database):
    """A USD debit and a UZS credit sum to the same total and are still nonsense."""
    con, schema, people = database
    entry = await _raw_entry(con)
    # The 1115 guard only compares debit and credit TOTALS, so this commits: it is exactly the
    # mixed-currency case that a summed check waves through and a per-currency check catches.
    await _raw_lines(con, entry, [('accounts_receivable', 'debit', 100_000, 'USD'),
                                  ('tuition_revenue', 'credit', 100_000, 'UZS')])
    result = await ledger.journal_is_balanced(con)
    assert result['balanced'] is False, 'mixed-currency totals were treated as balanced'
    assert str(entry['transaction_id']) in result['unbalanced']
    assert any(item['currency'] == 'USD' for item in result['detail']
               if item['transactionId'] == str(entry['transaction_id']))


@pytest.mark.asyncio
async def test_an_empty_or_underlinked_entry_is_not_balanced_business_activity(database):
    con, schema, people = database
    empty = await _raw_entry(con)
    underlinked = await _raw_entry(con)
    # A balanced pair hanging off `underlinked`'s entry but stamped with a transaction id
    # that belongs to no entry: the database guard sees a balanced group and passes it, while
    # the entry itself is not part of any reconcilable transaction.
    await _raw_lines(con, underlinked,
                     [('accounts_receivable', 'debit', 50_000, 'UZS'),
                      ('tuition_revenue', 'credit', 50_000, 'UZS')],
                     transaction_id=uuid4())

    result = await ledger.journal_is_balanced(con)
    assert result['balanced'] is False
    assert str(empty['transaction_id']) in result['unbalanced']
    assert str(underlinked['transaction_id']) in result['unbalanced']
    assert {item['reason'] for item in result['detail']} & {'no_lines', 'line_transaction_mismatch'}


@pytest.mark.asyncio
async def test_a_clean_ledger_reports_zero_unbalanced_and_says_what_it_checked(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    await posted_charge(con, people, contract=contract)
    await ledger.record_payment(con, actor_user_id=people['admin'],
                                student_user_id=people['student'], amount_minor=800_000)
    result = await ledger.journal_is_balanced(con)
    assert result['balanced'] is True and result['unbalanced'] == []
    assert result['transactions'] == 2 and result['currencies'] == ['UZS']
    assert result['detail'] == []


# ──────────── FIN-12: every sensitive money action leaves an audit record ────────────
@pytest.mark.asyncio
async def test_each_sensitive_financial_action_is_audited(database):
    con, schema, people = database
    contract = await ledger.create_contract(con, actor_user_id=people['owner'],
                                            student_user_id=people['student'],
                                            monthly_amount_minor=800_000, starts_on=TODAY)
    # A discount attaches to an approved contract, so approval comes first.
    contract = await ledger.approve_contract(con, actor_user_id=people['owner'],
                                             contract_id=contract['id'])
    await ledger.activate_contract(con, actor_user_id=people['owner'], contract_id=contract['id'])
    await ledger.add_discount(con, actor_user_id=people['owner'], contract_id=contract['id'],
                              period=PERIOD, amount_minor=100_000, reason='Sibling discount')
    charge = await ledger.create_charge(con, actor_user_id=people['admin'],
                                        student_user_id=people['student'], period=PERIOD,
                                        due_date=TODAY, gross_amount_minor=800_000,
                                        contract_id=contract['id'])
    await ledger.approve_charge(con, actor_user_id=people['owner'], charge_id=charge['id'])
    await ledger.post_charge(con, actor_user_id=people['admin'], charge_id=charge['id'])
    payment, _, _ = await ledger.record_payment(con, actor_user_id=people['admin'],
                                                student_user_id=people['student'],
                                                amount_minor=900_000)
    refund, _ = await ledger.request_refund(con, actor_user_id=people['admin'],
                                            payment_id=payment['id'], amount_minor=100_000,
                                            reason='Family withdrew')
    await ledger.approve_refund(con, actor_user_id=people['owner'], refund_id=refund['id'])
    await ledger.settle_refund(con, actor_user_id=people['admin'], refund_id=refund['id'])
    await ledger.add_cash_adjustment(con, actor_user_id=people['owner'], business_date=TODAY,
                                     amount_minor=-5_000, reason='Till correction')
    await ledger.close_day(con, actor_user_id=people['owner'], business_date=TODAY,
                           counted_minor=795_000)
    await ledger.close_period(con, actor_user_id=people['owner'], period=PERIOD,
                              reason='Month closed')

    audited = {row['action'] for row in await con.fetch('SELECT action FROM finance_audit_events')}
    for action in ('contract_created', 'discount_added', 'contract_approved', 'charge_created',
                   'charge_approved', 'charge_posted', 'payment_recorded', 'refund_requested',
                   'refund_approved', 'refund_settled', 'cash_adjustment_added', 'day_closed',
                   'period_closed'):
        assert action in audited, f'{action} was not audited; audited={sorted(audited)}'
    # Every audit row names the actor that did it.
    assert await con.fetchval(
        'SELECT count(*) FROM finance_audit_events WHERE actor_user_id IS NULL') == 0


@pytest.mark.asyncio
async def test_settling_provider_money_publishes_an_outbox_event_in_the_same_transaction(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=800_000)
    await posted_charge(con, people, contract=contract)
    payment, _, _ = await ledger.record_payment(
        con, actor_user_id=people['admin'], student_user_id=people['student'],
        amount_minor=800_000, method='provider', provider='payme',
        provider_transaction_id='PAYME-OUTBOX', idempotency_key='order-outbox')
    proof = ledger.provider_proof(amount_minor=800_000, currency='UZS', status='paid',
                                  order_ref='order-outbox', student_user_id=people['student'])
    await ledger.confirm_provider_payment(con, provider='payme',
                                          provider_transaction_id='PAYME-OUTBOX', proof=proof)
    events = await con.fetch('SELECT topic, aggregate_type, payload, published_at'
                             ' FROM finance_outbox_events')
    assert len(events) == 1, 'a settled provider payment published no external event'
    assert events[0]['topic'] == 'provider.settled'
    assert events[0]['aggregate_type'] == 'tuition_payment'
    assert events[0]['published_at'] is None, 'nothing has been delivered yet'
    # A replay must not publish a second event.
    await ledger.confirm_provider_payment(con, provider='payme',
                                          provider_transaction_id='PAYME-OUTBOX', proof=proof)
    assert await con.fetchval('SELECT count(*) FROM finance_outbox_events') == 1


@pytest.mark.asyncio
async def test_floats_are_rejected_for_money(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    with pytest.raises(LedgerError) as refused:
        await ledger.record_payment(con, actor_user_id=people['admin'],
                                    student_user_id=people['student'], amount_minor=250_000.5)
    assert refused.value.code == 'amount_must_be_integer_minor_units'
    assert await con.fetchval('SELECT count(*) FROM tuition_payments') == 0


# ──────────────────── Accounting invariant regressions ────────────────────
@pytest.mark.asyncio
async def test_credit_note_reduces_allocation_and_preserves_overpayment(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=600_000)
    charge = await posted_charge(con, people, gross=600_000, contract=contract)
    note = await ledger.create_credit_note(
        con, actor_user_id=people['admin'], charge_id=charge['id'],
        amount_minor=100_000, reason='Approved tuition relief')
    await ledger.approve_credit_note(
        con, actor_user_id=people['owner'], credit_note_id=note['id'])
    await ledger.post_credit_note(
        con, actor_user_id=people['owner'], credit_note_id=note['id'])

    payment, allocations, duplicate = await ledger.record_payment(
        con, actor_user_id=people['admin'], student_user_id=people['student'],
        amount_minor=550_000)
    assert not duplicate
    assert [row['amount_minor'] for row in allocations] == [500_000]
    assert payment['amount_minor'] == 550_000

    position = await ledger.student_position(con, people['student'])
    assert position['balanceDueMinor'] == 0
    assert position['advanceMinor'] == 50_000
    assert position['creditedMinor'] == 100_000
    assert await balances(con, 'accounts_receivable') == 0
    assert await balances(con, 'customer_advance') == -50_000
    assert (await ledger.journal_is_balanced(con))['balanced']
    recon = await ledger.reconcile_summary(
        con, start=TODAY - timedelta(days=1), end=TODAY + timedelta(days=1))
    assert recon['ok'], recon


@pytest.mark.asyncio
async def test_credit_note_after_allocation_requires_obligation_correction(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=600_000)
    charge = await posted_charge(con, people, gross=600_000, contract=contract)
    await ledger.record_payment(
        con, actor_user_id=people['admin'], student_user_id=people['student'],
        amount_minor=550_000)
    with pytest.raises(LedgerError) as exc:
        await ledger.create_credit_note(
            con, actor_user_id=people['admin'], charge_id=charge['id'],
            amount_minor=100_000, reason='Late tuition relief')
    assert exc.value.code == 'credit_exceeds_unallocated_charge'
    assert exc.value.details['unallocatedMinor'] == 50_000

    # A draft entered before payment cannot evade the cap when it is finally posted.
    # A separate charge is used because the existing one is already mostly paid.
    second_charge = await posted_charge(
        con, people, student=people['other_student'], gross=600_000)
    draft = await ledger.create_credit_note(
        con, actor_user_id=people['admin'], charge_id=second_charge['id'],
        amount_minor=200_000, reason='Relief drafted before collection')
    await ledger.approve_credit_note(
        con, actor_user_id=people['owner'], credit_note_id=draft['id'])
    await ledger.record_payment(
        con, actor_user_id=people['admin'], student_user_id=people['other_student'],
        amount_minor=500_000)
    with pytest.raises(LedgerError) as exc:
        await ledger.post_credit_note(
            con, actor_user_id=people['owner'], credit_note_id=draft['id'])
    assert exc.value.code == 'credit_note_conflicts_with_allocations'
    assert await balances(con, 'accounts_receivable') == 150_000


@pytest.mark.asyncio
async def test_pending_failed_and_rejected_refunds_leave_settled_position_unchanged(database):
    con, schema, people = database
    payment = await advance_payment(con, people)
    initial = await ledger.student_position(con, people['student'])
    assert initial['advanceMinor'] == 700_000
    refund, _ = await ledger.request_refund(
        con, actor_user_id=people['admin'], payment_id=payment['id'],
        amount_minor=100_000, reason='Pending withdrawal')

    for status in ('requested', 'approved', 'failed'):
        if status == 'approved':
            await ledger.approve_refund(
                con, actor_user_id=people['owner'], refund_id=refund['id'])
        if status == 'failed':
            await ledger.fail_refund(
                con, actor_user_id=people['admin'], refund_id=refund['id'],
                reason='Bank refused transfer')
        position = await ledger.student_position(con, people['student'])
        assert position['advanceMinor'] == 700_000
        assert position['refundedMinor'] == 0

    rejected, _ = await ledger.request_refund(
        con, actor_user_id=people['admin'], payment_id=payment['id'],
        amount_minor=100_000, reason='Second request')
    await ledger.reject_refund(
        con, actor_user_id=people['owner'], refund_id=rejected['id'],
        reason='Insufficient verification')
    position = await ledger.student_position(con, people['student'])
    assert position['advanceMinor'] == 700_000
    assert position['refundedMinor'] == 0
    assert await balances(con, 'cash_on_hand') == 700_000


@pytest.mark.asyncio
async def test_partial_then_full_refund_tracks_net_settled_funds(database):
    con, schema, people = database
    payment = await advance_payment(con, people)
    for amount, expected_status, expected_advance in (
        (100_000, 'partially_refunded', 600_000),
        (600_000, 'refunded', 0),
    ):
        refund, _ = await ledger.request_refund(
            con, actor_user_id=people['admin'], payment_id=payment['id'],
            amount_minor=amount, reason='Authorized withdrawal')
        await ledger.approve_refund(
            con, actor_user_id=people['owner'], refund_id=refund['id'])
        await ledger.settle_refund(
            con, actor_user_id=people['admin'], refund_id=refund['id'])
        status = await con.fetchval(
            'SELECT status FROM tuition_payments WHERE id=$1', payment['id'])
        assert status == expected_status
        position = await ledger.student_position(con, people['student'])
        assert position['advanceMinor'] == expected_advance
        assert position['refundedMinor'] == 700_000 - expected_advance
        assert await balances(con, 'cash_on_hand') == expected_advance
    with pytest.raises(LedgerError) as exc:
        await ledger.settle_refund(
            con, actor_user_id=people['admin'], refund_id=refund['id'])
    assert exc.value.code == 'refund_already_settled'
    assert (await ledger.journal_is_balanced(con))['balanced']


@pytest.mark.asyncio
async def test_business_date_and_cash_close_ignore_database_session_timezone(database):
    con, schema, people = database
    instant = datetime(2026, 10, 31, 20, 15, tzinfo=timezone.utc)
    assert ledger.business_date(instant) == date(2026, 11, 1)
    assert ledger.period_key(instant) == '2026-11'
    await con.execute("SET TIME ZONE 'America/New_York'")
    try:
        payment, allocations, _ = await ledger.record_payment(
            con, actor_user_id=people['admin'], student_user_id=people['student'],
            amount_minor=100_000, occurred_at=instant)
        assert allocations == []
        assert payment['receipt_no'].startswith('RC-202611')
        summary = await ledger.finance_summary(
            con, start=date(2026, 11, 1), end=date(2026, 11, 1))
        assert summary['collectedCashMinor'] == 100_000
        closed = await ledger.close_day(
            con, actor_user_id=people['owner'],
            business_date=date(2026, 11, 1), counted_minor=100_000)
        assert closed['receipts_minor'] == 100_000
        assert closed['expected_minor'] == 100_000
    finally:
        await con.execute("SET TIME ZONE 'UTC'")


@pytest.mark.asyncio
async def test_credit_note_and_payment_race_preserves_nonnegative_receivable(database):
    con, schema, people = database
    contract = await approved_contract(con, people, monthly=600_000)
    charge = await posted_charge(con, people, gross=600_000, contract=contract)
    note = await ledger.create_credit_note(
        con, actor_user_id=people['admin'], charge_id=charge['id'],
        amount_minor=100_000, reason='Race correction')
    await ledger.approve_credit_note(
        con, actor_user_id=people['owner'], credit_note_id=note['id'])
    other = await asyncpg.connect(
        DSN, server_settings={'search_path': f'"{schema}", public'})
    try:
        posting, payment = await asyncio.gather(
            ledger.post_credit_note(
                con, actor_user_id=people['owner'], credit_note_id=note['id']),
            ledger.record_payment(
                other, actor_user_id=people['admin'],
                student_user_id=people['student'], amount_minor=550_000),
            return_exceptions=True)
        assert not isinstance(payment, Exception), payment
        if isinstance(posting, Exception):
            assert isinstance(posting, LedgerError)
            assert posting.code == 'credit_note_conflicts_with_allocations'
        position = await ledger.student_position(con, people['student'])
        assert position['receivableMinor'] >= 0
        assert position['advanceMinor'] >= 0
        assert position['allocatedMinor'] + position['creditedMinor'] <= 600_000
        assert (await ledger.journal_is_balanced(con))['balanced']
    finally:
        await other.close()


@pytest.mark.asyncio
async def test_credit_note_posts_in_current_period_when_original_period_is_closed(database):
    con, schema, people = database
    old_day = TODAY.replace(day=1) - timedelta(days=1)
    old_period = ledger.period_key(old_day)
    charge = await ledger.create_charge(
        con, actor_user_id=people['admin'], student_user_id=people['student'],
        period=old_period, due_date=old_day, gross_amount_minor=600_000)
    await ledger.approve_charge(con, actor_user_id=people['owner'], charge_id=charge['id'])
    await ledger.post_charge(con, actor_user_id=people['admin'], charge_id=charge['id'])
    await ledger.close_period(con, actor_user_id=people['owner'], period=old_period)
    note = await ledger.create_credit_note(
        con, actor_user_id=people['admin'], charge_id=charge['id'],
        amount_minor=100_000, reason='Correction after month close')
    await ledger.approve_credit_note(
        con, actor_user_id=people['owner'], credit_note_id=note['id'])
    posted = await ledger.post_credit_note(
        con, actor_user_id=people['admin'], credit_note_id=note['id'])

    assert posted['period_key'] == old_period
    assert await con.fetchval(
        "SELECT period_key FROM finance_journal_entries WHERE source_type='credit_note'"
        " AND source_id=$1", posted['id']) == PERIOD
    with pytest.raises(LedgerError) as exc:
        await ledger.reverse_charge(
            con, actor_user_id=people['owner'], charge_id=charge['id'],
            reason='Would double-count the correction')
    assert exc.value.code == 'charge_has_credit_notes'
    assert await balances(con, 'accounts_receivable') == 500_000


@pytest.mark.asyncio
async def test_refund_settlement_updates_business_date_and_statement(database):
    con, schema, people = database
    payment = await advance_payment(con, people, days_ago=60)
    refund, _ = await ledger.request_refund(
        con, actor_user_id=people['admin'], payment_id=payment['id'],
        amount_minor=100_000, reason='Settlement after review')
    earlier = TODAY - timedelta(days=3)
    await con.execute(
        'UPDATE tuition_refunds SET effective_on=$2, effective_period=$3 WHERE id=$1',
        refund['id'], earlier, ledger.period_key(earlier))
    await ledger.close_day(
        con, actor_user_id=people['owner'], business_date=earlier, counted_minor=0)
    await ledger.approve_refund(
        con, actor_user_id=people['owner'], refund_id=refund['id'])
    settled = await ledger.settle_refund(
        con, actor_user_id=people['admin'], refund_id=refund['id'])
    assert settled['effective_on'] == TODAY
    assert settled['effective_period'] == PERIOD
    statement = await ledger.student_statement(con, people['student'])
    assert statement['refunds'][0]['status'] == 'settled'
    assert statement['refunds'][0]['effective_on'] == TODAY
    summary = await ledger.finance_summary(con, start=TODAY, end=TODAY)
    assert summary['refundsMinor'] == 100_000
    assert (await ledger.reconcile_summary(con, start=TODAY, end=TODAY))['ok']


@pytest.mark.asyncio
async def test_refund_cash_close_race_keeps_closed_day_consistent(database):
    con, schema, people = database
    payment = await advance_payment(con, people)
    refund, _ = await ledger.request_refund(
        con, actor_user_id=people['admin'], payment_id=payment['id'],
        amount_minor=100_000, reason='Concurrent close')
    await ledger.approve_refund(
        con, actor_user_id=people['owner'], refund_id=refund['id'])
    other = await asyncpg.connect(
        DSN, server_settings={'search_path': f'"{schema}", public'})
    try:
        settled, close = await asyncio.gather(
            ledger.settle_refund(con, actor_user_id=people['admin'], refund_id=refund['id']),
            ledger.close_day(
                other, actor_user_id=people['owner'], business_date=TODAY,
                counted_minor=600_000),
            return_exceptions=True)
        assert not isinstance(close, Exception), close
        if isinstance(settled, Exception):
            assert isinstance(settled, LedgerError)
            assert settled.code == 'day_closed'
            assert close['refunds_minor'] == 0
            assert close['expected_minor'] == 700_000
        else:
            assert close['refunds_minor'] == 100_000
            assert close['expected_minor'] == 600_000
        assert await balances(con, 'cash_on_hand') == close['expected_minor']
    finally:
        await other.close()


@pytest.mark.asyncio
async def test_provider_collection_is_reported_on_confirmation_day(database):
    con, schema, people = database
    earlier = datetime.now(timezone.utc) - timedelta(days=3)
    payment, _, _ = await ledger.record_payment(
        con, actor_user_id=people['admin'], student_user_id=people['student'],
        amount_minor=100_000, method='provider', provider='payme',
        provider_transaction_id='REPORT-DATE', occurred_at=earlier)
    await ledger.confirm_provider_payment(
        con, provider='payme', provider_transaction_id='REPORT-DATE',
        proof=ledger.provider_proof(
            amount_minor=100_000, currency='UZS', status='paid',
            student_user_id=payment['student_user_id']))
    old_day = ledger.business_date(earlier)
    old = await ledger.finance_summary(con, start=old_day, end=old_day)
    current = await ledger.finance_summary(con, start=TODAY, end=TODAY)
    assert old['collectedProviderMinor'] == 0
    assert current['collectedProviderMinor'] == 100_000
    assert (await ledger.reconcile_summary(con, start=TODAY, end=TODAY))['ok']
