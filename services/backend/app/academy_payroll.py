"""Teacher compensation with a durable accrual and bank payout record."""
from __future__ import annotations

import calendar
import json
import re
from datetime import date, datetime, timezone
from fractions import Fraction
from hashlib import sha256
from typing import Annotated, Literal
from uuid import UUID, uuid4

from asyncpg import Connection, Record
from pydantic import BeforeValidator, Field, Strict, model_validator

from . import tuition_ledger as ledger
from .tuition_schemas import MoneyMinor, _Strict

Period = Annotated[str, Field(pattern=r'^[0-9]{4}-(0[1-9]|1[0-2])$')]
EventKind = Literal['adjustment', 'payout']


def parse_exact_minor(value):
    if isinstance(value, str) and re.fullmatch(r'-?[0-9]{1,19}', value):
        return int(value)
    return value


ExactMinor = Annotated[MoneyMinor, BeforeValidator(parse_exact_minor)]


class Rule(_Strict):
    commandId: UUID
    teacherUserId: UUID
    startsOn: date
    endsOn: date | None = None
    monthlyMinor: ExactMinor = 0
    sessionMinor: ExactMinor = 0
    hourlyMinor: ExactMinor = 0
    revenueBps: Annotated[int, Strict(), Field(ge=0, le=10_000)] = 0

    @model_validator(mode='after')
    def valid_terms(self):
        rates = self.monthlyMinor, self.sessionMinor, self.hourlyMinor, self.revenueBps
        if min(rates) < 0 or max(rates) <= 0 or self.sessionMinor and self.hourlyMinor:
            raise ValueError('Choose positive compensation and one variable rate at most')
        if self.endsOn and self.endsOn < self.startsOn:
            raise ValueError('End date precedes start date')
        return self


class EndRule(_Strict):
    endsOn: date


class RevenueSource(_Strict):
    teacherUserId: UUID
    sessionId: UUID
    journalTransactionId: UUID


class RunRequest(_Strict):
    teacherUserId: UUID
    periodKey: Period


class Finalize(RunRequest):
    expectedAmountMinor: ExactMinor
    expectedCalculation: str = Field(pattern=r'^[a-f0-9]{64}$')


class Event(_Strict):
    commandId: UUID
    kind: EventKind
    amountMinor: ExactMinor
    reference: str = Field(min_length=1, max_length=160)

    @model_validator(mode='after')
    def valid_amount(self):
        if self.amountMinor == 0 or self.kind == 'payout' and self.amountMinor < 0:
            raise ValueError('Enter a nonzero adjustment or a positive payout')
        return self


def month(period: str) -> tuple[date, date]:
    if not re.fullmatch(r'[0-9]{4}-(0[1-9]|1[0-2])', period):
        raise ledger.LedgerError('invalid_period', 422)
    year, number = map(int, period.split('-'))
    if year == 0:
        raise ledger.LedgerError('invalid_period', 422)
    return date(year, number, 1), date(year, number, calendar.monthrange(year, number)[1])


def round_minor(amount: Fraction) -> int:
    return (2 * amount.numerator + amount.denominator) // (2 * amount.denominator)


async def lock_teacher(conn: Connection, teacher: UUID) -> None:
    exists = await conn.fetchval(
        """SELECT 1 FROM users u WHERE u.id=$1 AND (u.role IN ('teacher','owner')
              OR EXISTS (SELECT 1 FROM academy_payroll_rules r WHERE r.teacher_user_id=u.id))
            FOR NO KEY UPDATE""", teacher)
    ledger._require(bool(exists), 'teacher_not_found', 404)


async def rules_for(conn: Connection, teacher: UUID) -> list[Record]:
    return await conn.fetch(
        'SELECT * FROM academy_payroll_rules WHERE teacher_user_id=$1 ORDER BY starts_on DESC LIMIT 121',
        teacher)


