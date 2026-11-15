"""Disposable synthetic academy workload over localhost HTTP."""
from __future__ import annotations

import asyncio
import json
import os
from collections import Counter
from pathlib import Path
from time import perf_counter

import asyncpg
import httpx
import uvicorn

from app.asgi import application
from app.db import initialize_connection
from app.security import SESSION_COOKIE, issue_token

DSN = 'postgresql://coin_qa:coin_qa_local@127.0.0.1:55442/coin_qa'
ORIGIN = 'http://127.0.0.1:4197'
BACKEND = Path(__file__).resolve().parents[2]
ROOT = BACKEND.parents[1]
STUDENTS = 10_000


async def seed() -> tuple[list[dict], dict]:
    connection = await asyncpg.connect(DSN)
    await initialize_connection(connection)
    try:
        assert not await connection.fetchval("SELECT to_regclass('public.users')")
        deferred = set(json.loads((BACKEND/'tests/migration-contract.json').read_text())['contentMigrations'])
        for migration in sorted((BACKEND/'migrations').glob('*.sql')):
            if migration.name not in deferred:
                for chunk in migration.read_text().split('--> statement-breakpoint'):
                    sql = '\n'.join(line for line in chunk.splitlines() if not line.lstrip().startswith('--'))
                    if sql.strip():
                        await connection.execute(sql)
        for relative in json.loads((BACKEND/'tests/platform-migrations.json').read_text()):
            await connection.execute((ROOT/relative).read_text())
        await connection.execute(
            """INSERT INTO users(id,name,role,locale,account_status,onboarding_completed_at)
               SELECT md5(kind || n)::uuid, kind || n, kind::role, 'en','active', now()
                 FROM (VALUES ('student',10000),('guardian',1000),('teacher',100),('owner',1)) t(kind, amount)
                 CROSS JOIN LATERAL generate_series(1,amount) n"""
        )
        await connection.execute(
            """INSERT INTO courses(id,slug,title) VALUES(md5('load-course')::uuid,'load','Synthetic IELTS');
               INSERT INTO academy_groups(id,course_id,name,branch,room,capacity,starts_on)
               SELECT md5('group' || n)::uuid,md5('load-course')::uuid,'Group '||n,'Tashkent','Room '||n,100,current_date-30
                 FROM generate_series(1,100) n;
               INSERT INTO academy_group_teachers(group_id,teacher_user_id)
               SELECT md5('group' || n)::uuid,md5('teacher' || n)::uuid FROM generate_series(1,100) n;
               INSERT INTO academy_group_memberships(id,group_id,course_id,student_user_id,starts_on,activated_on,status)
               SELECT md5('member' || n)::uuid,md5('group' || (1+(n-1)/100))::uuid,md5('load-course')::uuid,
                   md5('student' || n)::uuid,current_date-30,current_date-30,'active'
                 FROM generate_series(1,10000) n;
               INSERT INTO teacher_student_links(teacher_user_id,student_user_id)
               SELECT md5('teacher' || (1+(n-1)/100))::uuid,md5('student' || n)::uuid FROM generate_series(1,10000) n;
               INSERT INTO academy_sessions(id,group_id,series_id,branch,room,starts_at,ends_at,status)
               SELECT md5('session' || g || ':' || d)::uuid,md5('group' || g)::uuid,md5('series' || g)::uuid,
                   'Tashkent','Room '||g,now()-d*interval '1 day',now()-d*interval '1 day'+interval '1 hour','held'
                 FROM generate_series(1,100) g CROSS JOIN generate_series(1,3) d;
               INSERT INTO academy_attendance(session_id,membership_id,student_user_id,status,marked_at)
               SELECT md5('session' || (1+(n-1)/100) || ':' || d)::uuid,md5('member' || n)::uuid,
                   md5('student' || n)::uuid,CASE WHEN n%8=0 THEN 'absent' ELSE 'present' END,now()
                 FROM generate_series(1,10000) n CROSS JOIN generate_series(1,3) d;
               INSERT INTO guardian_profiles(id,telegram_user_id,user_id,channel_verified_at)
               SELECT md5('guardian-profile'||n)::uuid,(7000000+n)::text,md5('guardian'||n)::uuid,now()
                 FROM generate_series(1,1000) n;
               INSERT INTO guardian_links(guardian_profile_id,student_id,status,approved_at)
               SELECT md5('guardian-profile'||n)::uuid,md5('student'||n)::uuid,'linked',now()
                 FROM generate_series(1,1000) n;
               INSERT INTO reading_passages(id,title,body_text,publication_state)
               VALUES(md5('load-passage')::uuid,'Synthetic passage','Synthetic reading content.','published');
               INSERT INTO reading_attempts(id,user_id,passage_id,status,score,total_questions,submitted_at)
               SELECT md5('attempt'||n)::uuid,md5('student'||n)::uuid,md5('load-passage')::uuid,
                   'completed',20,40,now()-interval '1 day' FROM generate_series(1,10000) n;
               INSERT INTO tuition_charges(id,student_user_id,period_key,gross_amount_minor,net_amount_minor,
                                           status,due_date,posted_at)
               SELECT md5('charge'||n)::uuid,md5('student'||n)::uuid,to_char(current_date,'YYYY-MM'),
                   600000,600000,'posted',current_date-1,now() FROM generate_series(1,10000) n;
               INSERT INTO finance_journal_entries(id,transaction_id,source_type,source_id,student_user_id)
               SELECT md5('entry'||n)::uuid,md5('transaction'||n)::uuid,'charge',md5('charge'||n)::uuid,
                   md5('student'||n)::uuid FROM generate_series(1,10000) n;
               INSERT INTO finance_journal_lines(transaction_id,entry_id,account_id,direction,amount_minor)
               SELECT md5('transaction'||n)::uuid,md5('entry'||n)::uuid,a.id,
                   CASE a.code WHEN 'accounts_receivable' THEN 'debit' ELSE 'credit' END,600000
                 FROM generate_series(1,10000) n CROSS JOIN finance_accounts a
                WHERE a.code IN ('accounts_receivable','deferred_tuition_revenue');"""
        )
        await connection.execute('ANALYZE')
        counts = {}
        for table in ('users','academy_groups','academy_attendance','reading_attempts','tuition_charges',
                      'finance_journal_lines','guardian_links'):
            counts[table] = await connection.fetchval(f'SELECT count(*) FROM {table}')
        users = [dict(row) for row in await connection.fetch(
            """SELECT id,name,locale,role,auth_version,onboarding_completed_at FROM users
               ORDER BY role, substring(name FROM '[0-9]+$')::int"""
        )]
        return users, counts
    finally:
        await connection.close()


