"""Approved rational tariffs, exact unspent cash, and idempotent service consumption.

One contract buys one declared service type. A tariff is X whole UZS for N units;
no monthly/30 conversion or constant example price is used. Cumulative ceiling
pricing conserves the exact bundle price even when X/N is fractional.
"""
from __future__ import annotations

from datetime import date,datetime,timedelta,timezone
import hashlib
import json
import os
from typing import Annotated,Any,Literal,Mapping
from uuid import UUID,uuid4

from asyncpg import Connection
from pydantic import BaseModel,ConfigDict,Field,Strict,field_validator,model_validator
from . import tuition_ledger as ledger

MAX_AMOUNT=90071992547409
PositiveMoney=Annotated[int,Strict(),Field(ge=1,le=MAX_AMOUNT)]
UnitCount=Annotated[int,Strict(),Field(ge=1,le=3660)]
Weekday=Annotated[int,Strict(),Field(ge=0,le=6)]


class PolicyCreate(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    id: UUID
    studentUserId: UUID
    courseId: UUID
    mode: Literal['PREPAID_CALENDAR_DAYS','PREPAID_LESSONS']
    label: str=Field(min_length=1,max_length=120)
    priceAmountMinor: PositiveMoney
    priceUnits: UnitCount
    maxUnits: UnitCount
    startsOn: date
    endsOn: date | None=None
    eligibleWeekdays: list[Weekday]=Field(min_length=1,max_length=7)
    excludedDates: list[date]=Field(max_length=366)
    residualRule: Literal['carry_money_without_expiry']
    lessonBasis: Literal['held_session_roster']

    @field_validator('startsOn','endsOn',mode='before')
    @classmethod
    def calendar_date(cls,value: Any) -> date | None:
        if value is None:return None
        if not isinstance(value,str):raise ValueError('Expected an ISO calendar date')
        parsed=date.fromisoformat(value)
        if parsed.isoformat()!=value or not 2000<=parsed.year<=2200:raise ValueError('Invalid service date')
        return parsed

    @field_validator('excludedDates',mode='before')
    @classmethod
    def calendar_dates(cls,value: Any) -> list[date]:
        if not isinstance(value,list):raise ValueError('Expected a list of ISO dates')
        return [cls.calendar_date(v) for v in value]

    @model_validator(mode='after')
    def coherent(self) -> 'PolicyCreate':
        if self.endsOn and self.endsOn<self.startsOn:raise ValueError('End date precedes start')
        if len(set(self.eligibleWeekdays))!=len(self.eligibleWeekdays):raise ValueError('Repeated weekday')
        if len(set(self.excludedDates))!=len(self.excludedDates):raise ValueError('Repeated excluded date')
        if self.priceAmountMinor<self.priceUnits:raise ValueError('Each service unit must cost at least one whole UZS')
        if (self.priceAmountMinor*self.maxUnits+self.priceUnits-1)//self.priceUnits>MAX_AMOUNT:
            raise ValueError('Tariff exceeds the supported cash range')
        return self


class PauseCreate(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    id: UUID
    startsOn: date
    endsOn: date
    reason: str=Field(min_length=3,max_length=300)

    @field_validator('startsOn','endsOn',mode='before')
    @classmethod
    def calendar_date(cls,value: Any) -> date:
        parsed=PolicyCreate.calendar_date(value)
        if parsed is None:raise ValueError('Date is required')
        return parsed

    @model_validator(mode='after')
    def coherent(self) -> 'PauseCreate':
        if not 0<=(self.endsOn-self.startsOn).days<=3660:raise ValueError('Invalid pause interval')
        return self


def purchases_enabled() -> bool:
    return os.getenv('PREPAID_BILLING_ENABLED')=='1'


def cumulative_cost(policy: Mapping,units: int) -> int:
    """ceil(total units × bundle amount / bundle units), using integer arithmetic."""
    return (units*policy['price_amount_minor']+policy['price_units']-1)//policy['price_units']


def cost_for_units(policy: Mapping,consumed: int,units: int) -> int:
    return cumulative_cost(policy,consumed+units)-cumulative_cost(policy,consumed)


def affordable_units(policy: Mapping,consumed: int,cash: int) -> tuple[int,int]:
    low,high=0,policy['max_units']
    while low<high:
        middle=(low+high+1)//2
        if cost_for_units(policy,consumed,middle)<=cash:low=middle
        else:high=middle-1
    return low,cash-cost_for_units(policy,consumed,low)


def eligible(policy: Mapping,day: date,pauses: list[Mapping]) -> bool:
    return (day>=policy['starts_on'] and (not policy['ends_on'] or day<=policy['ends_on'])
        and day.weekday() in policy['eligible_weekdays'] and day not in policy['excluded_dates']
        and not any(p['starts_on']<=day<=p['ends_on'] for p in pauses))


def coverage(policy: Mapping,units: int,day: date,pauses: list[Mapping],consumed_dates: set[date] | None=None) -> tuple[int,date | None]:
    if policy['mode']!='PREPAID_CALENDAR_DAYS':return units,None
    cursor=max(day,policy['starts_on']);covered=0;last=None
    # At most 3660 units, explicit exclusions, and bounded pause intervals. The
    # limit is reported by returning only the dates actually enumerated.
    for _ in range(40000):
        if covered==units or policy['ends_on'] and cursor>policy['ends_on']:break
        if eligible(policy,cursor,pauses) and cursor not in (consumed_dates or set()):covered+=1;last=cursor
        cursor+=timedelta(days=1)
    return covered,last


async def schema_available(conn: Connection) -> bool:
    return bool(await conn.fetchval("SELECT to_regclass('public.tuition_service_policies')"))


async def finance_lock(conn: Connection,student: UUID) -> None:
    """One order for wallet funding, refunds, derived invoices and allocations."""
    await conn.execute('SELECT pg_advisory_xact_lock(hashtextextended($1,1718))',str(student))


async def policy_row(conn: Connection,policy_id: UUID, *, lock: bool=False) -> dict:
    row=await conn.fetchrow('''SELECT p.*,c.status AS contract_status,c.service_policy_id AS bound_policy_id,
        co.title AS course_title FROM tuition_service_policies p
        JOIN tuition_contracts c ON c.id=p.contract_id JOIN courses co ON co.id=p.course_id
        WHERE p.id=$1'''+(' FOR UPDATE OF p' if lock else ''),policy_id)
    ledger._require(row is not None,'service_policy_not_found',404)
    ledger._require(row['bound_policy_id']==row['id'],'service_contract_binding_mismatch')
    return dict(row)


async def for_payment(conn: Connection,policy_id: UUID,student: UUID, *, new_purchase: bool=False) -> dict:
    if new_purchase:ledger._require(purchases_enabled(),'prepaid_purchases_disabled',409)
    await finance_lock(conn,student)
    policy=await policy_row(conn,policy_id,lock=True)
    ledger._require(policy['student_user_id']==student,'service_policy_forbidden',403)
    ledger._require(policy['approved_at'] is not None,'service_policy_not_approved')
    if new_purchase:
        await ledger._active_student(conn,student)
        day=ledger.business_date(datetime.now(timezone.utc))
        ledger._require(policy['contract_status']=='active' and (not policy['ends_on'] or day<=policy['ends_on']),
                        'service_contract_not_active')
    return policy


async def create_policy(conn: Connection,actor: UUID,body: PolicyCreate) -> dict:
    ledger._require(purchases_enabled(),'prepaid_purchases_disabled',409)
    ledger._require(await ledger._actor_role(conn,actor) in ('owner','admin'),'forbidden',403)
    fingerprint=hashlib.sha256(json.dumps(body.model_dump(mode='json'),sort_keys=True,separators=(',',':')).encode()).hexdigest()
    await conn.execute('SELECT pg_advisory_xact_lock(hashtextextended($1,1716))',str(body.id))
    old=await conn.fetchrow('SELECT * FROM tuition_service_policies WHERE id=$1',body.id)
    if old:
        ledger._require(old['created_by']==actor and old['create_fingerprint']==fingerprint,'idempotency_conflict')
        return await policy_row(conn,body.id)
    contract=await ledger.create_contract(conn,actor_user_id=actor,student_user_id=body.studentUserId,
        monthly_amount_minor=0,starts_on=body.startsOn,ends_on=body.endsOn,course_id=body.courseId,
        note=body.label)
    await conn.execute('''INSERT INTO tuition_service_policies(id,contract_id,student_user_id,course_id,mode,label,
        price_amount_minor,price_units,max_units,eligible_weekdays,excluded_dates,starts_on,ends_on,
        residual_rule,lesson_basis,create_fingerprint,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)''',
        body.id,contract['id'],body.studentUserId,body.courseId,body.mode,body.label,
        body.priceAmountMinor,body.priceUnits,body.maxUnits,body.eligibleWeekdays,body.excludedDates,
        body.startsOn,body.endsOn,body.residualRule,body.lessonBasis,fingerprint,actor)
    await conn.execute('UPDATE tuition_contracts SET service_policy_id=$2 WHERE id=$1',contract['id'],body.id)
    await ledger.audit_event(conn,actor_user_id=actor,action='service_policy_created',subject_type='service_policy',
        subject_id=body.id,detail={'mode':body.mode,'priceAmountMinor':body.priceAmountMinor,'priceUnits':body.priceUnits})
    return await policy_row(conn,body.id)


async def approve_for_contract(conn: Connection,actor: UUID,contract: Mapping) -> None:
    policy=await policy_row(conn,contract['service_policy_id'],lock=True)
    ledger._require(await ledger._actor_role(conn,actor)=='owner','approval_requires_owner',403)
    ledger._require(policy['created_by']!=actor,'approver_must_differ_from_drafter',403)
    ledger._require(policy['approved_at'] is None,'service_policy_already_approved')
    await conn.execute('UPDATE tuition_service_policies SET approved_by=$2,approved_at=now() WHERE id=$1',policy['id'],actor)


async def validate_activation(conn: Connection,contract: Mapping) -> None:
    policy=await policy_row(conn,contract['service_policy_id'],lock=True)
    ledger._require(policy['approved_at'] is not None,'service_policy_not_approved')
    await conn.execute('SELECT pg_advisory_xact_lock(hashtextextended($1,1717))',str(policy['student_user_id'])+str(policy['course_id']))
    overlaps=await conn.fetchval('''SELECT EXISTS(SELECT 1 FROM tuition_service_policies p
        JOIN tuition_contracts c ON c.id=p.contract_id WHERE p.student_user_id=$1 AND p.course_id=$2
        AND c.status='active' AND p.id<>$3
        AND daterange(p.starts_on,p.ends_on,'[]') && daterange($4::date,$5::date,'[]'))''',
        policy['student_user_id'],policy['course_id'],policy['id'],policy['starts_on'],policy['ends_on'])
    ledger._require(not overlaps,'service_contract_dates_overlap')


async def wallet(conn: Connection,policy: Mapping) -> dict:
    money=await conn.fetchrow('''SELECT coalesce(sum(p.amount_minor-coalesce(a.used,0)-coalesce(r.refunded,0)),0)::bigint AS cash
        FROM tuition_payments p
        LEFT JOIN LATERAL(SELECT sum(amount_minor) AS used FROM tuition_payment_allocations WHERE payment_id=p.id)a ON true
        LEFT JOIN LATERAL(SELECT sum(amount_minor) AS refunded FROM tuition_refunds WHERE payment_id=p.id AND status='settled')r ON true
        WHERE p.service_policy_id=$1 AND p.status=ANY($2::varchar[])''',policy['id'],list(ledger.SETTLED_PAYMENT_STATES))
    rows=await conn.fetchrow('''SELECT coalesce(sum(c.net_amount_minor-coalesce(a.used,0)-coalesce(n.credited,0)),0)::bigint AS debt
        FROM tuition_charges c
        LEFT JOIN LATERAL(SELECT sum(amount_minor) AS used FROM tuition_payment_allocations WHERE charge_id=c.id)a ON true
        LEFT JOIN LATERAL(SELECT sum(amount_minor) AS credited FROM tuition_credit_notes WHERE charge_id=c.id AND status='posted')n ON true
        WHERE c.service_policy_id=$1 AND c.status='posted' AND NOT c.is_reversal''',policy['id'])
    consumption=await conn.fetchrow('''SELECT coalesce(sum(units),0)::bigint AS units,
        coalesce(array_agg(service_date) FILTER(WHERE service_date>=$2),ARRAY[]::date[]) AS future_dates
        FROM tuition_service_consumptions WHERE policy_id=$1''',policy['id'],ledger.business_date(datetime.now(timezone.utc)))
    consumed=int(consumption['units'])
    pauses=[dict(r) for r in await conn.fetch('SELECT starts_on,ends_on FROM tuition_service_pauses WHERE policy_id=$1 AND approved_at IS NOT NULL',policy['id'])]
    cash=int(money['cash']);debt=max(0,int(rows['debt']))
    ledger._require(cash>=0,'service_wallet_negative')
    units,residue=affordable_units(policy,consumed,cash) if not debt else (0,cash)
    remaining,last=coverage(policy,units,ledger.business_date(datetime.now(timezone.utc)),pauses,set(consumption['future_dates']))
    capacity,_=coverage(policy,policy['max_units'],ledger.business_date(datetime.now(timezone.utc)),pauses,set(consumption['future_dates']))
    residue=cash-cost_for_units(policy,consumed,remaining)
    return {'cash':cash,'debt':debt,'consumed':consumed,'remaining':remaining,'residue':residue,
        'coveredUntil':last,'eligibleCapacity':capacity,'nextUnitCost':cost_for_units(policy,consumed,1)}


async def synchronize(conn: Connection,policy_id: UUID,reason: str,source: UUID) -> dict:
    policy=await policy_row(conn,policy_id,lock=True)
    value=await wallet(conn,policy)
    old=await conn.fetchval('SELECT remaining_units FROM tuition_service_events WHERE policy_id=$1 ORDER BY sequence DESC LIMIT 1',policy_id)
    await conn.execute('''INSERT INTO tuition_service_events(policy_id,reason_type,source_id,cash_balance_minor,
        remaining_units,units_delta,unapplied_credit_minor,unit_price_minor)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(policy_id,reason_type,source_id) DO NOTHING''',
        policy_id,reason,source,value['cash'],value['remaining'],value['remaining']-(old or 0),value['residue'],value['nextUnitCost'])
    return value


async def payment_changed(conn: Connection,payment: Mapping, *, reason: str='payment',source: UUID | None=None,
                          allocations: list[Mapping] | None=None) -> None:
    policies={payment['service_policy_id']} if payment.get('service_policy_id') else set()
    if 'service_policy_id' in payment and allocations:
        rows=await conn.fetch('SELECT DISTINCT service_policy_id FROM tuition_charges WHERE id=ANY($1::uuid[]) AND service_policy_id IS NOT NULL',
                              [r['charge_id'] for r in allocations])
        policies.update(r['service_policy_id'] for r in rows)
    for policy_id in sorted(policies):await synchronize(conn,policy_id,reason,source or payment['id'])


async def validate_purchase_amount(conn: Connection,policy: Mapping,amount: int) -> None:
    value=await wallet(conn,policy)
    unspent=max(0,amount-value['debt'])+value['cash']
    ledger._require(unspent<=cost_for_units(policy,value['consumed'],policy['max_units'])+value['nextUnitCost']-1,
        'service_purchase_limit',422)


async def accounts(conn: Connection,student: UUID) -> list[dict]:
    if not await schema_available(conn):return []
    rows=await conn.fetch('''SELECT p.*,c.status AS contract_status,co.title AS course_title
        FROM tuition_service_policies p JOIN tuition_contracts c ON c.id=p.contract_id
        JOIN courses co ON co.id=p.course_id WHERE p.student_user_id=$1
        ORDER BY p.created_at,p.id LIMIT 50''',student)
    result=[]
    for row in rows:
        p=dict(row);value=await wallet(conn,p)
        result.append({'id':str(p['id']),'contractId':str(p['contract_id']),'label':p['label'],'course':p['course_title'],
            'mode':p['mode'],'version':'svc1:'+str(p['id']),'priceAmountMinor':p['price_amount_minor'],'priceUnits':p['price_units'],
            'unspentMinor':value['cash'],'balanceDueMinor':value['debt'],'remainingUnits':value['remaining'],
            'unappliedCreditMinor':value['residue'],'consumedUnits':value['consumed'],
            'maxUnits':p['max_units'],'eligibleCapacity':value['eligibleCapacity'],
            'coveredUntil':value['coveredUntil'].isoformat() if value['coveredUntil'] else None,
            'startsOn':p['starts_on'].isoformat(),'endsOn':p['ends_on'].isoformat() if p['ends_on'] else None,
            'eligibleWeekdays':p['eligible_weekdays'],'excludedDates':[d.isoformat() for d in p['excluded_dates']],
            'approved':p['approved_at'] is not None,'active':p['contract_status']=='active',
            'purchasesEnabled':purchases_enabled(),'lessonBasis':p['lesson_basis'],'residualRule':p['residual_rule']})
    return result


async def consume(conn: Connection,policy_id: UUID, *, service_date: date,session_id: UUID | None,actor: UUID) -> dict:
    """One derived invoice per delivered eligible unit, using previously approved terms.

    Only the existing held-session transition or an authorized past-calendar-day
    command calls this. Attendance corrections never call it. Unfunded delivery
    remains an explicit receivable instead of inventing a paid entitlement.
    """
    policy=await policy_row(conn,policy_id)
    await finance_lock(conn,policy['student_user_id'])
    policy=await policy_row(conn,policy_id,lock=True)
    ledger._require(policy['approved_at'] is not None,'service_policy_not_approved')
    reference='session:'+str(session_id) if session_id else 'day:'+service_date.isoformat()
    prior=await conn.fetchrow('SELECT * FROM tuition_service_consumptions WHERE policy_id=$1 AND service_ref=$2',policy_id,reference)
    if prior:return {'id':str(prior['id']),'chargeId':str(prior['charge_id']),'duplicate':True}
    ledger._require(policy['contract_status'] in ('active','completed'),'service_contract_not_active')
    ledger._require(service_date<=ledger.business_date(datetime.now(timezone.utc)), 'future_service_not_delivered',422)
    ledger._require((session_id is None)==(policy['mode']=='PREPAID_CALENDAR_DAYS'),'service_consumption_mode_mismatch',422)
    pauses=[dict(r) for r in await conn.fetch('SELECT starts_on,ends_on FROM tuition_service_pauses WHERE policy_id=$1 AND approved_at IS NOT NULL',policy_id)]
    ledger._require(eligible(policy,service_date,pauses),'service_date_ineligible',422)
    if policy['mode']=='PREPAID_CALENDAR_DAYS':
        ledger._require(session_id is None and service_date<ledger.business_date(datetime.now(timezone.utc)),
            'service_day_not_completed',422)
    else:
        ledger._require(session_id is not None,'service_session_required',422)
        valid=await conn.fetchval('''SELECT EXISTS(SELECT 1 FROM academy_sessions s JOIN academy_groups g ON g.id=s.group_id
            JOIN academy_attendance a ON a.session_id=s.id WHERE s.id=$1 AND s.status='held'
            AND g.course_id=$2 AND a.student_user_id=$3 AND (s.starts_at AT TIME ZONE 'Asia/Tashkent')::date=$4)''',
            session_id,policy['course_id'],policy['student_user_id'],service_date)
        ledger._require(valid,'service_session_not_eligible',422)
    value=await wallet(conn,policy);price=cost_for_units(policy,value['consumed'],1)
    moment=datetime.now(timezone.utc);period=ledger.period_key(moment)
    await ledger._assert_period_open(conn,period)
    charge=await conn.fetchrow('''INSERT INTO tuition_charges(contract_id,student_user_id,period_key,currency_code,
        gross_amount_minor,discount_amount_minor,net_amount_minor,due_date,status,created_by,approved_by,approved_at,service_policy_id)
        VALUES($1,$2,$3,'UZS',$4,0,$4,$5,'approved',$6,$7,$8,$9) RETURNING *''',
        policy['contract_id'],policy['student_user_id'],period,price,service_date,
        policy['created_by'],policy['approved_by'],policy['approved_at'],policy_id)
    await ledger.post_charge(conn,actor_user_id=actor,charge_id=charge['id'])
    consumption=await conn.fetchrow('''INSERT INTO tuition_service_consumptions(policy_id,service_ref,service_date,session_id,
        charge_id,units,amount_minor,actor_user_id) VALUES($1,$2,$3,$4,$5,1,$6,$7) RETURNING *''',
        policy_id,reference,service_date,session_id,charge['id'],price,actor)
    # Policy -> payment -> charge is the lock order shared by funding/refunds.
    payments=await conn.fetch('''SELECT * FROM tuition_payments WHERE service_policy_id=$1
        AND status=ANY($2::varchar[]) ORDER BY occurred_at,id FOR UPDATE''',policy_id,list(ledger.SETTLED_PAYMENT_STATES))
    remaining=price;applied=0
    for payment in payments:
        _,_,available=await ledger._refund_available(conn,payment['id'])
        take=min(remaining,max(0,available))
        if not take:continue
        await conn.execute('INSERT INTO tuition_payment_allocations(payment_id,charge_id,amount_minor) VALUES($1,$2,$3)',payment['id'],charge['id'],take)
        remaining-=take;applied+=take
        if not remaining:break
    if applied:
        await ledger._post_journal(conn,source_type='advance_application',source_id=charge['id'],
            student_user_id=policy['student_user_id'],actor_user_id=actor,period=period,occurred_at=moment,
            memo='Approved prepaid service consumed',
            lines=[('customer_advance','debit',applied),('accounts_receivable','credit',applied)])
    await synchronize(conn,policy_id,'service',consumption['id'])
    await ledger.audit_event(conn,actor_user_id=actor,action='service_unit_consumed',subject_type='service_consumption',
        subject_id=consumption['id'],amount_minor=price,period=period,
        detail={'policyId':str(policy_id),'serviceRef':reference,'serviceDate':service_date.isoformat(),
            'units':1,'allocatedMinor':applied,'unfundedMinor':remaining})
    return {'id':str(consumption['id']),'chargeId':str(charge['id']),'amountMinor':price,
        'allocatedMinor':applied,'balanceDueMinor':remaining,'duplicate':False}


async def held_session(conn: Connection,session: Mapping,actor: UUID) -> None:
    if not await schema_available(conn):return
    rows=await conn.fetch('''SELECT p.id FROM tuition_service_policies p JOIN tuition_contracts c ON c.id=p.contract_id
        JOIN academy_groups g ON g.course_id=p.course_id
        JOIN academy_attendance a ON a.student_user_id=p.student_user_id AND a.session_id=$1
        WHERE g.id=$2 AND p.mode='PREPAID_LESSONS' AND p.approved_at IS NOT NULL AND c.status='active' ORDER BY p.id''',
        session['id'],session['group_id'])
    day=ledger.business_date(session['starts_at'])
    for row in rows:
        policy=await policy_row(conn,row['id'])
        pauses=[dict(r) for r in await conn.fetch('SELECT starts_on,ends_on FROM tuition_service_pauses WHERE policy_id=$1 AND approved_at IS NOT NULL',row['id'])]
        if eligible(policy,day,pauses):await consume(conn,row['id'],service_date=day,session_id=session['id'],actor=actor)


async def request_pause(conn: Connection,actor: UUID,policy_id: UUID,body: PauseCreate) -> dict:
    ledger._require(await ledger._actor_role(conn,actor) in ('owner','admin'),'forbidden',403)
    policy=await policy_row(conn,policy_id,lock=True)
    ledger._require(body.startsOn>=ledger.business_date(datetime.now(timezone.utc)) and body.startsOn>=policy['starts_on']
        and (not policy['ends_on'] or body.endsOn<=policy['ends_on']),'pause_dates_invalid',422)
    old=await conn.fetchrow('SELECT * FROM tuition_service_pauses WHERE id=$1',body.id)
    if old:
        ledger._require((old['policy_id'],old['starts_on'],old['ends_on'],old['reason'],old['created_by'])==
            (policy_id,body.startsOn,body.endsOn,body.reason,actor),'idempotency_conflict')
        return dict(old)
    row=await conn.fetchrow('''INSERT INTO tuition_service_pauses(id,policy_id,starts_on,ends_on,reason,created_by)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *''',body.id,policy_id,body.startsOn,body.endsOn,body.reason,actor)
    return dict(row)


async def approve_pause(conn: Connection,actor: UUID,policy_id: UUID,pause_id: UUID) -> dict:
    await policy_row(conn,policy_id,lock=True)
    ledger._require(await ledger._actor_role(conn,actor)=='owner','approval_requires_owner',403)
    row=await conn.fetchrow('SELECT * FROM tuition_service_pauses WHERE id=$1 AND policy_id=$2 FOR UPDATE',pause_id,policy_id)
    ledger._require(row is not None,'service_pause_not_found',404)
    ledger._require(row['created_by']!=actor,'approver_must_differ_from_drafter',403)
    if row['approved_at']:return dict(row)
    ledger._require(row['starts_on']>=ledger.business_date(datetime.now(timezone.utc)),'pause_dates_invalid',422)
    overlap=await conn.fetchval('''SELECT EXISTS(SELECT 1 FROM tuition_service_pauses WHERE policy_id=$1 AND approved_at IS NOT NULL
        AND daterange(starts_on,ends_on,'[]') && daterange($2::date,$3::date,'[]'))''',policy_id,row['starts_on'],row['ends_on'])
    ledger._require(not overlap,'service_pause_dates_overlap')
    result=await conn.fetchrow('UPDATE tuition_service_pauses SET approved_by=$2,approved_at=now() WHERE id=$1 RETURNING *',pause_id,actor)
    await synchronize(conn,policy_id,'pause',pause_id)
    await ledger.audit_event(conn,actor_user_id=actor,action='service_pause_approved',subject_type='service_pause',subject_id=pause_id,
        detail={'policyId':str(policy_id),'startsOn':row['starts_on'].isoformat(),'endsOn':row['ends_on'].isoformat()})
    return dict(result)