@ledger.transactional
async def create_rule(conn: Connection, actor: UUID, command: Rule) -> Record:
    await lock_teacher(conn, command.teacherUserId)
    await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,1126))", str(command.commandId))
    identity = fingerprint(command.model_dump(mode='json'))
    values = (command.teacherUserId, command.startsOn, command.endsOn, command.monthlyMinor,
              command.sessionMinor, command.hourlyMinor, command.revenueBps, actor, identity)
    old = await conn.fetchrow('SELECT * FROM academy_payroll_rules WHERE id=$1', command.commandId)
    if old:
        ledger._require(old['create_fingerprint'] == identity and old['created_by'] == actor,
                        'idempotency_conflict', 409)
        return old
    valid_role = await conn.fetchval("SELECT 1 FROM users WHERE id=$1 AND role IN ('teacher','owner')",
                                     command.teacherUserId)
    ledger._require(bool(valid_role), 'teacher_not_found', 404)
    existing = await rules_for(conn, command.teacherUserId)
    ledger._require(len(existing) < 120, 'payroll_rule_limit', 409)
    for rule in existing:
        overlaps = (command.endsOn is None or rule['starts_on'] <= command.endsOn) and (
            rule['ends_on'] is None or command.startsOn <= rule['ends_on'])
        ledger._require(not overlaps, 'payroll_rule_overlap', 409)
    await forbid_finalized(conn, command.teacherUserId, command.startsOn, command.endsOn)
    row = await conn.fetchrow(
        """INSERT INTO academy_payroll_rules(id,teacher_user_id,starts_on,ends_on,
                  monthly_minor,session_minor,hourly_minor,revenue_bps,created_by,create_fingerprint)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *""", command.commandId, *values)
    await ledger.audit_event(
        conn, actor_user_id=actor, action='payroll_rule_created', subject_type='payroll_rule',
        subject_id=row['id'], detail={'teacherUserId': command.teacherUserId,
                                     'terms': command.model_dump(mode='json')})
    return row


async def forbid_finalized(conn: Connection, teacher: UUID, first: date, last: date | None) -> None:
    frozen = await conn.fetchval(
        """SELECT 1 FROM academy_payroll_runs WHERE teacher_user_id=$1
            AND period_key >= $2 AND ($3::varchar IS NULL OR period_key <= $3) LIMIT 1""",
        teacher, ledger.period_key(first), ledger.period_key(last) if last else None)
    ledger._require(not frozen, 'payroll_already_finalized', 409)


@ledger.transactional
async def end_rule(conn: Connection, actor: UUID, rule_id: UUID, end: date) -> Record:
    rule = await conn.fetchrow('SELECT * FROM academy_payroll_rules WHERE id=$1', rule_id)
    ledger._require(rule is not None, 'payroll_rule_not_found', 404)
    teacher = rule['teacher_user_id']
    await lock_teacher(conn, teacher)
    rule = await conn.fetchrow('SELECT * FROM academy_payroll_rules WHERE id=$1', rule_id)
    previous = rule['ends_on']
    if previous == end:
        return rule
    ledger._require(end >= rule['starts_on'] and (previous is None or end < previous),
                    'payroll_rule_end_invalid', 422)
    if end < date.max:
        await forbid_finalized(conn, teacher, date.fromordinal(end.toordinal()+1), previous)
    row = await conn.fetchrow('UPDATE academy_payroll_rules SET ends_on=$2 WHERE id=$1 RETURNING *',
                              rule_id, end)
    await ledger.audit_event(conn, actor_user_id=actor, action='payroll_rule_ended',
                             subject_type='payroll_rule', subject_id=rule_id,
                             detail={'endsOn': end, 'previousEndsOn': previous})
    return row


