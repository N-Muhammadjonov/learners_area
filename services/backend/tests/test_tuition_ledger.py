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
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio

from app import tuition_ledger as ledger
from app.tuition_ledger import LedgerError

DSN = "postgresql://coin_qa:coin_qa_local@127.0.0.1:55439/coin_qa"
MIGRATION = Path(__file__).resolve().parents[1] / "migrations/1115_tuition_finance.sql"
TODAY = datetime.now(timezone.utc).date()
PERIOD = ledger.period_key(TODAY)


@pytest_asyncio.fixture
async def database():
    try:
        con = await asyncpg.connect(DSN)
    except OSError as exc:
        if os.getenv('CI'):
            raise
        pytest.xfail(f'Disposable Postgres at 127.0.0.1:55439 unavailable: {type(exc).__name__}')
    schema = "tuition_test_" + uuid4().hex
    await con.execute(f'CREATE SCHEMA "{schema}"')
    await con.execute(f'SET search_path TO "{schema}", public')
    for role in ("anon", "authenticated", "service_role"):
        if not await con.fetchval("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1)", role):
            await con.execute(f'CREATE ROLE "{role}"')
    await con.execute(f'ALTER DEFAULT PRIVILEGES IN SCHEMA "{schema}"'
                      ' GRANT ALL ON TABLES TO anon,authenticated,service_role')
    await con.execute("""CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text, email text, role text DEFAULT 'student', account_status text DEFAULT 'active',
        locale text DEFAULT 'uz', onboarding_completed_at timestamptz, status_reason text,
        auth_version integer DEFAULT 0)""")
    await con.execute("CREATE TABLE courses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text)")
    for statement in MIGRATION.read_text().split('--> statement-breakpoint'):
        if statement.strip():
            await con.execute(statement)

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

    refund, duplicate = await ledger.refund_payment(
        con, actor_user_id=people['owner'], payment_id=payment['id'], amount_minor=100_000,
        reason='Overpayment returned to family', provider_refund_id='CLICK-R1')
    assert not duplicate and refund['amount_minor'] == 100_000
    # The original receipt is still there, unchanged, and the cash leg moved out.
    assert await con.fetchval('SELECT amount_minor FROM tuition_payments WHERE id=$1',
                              payment['id']) == 700_000
    assert await balances(con, 'cash_on_hand') + await balances(con, 'bank_clearing') == 600_000
    assert await balances(con, 'customer_advance') == 0

    # A repeated provider refund callback produces no second refund.
    _, duplicate = await ledger.refund_payment(
        con, actor_user_id=people['owner'], payment_id=payment['id'], amount_minor=100_000,
        reason='Overpayment returned to family', provider_refund_id='CLICK-R1')
    assert duplicate is True
    assert await con.fetchval('SELECT count(*) FROM tuition_refunds') == 1

    # Refunding money that is already applied to a charge is refused, not silently done.
    with pytest.raises(LedgerError) as refused:
        await ledger.refund_payment(con, actor_user_id=people['owner'], payment_id=payment['id'],
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
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)
    created = 0
    for _ in range(100):
        _, _, duplicate = await ledger.record_payment(
            con, actor_user_id=people['admin'], student_user_id=people['student'],
            amount_minor=600_000, method='provider', provider='payme',
            provider_transaction_id='PAYME-77', idempotency_key='idem-77')
        created += 0 if duplicate else 1
    assert created == 1
    assert await con.fetchval('SELECT count(*) FROM tuition_payments') == 1
    assert await con.fetchval('SELECT count(*) FROM tuition_payment_allocations') == 1
    assert await con.fetchval('SELECT count(*) FROM finance_journal_entries') == 2
    position = await ledger.student_position(con, people['student'])
    assert position['collectedMinor'] == 600_000 and position['balanceDueMinor'] == 0


@pytest.mark.asyncio
async def test_parallel_duplicate_callbacks_create_one_payment(database):
    """A real race: 20 connections submit the same provider confirmation at once."""
    con, schema, people = database
    contract = await approved_contract(con, people)
    await posted_charge(con, people, gross=800_000, discount=200_000, contract=contract)

    async def submit():
        other = await asyncpg.connect(DSN)
        try:
            await other.execute(f'SET search_path TO "{schema}", public')
            async with other.transaction():
                _, _, duplicate = await ledger.record_payment(
                    other, actor_user_id=people['admin'], student_user_id=people['student'],
                    amount_minor=600_000, method='provider', provider='payme',
                    provider_transaction_id='PAYME-RACE', idempotency_key='idem-race')
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
async def test_floats_are_rejected_for_money(database):
    con, schema, people = database
    contract = await approved_contract(con, people)
    with pytest.raises(LedgerError) as refused:
        await ledger.record_payment(con, actor_user_id=people['admin'],
                                    student_user_id=people['student'], amount_minor=250_000.5)
    assert refused.value.code == 'amount_must_be_integer_minor_units'
    assert await con.fetchval('SELECT count(*) FROM tuition_payments') == 0
