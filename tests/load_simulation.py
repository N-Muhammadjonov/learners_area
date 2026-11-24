"""Run 10,000 synthetic accounts and paced student journeys on a disposable database."""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter, defaultdict
from contextlib import asynccontextmanager
from dataclasses import dataclass
import json
import os
from pathlib import Path
import random
import resource
from secrets import token_urlsafe
import sys
from time import perf_counter
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import asyncpg
import bcrypt
import httpx

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / 'services' / 'backend'
sys.path[:0] = [str(BACKEND), str(BACKEND / 'tests')]
from browser_fixtures import id as fixture_id, seed as seed_browser

ORIGIN = 'https://load.invalid'
LOCAL_DATABASE = 'postgresql://coin_qa:coin_qa_local@127.0.0.1:55439/coin_qa'
READING_PASSAGE = fixture_id('load-reading-paper')
GENERAL_PASSAGE = fixture_id('passage1')
LISTENING_TEST = fixture_id('listening-academic')
PASSWORD = 'Isolated-student-workload!2026'
HEARTBEAT = '/api/presence'
SESSION = '/api/frontend/session'
DASHBOARD = '/api/frontend/view?route=/app&region=dashboard'
PRACTICE = '/api/reading/general/progress'
READING = '/api/reading/attempts'
LISTENING = '/api/listening/attempts'


@dataclass(frozen=True)
class LoadOptions:
    students: int = 10_000
    learners: int = 1_000
    concurrency: int = 128
    seed: int = 20261124
    ramp_seconds: float = 3.0
    bcrypt_rounds: int = 12


class Measurements:
    def __init__(self):
        self.statuses = Counter()
        self.scenarios = Counter()
        self.latencies = defaultdict(list)
        self.inflight = 0
        self.peak_inflight = 0
        self.peak_learners = 0
        self.active_learners = 0

    async def request(self, client, name, method, path, expected: set[int], **kwargs):
        elapsed = perf_counter()
        for retry in range(4):
            self.inflight += 1
            self.peak_inflight = max(self.peak_inflight, self.inflight)
            try:
                response = await client.request(method, path, **kwargs)
            finally:
                self.inflight -= 1
            self.statuses[str(response.status_code)] += 1
            if response.status_code in expected:
                self.latencies[name].append((perf_counter() - elapsed) * 1000)
                return response
            reason = (response.json().get('reason')
                      if response.headers.get('content-type', '').startswith('application/json') else None)
            if response.status_code != 503 or reason != 'busy' or retry == 3:
                raise RuntimeError(f'{name} returned {response.status_code} ({reason}), expected {sorted(expected)}')
            await asyncio.sleep((2 ** retry) + random.uniform(.05,.45))

    def latency_report(self):
        report = {}
        for name, values in sorted(self.latencies.items()):
            ordered = sorted(values)
            report[name] = {'samples': len(ordered), 'p95_ms': round(ordered[int((len(ordered)-1)*.95)], 1)}
        return report


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def disposable_dsn(base: str, name: str) -> str:
    parsed = urlsplit(base)
    if (parsed.scheme not in {'postgresql', 'postgres'} or parsed.hostname not in {'127.0.0.1', '::1', 'localhost'}
            or parsed.path != '/coin_qa' or parsed.query or parsed.fragment):
        raise ValueError('Use the loopback coin_qa PostgreSQL service.')
    return urlunsplit((parsed.scheme, parsed.netloc, '/' + name, '', ''))


async def migrate(connection):
    deferred = set(json.loads((BACKEND / 'tests/migration-contract.json').read_text())['contentMigrations'])
    for migration in sorted((BACKEND / 'migrations').glob('*.sql')):
        if migration.name in deferred:
            continue
        for block in migration.read_text().split('--> statement-breakpoint'):
            statement = '\n'.join(line for line in block.splitlines() if not line.lstrip().startswith('--'))
            if statement.strip():
                try:
                    await connection.execute(statement)
                except asyncpg.PostgresError as error:
                    raise RuntimeError(f'Could not apply {migration.name}') from error
    for relative in json.loads((BACKEND / 'tests/platform-migrations.json').read_text()):
        async with connection.transaction():
            await connection.execute((ROOT / relative).read_text())