@ledger.transactional
async def assign_revenue(conn: Connection, actor: UUID, command: RevenueSource) -> dict:
    teacher, session, txn = command.teacherUserId, command.sessionId, command.journalTransactionId
    await lock_teacher(conn, teacher)
    old = await conn.fetchrow('SELECT * FROM academy_payroll_revenue WHERE journal_transaction_id=$1', txn)
    if old:
        ledger._require((old['teacher_user_id'], old['session_id']) == (teacher, session),
                        'payroll_revenue_already_assigned', 409)
        return {'sessionId': str(session), 'journalTransactionId': str(txn), 'amountMinor': old['amount_minor']}
    eligible = await conn.fetchrow(
        """SELECT (s.starts_at AT TIME ZONE 'Asia/Tashkent')::date AS day,
                  sum(l.amount_minor)::bigint AS amount
             FROM academy_sessions s JOIN academy_session_teachers t ON t.session_id=s.id
             JOIN academy_attendance a ON a.session_id=s.id AND a.status IN ('present','late')
             JOIN finance_journal_entries e ON e.student_user_id=a.student_user_id
             JOIN finance_journal_lines l ON l.entry_id=e.id AND l.direction='credit'
             JOIN finance_accounts f ON f.id=l.account_id AND f.code='tuition_revenue'
            WHERE s.id=$1 AND t.teacher_user_id=$2 AND s.status='held'
              AND e.transaction_id=$3 AND e.source_type='revenue_recognition'
              AND e.period_key=to_char(s.starts_at AT TIME ZONE 'Asia/Tashkent','YYYY-MM')
            GROUP BY s.id""", session, teacher, txn)
    ledger._require(eligible is not None, 'payroll_revenue_ineligible', 422)
    day, amount = eligible['day'], eligible['amount']
    await ledger._lock_period(conn, ledger.period_key(day))
    await ledger._assert_period_open(conn, ledger.period_key(day))
    await forbid_finalized(conn, teacher, day, day)
    ledger._require(any(rule['revenue_bps'] and rule['starts_on'] <= day
                        and (rule['ends_on'] is None or rule['ends_on'] >= day)
                        for rule in await rules_for(conn, teacher)), 'payroll_revenue_rule_required', 409)
    inserted = await conn.fetchval(
        """INSERT INTO academy_payroll_revenue(journal_transaction_id,session_id,teacher_user_id,
                  amount_minor,assigned_by) VALUES($1,$2,$3,$4,$5)
           ON CONFLICT DO NOTHING RETURNING journal_transaction_id""", txn, session, teacher, amount, actor)
    ledger._require(inserted is not None, 'payroll_revenue_already_assigned', 409)
    await ledger.audit_event(conn, actor_user_id=actor, action='payroll_revenue_assigned',
                             subject_type='payroll_revenue', subject_id=txn, period=ledger.period_key(day),
                             amount_minor=amount, detail={'sessionId': session, 'teacherUserId': teacher})
    return {'sessionId': str(session), 'journalTransactionId': str(txn), 'amountMinor': amount}


async def calculate(conn: Connection, teacher: UUID, period: str) -> dict:
    start, end = month(period)
    rules = [rule for rule in await rules_for(conn, teacher)
             if rule['starts_on'] <= end and (not rule['ends_on'] or rule['ends_on'] >= start)]
    fixed = Fraction(0)
    for rule in rules:
        first = max(start, rule['starts_on'])
        last = min(end, rule['ends_on'] or end)
        fixed += Fraction(rule['monthly_minor'] * ((last-first).days+1), end.day)
    sessions = await conn.fetch(
        """SELECT s.id, (s.starts_at AT TIME ZONE 'Asia/Tashkent')::date AS day, s.status,
                  extract(epoch FROM s.ends_at-s.starts_at)::bigint AS seconds,
                  EXISTS (SELECT 1 FROM academy_attendance a WHERE a.session_id=s.id) AS roster,
                  EXISTS (SELECT 1 FROM academy_attendance a
                           WHERE a.session_id=s.id AND a.marked_at IS NULL) AS incomplete,
                  coalesce((SELECT jsonb_object_agg(r.journal_transaction_id::text,r.amount_minor)
                          FROM academy_payroll_revenue r
                         WHERE r.teacher_user_id=t.teacher_user_id AND r.session_id=s.id AND EXISTS (
                             SELECT 1 FROM finance_journal_entries e JOIN academy_attendance a
                               ON a.student_user_id=e.student_user_id AND a.session_id=s.id
                              AND a.status IN ('present','late')
                              WHERE e.transaction_id=r.journal_transaction_id)
                         ), '{}'::jsonb) AS revenue_transactions
             FROM academy_sessions s JOIN academy_session_teachers t ON t.session_id=s.id
            WHERE t.teacher_user_id=$1 AND s.status IN ('scheduled','held')
              AND s.starts_at >= (($2::date)::timestamp AT TIME ZONE 'Asia/Tashkent')
              AND s.starts_at < ((($3::date+1)::timestamp) AT TIME ZONE 'Asia/Tashkent')
            ORDER BY s.starts_at,s.id""", teacher, start, end)
    variable, revenue, items, pending = Fraction(0), Fraction(0), [], []
    for item in sessions:
        rule = next((r for r in rules if r['starts_on'] <= item['day']
                     and (not r['ends_on'] or r['ends_on'] >= item['day'])), None)
        if not rule or not (rule['session_minor'] or rule['hourly_minor'] or rule['revenue_bps']):
            continue
        if item['status'] != 'held' or not item['roster'] or item['incomplete']:
            pending.append(str(item['id']))
            continue
        variable += rule['session_minor'] or Fraction(rule['hourly_minor'] * item['seconds'], 3600)
        transactions = json.loads(item['revenue_transactions']) if rule['revenue_bps'] else {}
        revenue += Fraction(sum(transactions.values()) * rule['revenue_bps'], 10_000)
        items.append({'sessionId': str(item['id']), 'ruleId': str(rule['id']), 'seconds': item['seconds'],
                      'revenueTransactions': sorted(transactions)})
    fixed_minor = round_minor(fixed)
    variable_minor = round_minor(variable)
    revenue_minor = round_minor(revenue)
    return {'teacherUserId': str(teacher), 'periodKey': period, 'amountMinor': fixed_minor+variable_minor+revenue_minor,
            'fixedMinor': fixed_minor, 'sessionMinor': variable_minor, 'revenueMinor': revenue_minor, 'sessions': items,
            'ruleIds': [str(rule['id']) for rule in rules], 'pendingSessionIds': pending}


