"""Prepare an audited OWNER test order in an explicitly isolated non-production database.

This bootstraps vendor verification without setting a false LIVE_VERIFIED flag or
making an unverified payment method available to students/guardians.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
from uuid import UUID

import asyncpg

from app.db import connection_settings,initialize_connection
from app.runtime_config import environment
from app.self_service_payments import IntentCreate,create_intent,provider_config
from migrate_academy import target_label


async def prepare(dsn: str,owner_id: UUID,student_id: UUID,body: IntentCreate) -> dict:
    if environment()=='production' or os.getenv('PAYMENT_SANDBOX_DATABASE_ISOLATED')!='1':
        raise ValueError('An explicitly isolated non-production database is required')
    config=provider_config(body.provider)
    if config['environment']!='sandbox' or not config['callbacksAvailable']:
        raise ValueError('Configure sandbox credentials and callbacks without enabling live verification')
    dsn,tls=connection_settings(dsn)
    conn=await asyncpg.connect(dsn,ssl=tls,timeout=15)
    try:
        await initialize_connection(conn)
        async with conn.transaction():
            owner=await conn.fetchrow("SELECT * FROM users WHERE id=$1 AND role='owner' AND account_status='active' FOR SHARE",owner_id)
            student=await conn.fetchval("SELECT id FROM users WHERE id=$1 AND role='student' AND account_status='active' FOR SHARE",student_id)
            if not owner or not student:raise ValueError('Active owner and synthetic student are required')
            result=await create_intent(conn,payer=owner,student_id=student_id,link_id=None,body=body,verification_order=True)
        if body.provider=='uzum':
            from app.payment_providers import register_uzum
            from app.self_service_payments import public_intent
            async with conn.transaction():
                row=await conn.fetchrow('SELECT * FROM tuition_payment_intents WHERE id=$1 FOR UPDATE',UUID(result['intentId']))
                row=await register_uzum(conn,row,config)
                result=await public_intent(conn,row)
        row=await conn.fetchrow('SELECT checkout_url FROM tuition_payment_intents WHERE id=$1',UUID(result['intentId']))
        return {**result,'merchantCheckoutUrl':row['checkout_url'],'verificationLevel':'UNVERIFIED_SANDBOX_ORDER'}
    finally:
        await conn.close()


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--owner',type=UUID,required=True)
    parser.add_argument('--student',type=UUID,required=True)
    parser.add_argument('--provider',choices=('click','payme','uzum'),required=True)
    parser.add_argument('--amount-uzs',type=int,required=True)
    parser.add_argument('--idempotency-key',type=UUID,required=True)
    parser.add_argument('--apply',metavar='EXACT_TARGET')
    args=parser.parse_args()
    body=IntentCreate(amountMinor=args.amount_uzs,provider=args.provider,idempotencyKey=args.idempotency_key)
    dsn=os.getenv('PAYMENTS_SANDBOX_DATABASE_URL','')
    label=target_label(dsn)
    if not args.apply:
        print(json.dumps({'target':label,'writes':False,'provider':body.provider,'amountMinor':body.amountMinor}));return
    if args.apply!=label:parser.error('--apply must match the inspected target exactly')
    print(json.dumps(asyncio.run(prepare(dsn,args.owner,args.student,body)),sort_keys=True))


if __name__=='__main__':main()