@asynccontextmanager
async def native_database(base: str):
    name = 'learners_capacity_' + uuid4().hex
    database_url = disposable_dsn(base, name)
    admin = await asyncpg.connect(base)
    made = False
    connection = None
    try:
        await admin.execute(f'CREATE DATABASE "{name}"')
        made = True
        os.environ.update(
            APP_ENV='test', DATABASE_URL=database_url, DATABASE_POOL_MAX='5',
            RATE_LIMIT_BACKEND='postgres', AUTH_SECRET=token_urlsafe(36),
            CLOUDFLARE_ORIGIN_SECRET='', PUBLIC_AUTH_MODE='password',
            AI_EXTERNAL_ENABLED='false', STT_PRIMARY_PROVIDER='none',
            REQUEST_BUDGET_ORDINARY='64',
        )
        from app.db import close_pool, initialize_connection
        connection = await asyncpg.connect(database_url)
        await initialize_connection(connection)
        await migrate(connection)
        yield connection
    finally:
        if connection is not None:
            from app.db import close_pool
            await close_pool()
            await connection.close()
        if made:
            await admin.execute(f'DROP DATABASE "{name}"')
        await admin.close()


async def seed_workload(connection, options: LoadOptions):
    digest = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt(rounds=options.bcrypt_rounds)).decode()
    await connection.execute("""
        INSERT INTO users(id,name,email,password_hash,role,account_status,locale,onboarding_completed_at)
        SELECT md5('capacity-student-'||n)::uuid,'Synthetic student '||n,
               'capacity-'||n||'@example.invalid',$2,'student','active','en',now()
        FROM generate_series(1,$1::int) n
        """, options.students, digest)
    first_student = await connection.fetchval("SELECT md5('capacity-student-1')::uuid")
    await seed_browser(connection, str(first_student), digest)
    await connection.execute("""
        INSERT INTO reading_passages(id,title,body_text,publication_state,suggested_minutes)
        VALUES($1,'Synthetic timed paper','Sample text for the disposable test.', 'published',20)
        """, READING_PASSAGE)
    await connection.execute("""
        INSERT INTO reading_questions(id,passage_id,"order",type,type_code,question_text,correct_answer,explanation)
        SELECT md5('capacity-question-'||n)::uuid,$1,n,'short_answer','short_answer',
               'Enter the fixture word.','fixture','Synthetic answer key.'
        FROM generate_series(1,40) n
        """, READING_PASSAGE)
    await connection.execute('ANALYZE')
    learners = await connection.fetch("""
        SELECT id,name,email,role,locale,auth_version,onboarding_completed_at
        FROM users WHERE email LIKE 'capacity-%@example.invalid'
        ORDER BY substring(email FROM 'capacity-([0-9]+)')::int LIMIT $1
        """, options.learners)
    questions = await connection.fetch(
        'SELECT id FROM reading_questions WHERE passage_id=$1 ORDER BY "order"', READING_PASSAGE)
    return learners, [str(row['id']) for row in questions]


