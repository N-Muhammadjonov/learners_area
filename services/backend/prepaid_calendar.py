"""Inspect or consume at most 31 completed calendar dates for one approved contract."""
from __future__ import annotations

import argparse
import asyncio
from datetime import date,datetime,timedelta,timezone
import json
import os
from uuid import UUID

import asyncpg

from app import prepaid_services as service,tuition_ledger as ledger
from app.db import connection_settings
from migrate_academy import target_label


async def consume_range(conn, *, actor: UUID,policy_id: UUID,starts_on: date,ends_on: date,apply: bool=False) -> dict:
    ledger._require(0<=(ends_on-starts_on).days<31,'service_batch_dates_invalid',422)
    ledger._require(ends_on<ledger.business_date(datetime.now(timezone.utc)),'service_day_not_completed',422)
    async with conn.transaction(readonly=not apply):
        user=await conn.fetchrow('SELECT role,account_status FROM users WHERE id=$1',actor)
        ledger._require(user and user['role'] in ('owner','admin') and user['account_status']=='active','forbidden',403)
        policy=await service.policy_row(conn,policy_id)
        ledger._require(policy['mode']=='PREPAID_CALENDAR_DAYS','service_consumption_mode_mismatch',422)
        ledger._require(policy['approved_at'] is not None and policy['contract_status'] in ('active','completed'),'service_contract_not_active')
        pauses=[dict(p) for p in await conn.fetch('SELECT starts_on,ends_on FROM tuition_service_pauses WHERE policy_id=$1 AND approved_at IS NOT NULL',policy_id)]
        days=[];results=[]
        for offset in range((ends_on-starts_on).days+1):
            day=starts_on+timedelta(days=offset)
            if not service.eligible(policy,day,pauses):continue
            days.append(day.isoformat())
            if apply:results.append(await service.consume(conn,policy_id,service_date=day,session_id=None,actor=actor))
    return {'policyId':str(policy_id),'eligibleDates':days,'applied':apply,'results':results}


async def run(dsn,**options):
    dsn,tls=connection_settings(dsn)
    conn=await asyncpg.connect(dsn,ssl=tls,timeout=15)
    try:return await consume_range(conn,**options)
    finally:await conn.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor',type=UUID,required=True)
    parser.add_argument('--policy',type=UUID,required=True)
    parser.add_argument('--from-date',type=date.fromisoformat,required=True)
    parser.add_argument('--through-date',type=date.fromisoformat,required=True)
    parser.add_argument('--apply',metavar='EXACT_TARGET')
    args=parser.parse_args()
    dsn=os.getenv('PREPAID_WORKER_DATABASE_URL','')
    target=target_label(dsn)
    if args.apply and args.apply!=target:parser.error('--apply must match the inspected target exactly')
    result=asyncio.run(run(dsn,actor=args.actor,policy_id=args.policy,starts_on=args.from_date,ends_on=args.through_date,apply=bool(args.apply)))
    print(json.dumps({'target':target,**result},sort_keys=True))


if __name__=='__main__':main()
