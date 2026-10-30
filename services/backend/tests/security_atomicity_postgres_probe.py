"""Deterministic failure/race checks on fresh localhost PostgreSQL, never production."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit
from uuid import UUID

import asyncpg
import httpx
from app import main as core, db, step19_telegram_exchange_port as exchange
from app.security import SESSION_COOKIE


async def main():
    dsn = os.environ['SECURITY_TEST_DATABASE_URL']
    target = urlsplit(dsn)
    assert target.hostname in ('localhost','127.0.0.1') and target.path.startswith('/learners_security_')
    os.environ.update(DATABASE_URL=dsn, RATE_LIMIT_BACKEND='memory', PUBLIC_BASE_URL='http://security.test',
                      AUTH_SECRET='isolated-security-test-key-only')
    pool = await asyncpg.create_pool(dsn,min_size=1,max_size=5,statement_cache_size=0,init=db.initialize_connection)
    assert await pool.fetchval("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'") == 0
    for file in sorted((Path(__file__).resolve().parents[1]/'migrations').glob('*.sql')):
        for sql in file.read_text().split('--> statement-breakpoint'):
            if sql.strip():await pool.execute(sql)
    async def get_pool():return pool
    core.pool = get_pool
    async def gates(*args):return None
    exchange.gates = gates
    nonce = 'synthetic-browser-nonce'
    async def intent(n, purpose, actor=None):
        iid = UUID(int=n)
        await pool.execute("""INSERT INTO telegram_login_intents
          (id,token_hash,browser_nonce_hash,telegram_user_id,user_id,purpose,status,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,'confirmed',NOW()+INTERVAL '5 minutes')""",
          iid,hashlib.sha256(str(n).encode()).hexdigest(),hashlib.sha256(nonce.encode()).hexdigest(),str(n),actor,purpose)
        return {'intentId':str(iid),'browserNonce':nonce,'gender':'male','name':'Synthetic Learner'}
    observed = {}
    original_issue = core.issue_token
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=core.app),base_url='http://security.test') as api:
        body = await intent(6001,'register')
        def unavailable(*args):raise RuntimeError('synthetic signing failure')
        core.issue_token = unavailable
        response = await api.post('/api/auth/telegram/intent/exchange',json=body)
        core.issue_token = original_issue
        observed['failure_status'] = response.status_code
        observed['orphan_accounts'] = await pool.fetchval("SELECT count(*) FROM users WHERE telegram_id='6001'")
        observed['orphan_admissions'] = await pool.fetchval('SELECT count(*) FROM access_requests')
        assert 'set-cookie' not in response.headers
        for n, mode in [(6002,'version'),(6003,'logout')]:
            uid = UUID(int=n+100)
            await pool.execute("INSERT INTO users(id,name,role,account_status,locale) VALUES($1,'Synthetic User','student','active','en')",uid)
            user = dict(await pool.fetchrow('SELECT * FROM users WHERE id=$1',uid))
            token = original_issue(user)
            body = await intent(n,'link',uid)
            async def revoked_during_membership(*args):
                if mode=='version':
                    await pool.execute('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',uid)
                else:
                    await pool.execute("INSERT INTO auth_session_revocations(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",
                                       hashlib.sha256(token.encode()).hexdigest(),uid)
                return None
            exchange.gates = revoked_during_membership
            response = await api.post('/api/auth/telegram/intent/exchange',json=body,headers={'Cookie':SESSION_COOKIE+'='+token})
            observed[mode+'_status'] = response.status_code
            observed[mode+'_linked'] = await pool.fetchval('SELECT telegram_id FROM users WHERE id=$1',uid)
            observed[mode+'_cookie'] = 'set-cookie' in response.headers
        exchange.gates = gates
        # The same confirmed registration intent must issue one session/admission only.
        body = await intent(6004,'register')
        responses = await asyncio.gather(*[api.post('/api/auth/telegram/intent/exchange',json=body) for _ in range(2)])
        observed['race_statuses'] = sorted(r.status_code for r in responses)
        observed['race_admissions'] = await pool.fetchval("SELECT count(*) FROM access_requests r JOIN users u ON u.id=r.user_id WHERE u.telegram_id='6004'")
        # Force submission to win after DELETE's old preview read. No sleep/race timing dependency.
        uid = UUID(int=6104)
        await pool.execute("INSERT INTO users(id,name,role,account_status,locale) VALUES($1,'Speaking Learner','student','active','en')",uid)
        aid = UUID(int=6204)
        await pool.execute("INSERT INTO speaking_attempts(id,user_id,part) VALUES($1,$2,'part1')",aid,uid)
        user = dict(await pool.fetchrow('SELECT * FROM users WHERE id=$1',uid))
        token = original_issue(user)
        class Connection:
            def __init__(self, con):self.con=con
            def __getattr__(self,name):return getattr(self.con,name)
            async def fetchrow(self,sql,*args):
                row=await self.con.fetchrow(sql,*args)
                if sql.startswith('SELECT user_id,status,recording_object_key FROM speaking_attempts'):
                    await pool.execute("UPDATE speaking_attempts SET status='submitted',submitted_at=NOW() WHERE id=$1",aid)
                return row
        class Acquire:
            async def __aenter__(self):
                self.cm=pool.acquire();return Connection(await self.cm.__aenter__())
            async def __aexit__(self,*args):return await self.cm.__aexit__(*args)
        class Pool:
            def acquire(self):return Acquire()
        async def wrapped_pool():return Pool()
        core.pool=wrapped_pool
        response=await api.delete('/api/speaking/attempts/'+str(aid),headers={'Cookie':SESSION_COOKIE+'='+token})
        observed['delete_race_status']=response.status_code
        observed['submitted_attempt_survives']=await pool.fetchval('SELECT EXISTS(SELECT 1 FROM speaking_attempts WHERE id=$1)',aid)
        # The guard must retain the ordinary self-owned draft deletion path.
        other_aid=UUID(int=6205)
        await pool.execute("INSERT INTO speaking_attempts(id,user_id,part) VALUES($1,$2,'part1')",other_aid,uid)
        response=await api.delete('/api/speaking/attempts/'+str(other_aid),headers={'Cookie':SESSION_COOKIE+'='+token})
        observed['own_draft_delete_status']=response.status_code
        observed['own_draft_deleted']=not await pool.fetchval('SELECT EXISTS(SELECT 1 FROM speaking_attempts WHERE id=$1)',other_aid)
        # A distinct actor still cannot delete the submitted record.
        foreign=dict(await pool.fetchrow('SELECT * FROM users WHERE id=$1',UUID(int=6102)))
        response=await api.delete('/api/speaking/attempts/'+str(aid),headers={'Cookie':SESSION_COOKIE+'='+original_issue(foreign)})
        observed['foreign_delete_status']=response.status_code
    await pool.close()
    passed=(observed['failure_status']==500 and observed['orphan_accounts']==0 and observed['orphan_admissions']==0
      and all(observed[m+'_status']==401 and observed[m+'_linked'] is None and not observed[m+'_cookie'] for m in ('version','logout'))
      and observed['race_statuses']==[200,409] and observed['race_admissions']==1
      and observed['delete_race_status']==409 and observed['submitted_attempt_survives']
      and observed['own_draft_delete_status']==200 and observed['own_draft_deleted'] and observed['foreign_delete_status']==403)
    print(json.dumps({'result':'passed' if passed else 'failed','checks':16,'observed':observed,'database':'actual PostgreSQL','external_calls':0}),flush=True)
    assert passed or '--baseline' in sys.argv, 'security regression proof failed'


asyncio.run(main())