@ledger.transactional
async def finalize(conn: Connection, actor: UUID, command: Finalize) -> dict:
    await lock_teacher(conn, command.teacherUserId)
    existing = await conn.fetchrow(
        'SELECT * FROM academy_payroll_runs WHERE teacher_user_id=$1 AND period_key=$2',
        command.teacherUserId, command.periodKey)
    if existing:
        snapshot = json.loads(existing['calculation'])
        ledger._require(fingerprint(snapshot) == command.expectedCalculation
                        and existing['accrued_minor'] == command.expectedAmountMinor,
                        'payroll_already_finalized', 409)
        return await position(conn, existing)
    today = ledger.business_date(datetime.now(timezone.utc))
    ledger._require(month(command.periodKey)[1] < today, 'payroll_month_not_ended', 409)
    await ledger._lock_period(conn, command.periodKey)
    await ledger._assert_period_open(conn, command.periodKey)
    estimate = await calculate(conn, command.teacherUserId, command.periodKey)
    ledger._require(not estimate['pendingSessionIds'], 'payroll_attendance_incomplete', 409)
    amount = ledger._minor(estimate['amountMinor'])
    ledger._require(amount > 0, 'nothing_to_accrue', 409)
    ledger._require(amount == command.expectedAmountMinor
                    and fingerprint(estimate) == command.expectedCalculation, 'payroll_estimate_changed', 409)
    run_id = uuid4()
    transaction = await ledger._post_journal(
        conn, source_type='payroll_accrual', source_id=run_id, actor_user_id=actor,
        period=command.periodKey, memo='Teacher salary accrued',
        lines=[('salary_expense', 'debit', amount), ('salary_payable', 'credit', amount)])
    row = await conn.fetchrow(
        """INSERT INTO academy_payroll_runs(id,teacher_user_id,period_key,accrued_minor,
                  calculation,accrual_transaction_id,finalized_by)
           VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING *""",
        run_id, command.teacherUserId, command.periodKey, amount, json.dumps(estimate), transaction, actor)
    await ledger.audit_event(conn, actor_user_id=actor, action='payroll_accrued',
                             subject_type='payroll_run', subject_id=run_id, period=command.periodKey,
                             amount_minor=amount, detail={'teacherUserId': command.teacherUserId})
    return await position(conn, row)


