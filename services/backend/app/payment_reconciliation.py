"""Bounded canonical Uzum status recovery; no browser or callback is trusted as proof."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from uuid import UUID

from . import self_service_payments as payments
from .payment_providers import verify_uzum
from .tuition_ledger import LedgerError


async def reconcile_batch(pool, *, limit: int = 25) -> dict:
    if not payments.enabled() or os.getenv('PAYMENT_RECONCILIATION_ENABLED')!='1':
        return {'enabled':False,'checked':0,'settled':0,'failed':0}
    config=payments.provider_config('uzum')
    if not config['available']:
        return {'enabled':True,'checked':0,'settled':0,'failed':0,'providerAvailable':False}
    checked: list[UUID]=[]
    result={'enabled':True,'checked':0,'settled':0,'failed':0}
    for _ in range(max(1,min(25,limit))):
        async with pool.acquire() as conn,conn.transaction():
            row=await conn.fetchrow("""SELECT * FROM tuition_payment_intents
                WHERE provider='uzum' AND status IN ('created','pending')
                  AND provider_environment=$2
                  AND provider_transaction_id IS NOT NULL AND verification_attempts<12
                  AND next_check_at<=now() AND NOT(id=ANY($1::uuid[]))
                ORDER BY next_check_at,id LIMIT 1 FOR UPDATE SKIP LOCKED""",checked,config['environment'])
            if not row:break
            checked.append(row['id']);result['checked']+=1
            attempt=row['verification_attempts']+1
            error=None
            # A savepoint rolls back a refused proof, but not the durable retry counter.
            try:
                async with conn.transaction():
                    updated=await verify_uzum(conn,row,config)
                    if updated['status']=='paid':result['settled']+=1
            except LedgerError as exc:
                error=exc.code[:50];result['failed']+=1
            await conn.execute('''UPDATE tuition_payment_intents SET verification_attempts=$2,
                next_check_at=$3,verification_error_code=$4,updated_at=now() WHERE id=$1''',
                row['id'],attempt,datetime.now(timezone.utc)+timedelta(seconds=min(3600,10*2**attempt)),error)
    return result


async def main() -> None:
    """Operator-invoked single batch; scheduling is an explicit deployment decision."""
    import json
    from .db import pool,close_pool
    try:
        print(json.dumps(await reconcile_batch(await pool()),sort_keys=True))
    finally:
        await close_pool()


if __name__=='__main__':
    import asyncio
    asyncio.run(main())