def percentile(values: list[float], point: float) -> float:
    ordered = sorted(values)
    return round(ordered[int(point*(len(ordered)-1))], 2)


async def main() -> None:
    assert os.environ['DATABASE_URL'] == DSN
    assert os.environ.get('LOAD_TEST_ONLY') == '1' and os.environ.get('APP_ENV') == 'test'
    assert os.environ.get('RATE_LIMIT_BACKEND') == 'memory'
    started = perf_counter()
    users, volume = await seed()
    if os.getenv('ACADEMY_LOAD_EXPLAIN') == '1':
        from datetime import timedelta
        from app.academy_rescue import QUEUE_SQL
        from app.academy_journey import TIMELINE_SQL
        connection = await asyncpg.connect(DSN)
        try:
            now = await connection.fetchval('SELECT now()')
            identifiers = {user['name']:user['id'] for user in users}
            for name, sql, values in (
                ('journey',TIMELINE_SQL,[identifiers['student1'],26,0]),
                ('teacher_rescue',QUEUE_SQL,[now-timedelta(days=28),now,None,False,identifiers['teacher1'],
                    3,75,2,15,None,26,0,None]),
                ('owner_rescue',QUEUE_SQL,[now-timedelta(days=28),now,None,True,identifiers['owner1'],
                    3,75,2,15,None,26,0,None]),
            ):
                result = await connection.fetch('EXPLAIN (ANALYZE, BUFFERS) '+sql,*values)
                print(name,*(row[0] for row in result),sep='\n',flush=True)
        finally:
            await connection.close()
        return
    print(json.dumps({'fixture':volume,'seedSeconds':round(perf_counter()-started,2),
        'pool':os.getenv('DATABASE_POOL_MAX'),'admission':os.getenv('REQUEST_BUDGET_ORDINARY','64')}), flush=True)
    by_name = {user['name']:user for user in users}
    cookies = {name:SESSION_COOKIE+'='+issue_token(user) for name,user in by_name.items()}
    commands = [
        ('student', '/api/academy/journey'),
        ('student', '/api/frontend/session'),
        ('guardian', '/api/guardian/children/{child}/attendance'),
        ('teacher', '/api/staff/academy/rescue'),
        ('owner', '/api/staff/finance/summary'),
    ]
    pairs = await asyncpg.connect(DSN)
    groups = await pairs.fetch("SELECT n,md5('student'||n)::uuid AS student FROM generate_series(1,1000) n")
    await pairs.close()
    child_ids = {row['n']:row['student'] for row in groups}
    server = uvicorn.Server(uvicorn.Config(application,host='127.0.0.1',port=4197,backlog=2048,access_log=False,log_config=None))
    active = asyncio.create_task(server.serve())
    try:
        async with httpx.AsyncClient(base_url=ORIGIN, trust_env=False, timeout=15,
                                    limits=httpx.Limits(max_connections=1000,max_keepalive_connections=1000)) as api:
            for _ in range(50):
                await asyncio.sleep(.05)
                try:
                    if (await api.get('/readyz')).status_code == 200:
                        break
                except httpx.ConnectError:
                    continue
            else:
                raise RuntimeError('disposable instance is not ready')

            async def request(index: int) -> tuple[str,int,float]:
                choice = index%100
                kind, path = commands[0 if choice<45 else 1 if choice<70 else 2 if choice<85 else 3 if choice<99 else 4]
                count = {'student':STUDENTS,'guardian':1000,'teacher':100,'owner':1}[kind]
                n = index%count+1
                if kind == 'guardian':
                    path = path.format(child=child_ids[n])
                begin = perf_counter()
                try:
                    response = await api.get(path, headers={'Cookie':cookies[kind+str(n)]})
                    status = response.status_code
                    if status == 200 and path == '/api/frontend/session':
                        assert response.json()['session']['user']['id'] == str(by_name[kind+str(n)]['id'])
                    if status == 200 and kind == 'owner':
                        assert response.json()['outstandingReceivableMinor'] == 6_000_000_000
                    if status != 200 and status not in seen_errors:
                        seen_errors.add(status)
                        print(json.dumps({'firstErrorStatus':status,'path':path,'body':response.json().get('reason', 'unavailable') if status == 503 else None}), flush=True)
                except httpx.HTTPError:
                    status = 0
                return kind,status,(perf_counter()-begin)*1000

            seen_errors: set[int] = set()
            for concurrency in (50,100,250,500,1000):
                started = perf_counter()
                deadline = started+5
                async def worker(i: int) -> list[tuple[str,int,float]]:
                    output = []
                    index = i
                    while perf_counter()<deadline:
                        output.append(await request(index))
                        index += concurrency
                    return output
                results = [r for worker_output in await asyncio.gather(
                    *(worker(i) for i in range(concurrency))) for r in worker_output]
                times = [r[2] for r in results]
                status = Counter(r[1] for r in results)
                elapsed = perf_counter()-started
                print(json.dumps({'concurrency':concurrency,'requests':len(results),'seconds':round(elapsed,2),
                    'rps':round(len(results)/elapsed,2),'status':dict(sorted(status.items())),
                    'p50Ms':percentile(times,.50),'p95Ms':percentile(times,.95),'p99Ms':percentile(times,.99),
                    'successfulP95Ms':percentile([r[2] for r in results if r[1]==200],.95) if status[200] else None}),flush=True)
                await asyncio.sleep(.4)
            assert (await api.get('/readyz')).status_code == 200
    finally:
        server.should_exit = True
        await active


if __name__ == '__main__':
    asyncio.run(main())