def fingerprint(calculation: dict) -> str:
    return sha256(json.dumps(calculation, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


@ledger.transactional
async def overview(conn: Connection, request: RunRequest) -> dict:
    await lock_teacher(conn, request.teacherUserId)
    month(request.periodKey)
    run = await conn.fetchrow(
        'SELECT * FROM academy_payroll_runs WHERE teacher_user_id=$1 AND period_key=$2',
        request.teacherUserId, request.periodKey)
    closed = bool(await conn.fetchval(
        'SELECT 1 FROM finance_closed_periods WHERE period_key=$1', request.periodKey))
    out = {'rules': [{k: r[k] for k in ('id', 'starts_on', 'ends_on', 'monthly_minor', 'session_minor',
                                        'hourly_minor', 'revenue_bps')}
                     for r in await rules_for(conn, request.teacherUserId)],
           'canFinalize': not closed and month(request.periodKey)[1]
               < ledger.business_date(datetime.now(timezone.utc))}
    if run:
        return {**out, 'position': await position(conn, run)}
    estimate = await calculate(conn, request.teacherUserId, request.periodKey)
    ledger._minor(estimate['amountMinor'])
    return {**out, 'estimate': estimate, 'calculationHash': fingerprint(estimate)}


async def teacher_choices(conn: Connection, query: str) -> list[dict]:
    rows = await conn.fetch(
        """SELECT u.id,coalesce(u.name,u.email,u.id::text) AS label FROM users u
            WHERE (u.role IN ('teacher','owner') OR EXISTS (
                       SELECT 1 FROM academy_payroll_rules r WHERE r.teacher_user_id=u.id))
              AND strpos(lower(coalesce(u.name,'') || ' ' || coalesce(u.email,'') || ' ' || u.id::text),
                         lower($1))>0
            ORDER BY u.name,u.id LIMIT 25""", query)
    return [{'id': str(row['id']), 'label': row['label']} for row in rows]


async def position(conn: Connection, run: Record) -> dict:
    rows = await conn.fetch(
        'SELECT * FROM academy_payroll_events WHERE run_id=$1 ORDER BY created_at,id', run['id'])
    adjusted = sum(row['amount_minor'] for row in rows if row['kind'] == 'adjustment')
    paid = sum(row['amount_minor'] for row in rows if row['kind'] == 'payout')
    return {'id': str(run['id']), 'teacherUserId': str(run['teacher_user_id']),
            'periodKey': run['period_key'], 'accruedMinor': run['accrued_minor'],
            'adjustmentMinor': adjusted, 'paidMinor': paid,
            'balanceMinor': run['accrued_minor'] + adjusted - paid,
            'events': [{'id': str(row['id']), 'kind': row['kind'], 'amountMinor': row['amount_minor'],
                        'reference': row['reference'], 'periodKey': row['period_key'],
                        'createdAt': row['created_at'].isoformat()} for row in rows],
            'calculation': json.loads(run['calculation'])}


@ledger.transactional
async def post_event(conn: Connection, actor: UUID, run_id: UUID, command: Event) -> dict:
    run = await conn.fetchrow('SELECT * FROM academy_payroll_runs WHERE id=$1 FOR UPDATE', run_id)
    ledger._require(run is not None, 'payroll_run_not_found', 404)
    await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1,1126))", str(command.commandId))
    existing = await conn.fetchrow('SELECT * FROM academy_payroll_events WHERE id=$1', command.commandId)
    amount = command.amountMinor
    if existing:
        ledger._require((existing['run_id'], existing['kind'], existing['amount_minor'],
                         existing['reference'], existing['actor_user_id']) ==
                        (run_id, command.kind, amount, command.reference, actor), 'idempotency_conflict', 409)
        return await position(conn, run)
    current = await position(conn, run)
    booking_period = ledger.period_key(datetime.now(timezone.utc))
    await ledger._lock_period(conn, booking_period)
    await ledger._assert_period_open(conn, booking_period)
    if command.kind == 'payout':
        ledger._require(amount <= current['balanceMinor'], 'payout_exceeds_payable', 409)
        lines = [('salary_payable', 'debit', amount), ('bank_clearing', 'credit', amount)]
    else:
        ledger._require(current['balanceMinor'] + amount >= 0, 'adjustment_below_paid', 409)
        ledger._minor(current['accruedMinor'] + current['adjustmentMinor'] + amount)
        normal, reverse = ('debit', 'credit') if amount > 0 else ('credit', 'debit')
        lines = [('salary_expense', normal, abs(amount)), ('salary_payable', reverse, abs(amount))]
    transaction = await ledger._post_journal(
        conn, source_type='payroll_'+command.kind, source_id=command.commandId,
        actor_user_id=actor, period=booking_period, memo='Teacher salary '+command.kind, lines=lines)
    inserted = await conn.fetchval(
        """INSERT INTO academy_payroll_events(id,run_id,kind,amount_minor,period_key,
                  transaction_id,reference,actor_user_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id""",
        command.commandId, run_id, command.kind, amount, booking_period, transaction, command.reference, actor)
    ledger._require(inserted is not None, 'payroll_reference_exists', 409)
    await ledger.audit_event(conn, actor_user_id=actor, action='payroll_'+command.kind,
                             subject_type='payroll_run', subject_id=run_id, period=booking_period,
                             amount_minor=amount, reason=command.reference,
                             detail={'eventId': command.commandId})
    return await position(conn, run)
