"""Real native website screenshots with isolated, clearly synthetic academy data."""
from __future__ import annotations

import asyncio
from contextlib import suppress
import json
import os
import socket

import httpx
import pytest
import uvicorn

from app import tuition_ledger as ledger
from app.asgi import application
from app.security import issue_token
from test_academy_learning_journey import ROOT, journey


@pytest.mark.asyncio
async def test_academy_persona_browser(journey,monkeypatch):
    conn, _ = journey
    people = {}
    for role in ('owner', 'admin', 'teacher', 'student', 'guardian'):
        people[role] = dict(await conn.fetchrow('''
            INSERT INTO users(name,role,account_status,locale,onboarding_completed_at)
            VALUES($1,$2,'active','uz',now()) RETURNING *
        ''', 'QA '+role.title(), role))
    student, teacher = people['student']['id'], people['teacher']['id']
    await conn.execute('INSERT INTO teacher_student_links(teacher_user_id,student_user_id) VALUES($1,$2)',teacher,student)
    profile = await conn.fetchval('''
        INSERT INTO guardian_profiles(telegram_user_id,user_id,display_name,language,channel_verified_at)
        VALUES('900000001',$1,'QA Guardian','uz',now()) RETURNING id
    ''', people['guardian']['id'])
    link_id=await conn.fetchval('''
        INSERT INTO guardian_links(guardian_profile_id,student_id,relationship,status,approved_at,guardian_ready_at)
        VALUES($1,$2,'mother','linked',now(),now()) RETURNING id
    ''', profile, student)
    second=await conn.fetchval("""INSERT INTO users(name,role,account_status,locale,onboarding_completed_at)
        VALUES('QA Younger','student','active','uz',now()) RETURNING id""")
    await conn.execute("""INSERT INTO guardian_links(guardian_profile_id,student_id,relationship,status,approved_at,guardian_ready_at)
        VALUES($1,$2,'mother','linked',now(),now())""",profile,second)
    day = ledger.business_date(ledger.datetime.now(ledger.timezone.utc))
    async with conn.transaction():
        charge = await ledger.create_charge(conn, actor_user_id=people['admin']['id'],student_user_id=student,
            period=ledger.period_key(day),gross_amount_minor=900000,due_date=day)
        await ledger.approve_charge(conn,actor_user_id=people['owner']['id'],charge_id=charge['id'])
        await ledger.post_charge(conn,actor_user_id=people['owner']['id'],charge_id=charge['id'])
        await ledger.record_payment(conn,actor_user_id=people['admin']['id'],student_user_id=student,
            amount_minor=100000,idempotency_key='qa-baseline-cash',payer_name='QA Guardian')
        other=await ledger.create_charge(conn,actor_user_id=people['admin']['id'],student_user_id=second,
            period=ledger.period_key(day),gross_amount_minor=300000,due_date=day)
        await ledger.approve_charge(conn,actor_user_id=people['owner']['id'],charge_id=other['id'])
        await ledger.post_charge(conn,actor_user_id=people['owner']['id'],charge_id=other['id'])
    with socket.socket() as listener:
        listener.bind(('127.0.0.1',0))
        origin = f'http://127.0.0.1:{listener.getsockname()[1]}'
        server = uvicorn.Server(uvicorn.Config(application,lifespan='off',log_config=None,access_log=False))
        running = asyncio.create_task(server.serve(sockets=[listener]))
        process=None
        try:
            async with httpx.AsyncClient(trust_env=False) as client:
                for _ in range(100):
                    with suppress(httpx.ConnectError):
                        if (await client.get(origin+'/readyz')).status_code == 200:
                            break
                    await asyncio.sleep(0.05)
                else:
                    pytest.fail('Isolated website did not become ready')
            process = await asyncio.create_subprocess_exec('node',str(ROOT/'frontend/vanilla/tests/browser-academy-ux.mjs'),
                cwd=ROOT,env={**os.environ,'ACADEMY_UX_ORIGIN':origin},stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
            output, errors = await asyncio.wait_for(process.communicate(json.dumps({
                'tokens':{role:issue_token(person) for role,person in people.items()},'studentId':str(student),
            }).encode()),timeout=180)
            assert process.returncode == 0, output.decode()+errors.decode()
            print(output.decode().strip())
            if os.getenv('ACADEMY_UX_STAGE')=='after':
                import base64
                for key,value in {'PAYME_ENVIRONMENT':'sandbox','PAYME_SANDBOX_VERIFIED':'1',
                    'PAYME_LIVE_VERIFIED':'0','PAYME_MERCHANT_ID':'isolated-browser-merchant',
                    'PAYME_KEY':'isolated-browser-key','PAYME_LOGIN':'Paycom',
                    'PAYMENTS_RETURN_ORIGIN':'https://journey.test'}.items():monkeypatch.setenv(key,value)
                process=await asyncio.create_subprocess_exec('node',str(ROOT/'frontend/vanilla/tests/browser-payment-journey.mjs'),
                    cwd=ROOT,env={**os.environ,'ACADEMY_UX_ORIGIN':origin},stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
                output,errors=await asyncio.wait_for(process.communicate(json.dumps({
                    'tokens':{role:issue_token(person) for role,person in people.items()},
                    'studentId':str(student),'secondStudentId':str(second),'guardianLinkId':str(link_id),
                    'providerAuthorization':'Basic '+base64.b64encode(b'Paycom:isolated-browser-key').decode(),
                }).encode()),timeout=120)
                assert process.returncode==0,output.decode()+errors.decode()
                print(output.decode().strip())
                assert (await ledger.student_position(conn,student))['balanceDueMinor']==462469
                assert (await ledger.student_position(conn,second))['advanceMinor']==200000
                assert (await ledger.journal_is_balanced(conn))['balanced']
                assert await conn.fetchval('SELECT count(*) FROM tuition_provider_events')==3
        finally:
            if process is not None and process.returncode is None:
                process.kill()
                await process.wait()
            server.should_exit = True
            await asyncio.wait_for(running,timeout=10)