def transport_for(application, index: int):
    async def disconnectable(scope, receive, send):
        headers = dict(scope.get('headers', ()))
        if headers.get(b'x-qa-disconnect') == b'1':
            started = False

            async def disconnected():
                nonlocal started
                if started:
                    return {'type': 'http.disconnect'}
                started = True
                message = await receive()
                body = message.get('body',b'')
                return {'type':'http.request','body':body[:len(body)//2],'more_body':True}
            await application(scope, disconnected, send)
        else:
            await application(scope, receive, send)
    return httpx.ASGITransport(app=disconnectable, client=(f'198.18.{index//250}.{index%250+1}', 54320))


async def run_workload(connection, options: LoadOptions, observed_pool=None):
    from app.asgi import application
    from app.security import SESSION_COOKIE, issue_token

    learners, reading_ids = await seed_workload(connection, options)
    require(len(learners) == options.learners, 'Incorrect learner count after seeding.')
    listening_ids = [fixture_id(f'listening-academic-{number}') for number in range(1, 41)]
    metrics = Measurements()
    scores = []
    busy_connections = peak_connections = 0

    async def sample_pool():
        nonlocal busy_connections, peak_connections
        while True:
            size = observed_pool.get_size()
            peak_connections = max(peak_connections,size)
            busy_connections = max(busy_connections,size-observed_pool.get_idle_size())
            await asyncio.sleep(.025)

    async def journey(index, learner):
        rng = random.Random(options.seed + index)
        async with httpx.AsyncClient(transport=transport_for(application, index), base_url=ORIGIN,
                                     headers={'Origin': ORIGIN}, trust_env=False, timeout=20) as client:
            async def hit(name, method, path, expected=frozenset({200}), **kwargs):
                if 'submit' not in name:
                    await asyncio.sleep(rng.uniform(.07,.30))
                return await metrics.request(client, name, method, path, expected, **kwargs)

            scenario = index % 10
            credentials = {'email':learner['email'], 'password':PASSWORD}
            if scenario == 0:
                result = await hit('login','POST','/api/auth/login',json=credentials)
                require(bool(result.cookies.get(SESSION_COOKIE)), 'Login cookie missing.')
            else:
                client.cookies.set(SESSION_COOKIE, issue_token(dict(learner)))
            presentation = await hit('session','GET',SESSION)
            require(presentation.json()['session']['user']['id'] == str(learner['id']), 'Session identity mismatch.')

            if scenario in {1,2}:
                created = await hit('reading_start','POST',READING,json={'passageId':READING_PASSAGE})
                attempt = created.json()['id']
                path = f'{READING}/{attempt}'
                answers = [{'questionId':question_id,'answer':'fixture'} for question_id in reading_ids]
                if index == 1:
                    await hit('reading_oversize','POST',path+'/submit',{400},json={'answers': answers + answers[:21]})
                await hit('reading_save','PATCH',path,json={'answers':answers})
                reopened = await hit('reading_reload','GET','/api/frontend/view',params={'route':f'/app/reading/attempts/{attempt}'})
                restored = reopened.json()['data']['detail']['answers']
                require(len(restored)==40 and all(row['userAnswer']=='fixture' for row in restored),'Reload lost saved Reading answers.')
                payload = {'answers': answers}
                if index == 1:
                    scheduled = await connection.fetchval("""
                        UPDATE reading_attempts
                        SET started_at=clock_timestamp()-interval '20 minutes'+interval '180 milliseconds'
                        WHERE id=$1 RETURNING started_at
                        """, attempt)
                    require(scheduled is not None, 'Could not set the synthetic deadline.')
                    await asyncio.sleep(.2)
                    payload = {'answers':[{**answer,'answer':'late fixture value'} for answer in answers]}
                    metrics.scenarios['deadline_saved_draft'] += 1
                first, second = await asyncio.gather(
                    hit('reading_submit','POST',path+'/submit',{200,409},json=payload),
                    hit('reading_submit','POST',path+'/submit',{200,409},json=payload))
                require({first.status_code,second.status_code} == {200,409}, 'Reading double-submit was not atomic.')
                scores.append(('reading',attempt))
                require((first if first.status_code==200 else second).json()['score']==40,'Reading score changed.')
                metrics.scenarios['reading_double_submit'] += 1
            elif scenario in {3,4}:
                created = await hit('listening_start','POST',LISTENING,json={'testId':LISTENING_TEST})
                attempt = created.json()['id']
                path = f'{LISTENING}/{attempt}'
                draft = {'answers':dict.fromkeys(listening_ids,'A'),'audioPosition':20}
                if index == 3:
                    await hit('listening_invalid_position','PUT',path+'/draft',{400},
                              json={**draft,'audioPosition':10**400})
                    await hit('listening_disconnect','PUT',path+'/draft',{400},
                              headers={'X-QA-Disconnect':'1'},json=draft)
                    metrics.scenarios['disconnect_and_resume'] += 1
                await hit('listening_save','PUT',path+'/draft',json=draft)
                answers = [{'questionId':question_id,'answer':'A'} for question_id in listening_ids]
                first, second = await asyncio.gather(
                    hit('listening_submit','POST',path+'/submit',{200,409},json={'answers':answers}),
                    hit('listening_submit','POST',path+'/submit',{200,409},json={'answers':answers}))
                require({first.status_code,second.status_code} == {200,409}, 'Listening double-submit was not atomic.')
                scores.append(('listening',attempt))
                require((first if first.status_code==200 else second).json()['score']==40,'Listening score changed.')
                metrics.scenarios['listening_double_submit'] += 1
            elif scenario in {5,6}:
                result = await hit('reading_practice','POST',PRACTICE,json={
                    'passageId':GENERAL_PASSAGE,'answers':{fixture_id('reading-1-1'):'fixture'},'check':True})
                require(result.json()['score']==1, 'General Reading practice score changed.')
                metrics.scenarios['reading_practice'] += 1
            else:
                await hit('dashboard','GET',DASHBOARD)
                await hit('presence','POST',HEARTBEAT,{204},json={'path':'/app'})
                metrics.scenarios['dashboard_presence'] += 1

            if scenario == 0:
                revoked = client.cookies.get(SESSION_COOKIE)
                await hit('logout','POST','/api/auth/logout')
                await hit('revoked_session','GET','/api/auth/state',{401},
                          headers={'Cookie': SESSION_COOKIE + '=' + revoked})
                renewed = await hit('reauthenticate','POST','/api/auth/login',json=credentials)
                require(renewed.cookies.get(SESSION_COOKIE)!=revoked,'Reauthentication did not rotate the session.')
                await hit('renewed_session','GET','/api/auth/state')
                metrics.scenarios['login_logout_renewal'] += 1

    queue = iter(enumerate(learners, start=1))

    async def worker(worker_index):
        await asyncio.sleep(options.ramp_seconds * worker_index / options.concurrency)
        for index, learner in queue:
            metrics.active_learners += 1
            metrics.peak_learners = max(metrics.peak_learners, metrics.active_learners)
            try:
                await journey(index, learner)
            finally:
                metrics.active_learners -= 1

    started = perf_counter()
    sampler = asyncio.create_task(sample_pool()) if observed_pool is not None else None
    try:
        async with asyncio.timeout(65):
            async with asyncio.TaskGroup() as tasks:
                for worker_index in range(options.concurrency):
                    tasks.create_task(worker(worker_index))
    finally:
        if sampler is not None:
            sampler.cancel()
            await asyncio.gather(sampler,return_exceptions=True)
    for skill, table in (('reading','reading_answers'),('listening','listening_answers')):
        attempt_ids = [attempt for name,attempt in scores if name==skill]
        persisted = await connection.fetchval(f"""
            SELECT count(*) FROM (
               SELECT attempt_id FROM {table}
               WHERE attempt_id=ANY($1::uuid[]) AND is_correct IS TRUE
               GROUP BY attempt_id HAVING count(*)=40
            ) AS completed
            """,attempt_ids)
        require(persisted == len(attempt_ids), f'{skill} answer rows changed after concurrent grading.')
    registered = await connection.fetchval("SELECT count(*) FROM users WHERE email LIKE 'capacity-%@example.invalid'")
    require(registered == options.students, 'Registered student total changed.')
    return {
        'registered_students':registered,'active_student_journeys':len(learners),
        'configured_workers':options.concurrency,'concurrent_virtual_students':metrics.peak_learners,
        'peak_http_requests':metrics.peak_inflight,
        'request_statuses':dict(sorted(metrics.statuses.items())),'scenarios':dict(sorted(metrics.scenarios.items())),
        'endpoint_latency':metrics.latency_report(),'elapsed_seconds':round(perf_counter()-started,2),
        'bcrypt_rounds':options.bcrypt_rounds,'transport':'ASGI','database':'disposable PostgreSQL',
        'pool_peak_connections':peak_connections if observed_pool is not None else None,
        'pool_peak_leased':busy_connections if observed_pool is not None else None,
        'process_peak_rss_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform=='darwin' else 1024),
    }


async def execute(options: LoadOptions, database_url: str) -> dict:
    async with native_database(database_url) as connection:
        from app.db import pool
        return await run_workload(connection, options, await pool())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--students',type=int,default=10_000)
    parser.add_argument('--learners',type=int,default=1_000)
    parser.add_argument('--concurrency',type=int,default=128)
    parser.add_argument('--seed',type=int,default=20261124)
    parser.add_argument('--ramp-seconds',type=float,default=3)
    parser.add_argument('--output',type=Path)
    args = parser.parse_args()
    if not 10 <= args.concurrency <= args.learners <= args.students <= 10_000 or not 0 <= args.ramp_seconds <= 30:
        parser.error('Require 10 <= concurrency <= learners <= students <= 10000 and a ramp from 0 to 30 seconds.')
    options = LoadOptions(args.students,args.learners,args.concurrency,args.seed,args.ramp_seconds)
    report = asyncio.run(execute(options, os.getenv('LOAD_SIMULATION_DATABASE_URL', LOCAL_DATABASE)))
    output = json.dumps(report,indent=2)
    if args.output:
        args.output.write_text(output+'\n')
    print(output)


if __name__ == '__main__':
    main()
