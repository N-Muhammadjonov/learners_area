"""Owner-only timetable and tuition simulations over an isolated read snapshot."""

from __future__ import annotations

from datetime import timedelta
from fractions import Fraction
from typing import Annotated, Literal
from uuid import UUID

from asyncpg import Connection, Record
from pydantic import BeforeValidator, Field

from .academy_groups import Command, GroupError, RESERVED, today
from .academy_payroll import parse_exact_minor, round_minor
from .academy_sessions import Slot, interval, room_key, validate_window
from .tuition_ledger import CURRENCY, finance_summary

BPS = 10_000
Percentage = Annotated[int, Field(strict=True, ge=0, le=BPS)]
Money = Annotated[int, Field(strict=True, ge=0, le=10**16), BeforeValidator(parse_exact_minor)]


class ScenarioSlot(Slot):
    teacherIds: None = None


class Scenario(Command):
    projectedStudents: Annotated[int, Field(strict=True, ge=0, le=1000)]
    tuitionMinor: Money
    discountBps: Percentage
    collectionBps: Percentage
    cashWithinPeriodBps: Percentage
    deliveryBps: Percentage
    openingDebtMinor: Money
    debtRecoveryBps: Percentage
    teacherPayMethod: Literal['fixed', 'per_session', 'hourly', 'revenue_share', 'hybrid']
    teacherRateMinor: Money
    teacherFixedMinor: Money = 0
    teacherRevenueBps: Percentage = 0
    teacherMinutesAvailable: Annotated[int, Field(strict=True, ge=0, le=52_560)]
    slot: ScenarioSlot


async def group_snapshot(conn: Connection, group_id: UUID) -> Record:
    row = await conn.fetchrow(
        """SELECT g.id, g.name, g.capacity, g.status, g.branch, g.room, g.starts_on, g.ends_on,
                  (SELECT count(*) FROM academy_group_memberships m
                    WHERE m.group_id=g.id AND m.status=ANY($2::varchar[])) AS reserved,
                  ARRAY(SELECT t.teacher_user_id FROM academy_group_teachers t
                         JOIN users u ON u.id=t.teacher_user_id
                        WHERE t.group_id=g.id AND u.role='teacher' AND u.account_status='active'
                        ORDER BY t.teacher_user_id) AS teacher_ids
             FROM academy_groups g WHERE g.id=$1""", group_id, list(RESERVED),
    )
    if row is None:
        raise GroupError('group_not_found', 404)
    return row


def group_summary(group: Record) -> dict:
    return {
        'groupId': str(group['id']), 'groupName': group['name'], 'branch': group['branch'],
        'room': group['room'], 'capacity': group['capacity'], 'reservedSeats': group['reserved'],
        'teachers': len(group['teacher_ids']), 'today': today().isoformat(), 'currency': CURRENCY,
    }


def scaled(amount: int, bps: int) -> int:
    return round_minor(Fraction(amount * bps, BPS))


def forecast(inputs: Scenario, group: Record) -> list[dict]:
    teachers = len(group['teacher_ids'])
    # One proposed lesson and one owner-selected forecast period. Fixed and revenue-share
    # costs apply once per teacher for the period; hourly/session cost covers the proposal.
    hourly = round_minor(Fraction(inputs.teacherRateMinor * inputs.slot.durationMinutes * teachers, 60))
    costs = {
        'fixed': inputs.teacherRateMinor * teachers,
        'per_session': inputs.teacherRateMinor * teachers,
        'hourly': hourly,
        'hybrid': inputs.teacherFixedMinor * teachers + hourly,
        'revenue_share': 0,
    }
    result = []
    for name, student_delta, collection_delta in (
        ('optimistic', 1000, 1000), ('neutral', 0, 0), ('stress', -1000, -1000),
    ):
        demand = scaled(inputs.projectedStudents, BPS + student_delta)
        students = min(demand, group['capacity'])
        collection = max(0, min(BPS, inputs.collectionBps + collection_delta))
        invoice = scaled(students * inputs.tuitionMinor, BPS - inputs.discountBps)
        recognized = scaled(invoice, inputs.deliveryBps)
        expected_collection = scaled(invoice, collection)
        cash = scaled(expected_collection, inputs.cashWithinPeriodBps)
        debt_cash = scaled(inputs.openingDebtMinor, inputs.debtRecoveryBps)
        cost = costs[inputs.teacherPayMethod]
        if inputs.teacherPayMethod == 'revenue_share':
            cost = scaled(recognized, inputs.teacherRevenueBps) * teachers
        result.append({
            'name': name, 'demand': demand, 'billableStudents': students,
            'studentsOverCapacity': demand - students,
            'seatUseBps': round_minor(Fraction(students * BPS, group['capacity'])),
            'collectionBps': collection,
            'invoicedMinor': str(invoice), 'recognizedMinor': str(recognized),
            'cashFromTuitionMinor': str(cash), 'cashFromOpeningDebtMinor': str(debt_cash),
            'cashTotalMinor': str(cash + debt_cash), 'unpaidTuitionMinor': str(invoice - expected_collection),
            'teacherCostMinor': str(cost), 'contributionMinor': str(recognized - cost),
        })
    return result


async def simulate(conn: Connection, group: Record, inputs: Scenario) -> dict:
    start, end = interval(inputs.slot, inputs.slot.localDate)
    validate_window(group, start, end)
    keys = {
        f'group:{group["id"]}': 'group',
        room_key(group['branch'], inputs.slot.room): 'room',
        **{f'teacher:{teacher}': 'teacher' for teacher in group['teacher_ids']},
    }
    rows = await conn.fetch(
        """SELECT DISTINCT resource_key FROM academy_session_reservations
            WHERE resource_key=ANY($1::text[]) AND starts_at<$3 AND ends_at>$2""",
        list(keys), start, end,
    )
    conflicts = sorted({keys[row['resource_key']] for row in rows})
    minutes = inputs.slot.durationMinutes
    teachers = len(group['teacher_ids'])
    required = minutes * max(1, teachers)
    gap = max(0, required - inputs.teacherMinutesAvailable) if teachers else required
    end_date = today()
    start_date = end_date-timedelta(days=29)
    actual = await finance_summary(conn, start=start_date, end=end_date)
    return {
        **group_summary(group), 'isScenario': True,
        'academyActuals': {
            'range': actual['range'],
            **{key: str(actual[key]) for key in (
                'invoicedTuitionMinor', 'collectedNetMinor', 'recognizedRevenueMinor',
                'outstandingReceivableMinor', 'overdueReceivableMinor',
            )},
        },
        'sources': {'capacity':'academy_groups', 'reservedSeats':'academy_group_memberships',
                    'teachers':'academy_group_teachers', 'schedule':'academy_session_reservations',
                    'forecast':'owner_inputs', 'academyActuals':'tuition_ledger.finance_summary'},
        'assumptions': inputs.model_dump(mode='json', exclude={
            'tuitionMinor', 'openingDebtMinor', 'teacherRateMinor', 'teacherFixedMinor',
        }) | {key: str(getattr(inputs, key)) for key in (
            'tuitionMinor', 'openingDebtMinor', 'teacherRateMinor', 'teacherFixedMinor',
        )},
        'schedule': {'feasible': not conflicts and not gap, 'conflicts': conflicts,
                     'teacherMinutesRequired': required, 'staffingGapMinutes': gap},
        'scenarios': forecast(inputs, group),
    }
