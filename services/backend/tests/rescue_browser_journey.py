"""Exercise the built Rescue UI against real ASGI routes and disposable PostgreSQL."""

from __future__ import annotations

import asyncio
import json
import os
import socket
from contextlib import suppress
from uuid import uuid4

import httpx
import pytest
import uvicorn

from app.asgi import application
from app.security import issue_token
from test_academy_learning_journey import ROOT, journey


@pytest.mark.asyncio
async def test_rescue_browser_journey(journey):
    conn, _ = journey
    people = {}
    for name, role in (
        ('Owner', 'owner'), ('Assigned teacher', 'teacher'), ('Unassigned teacher', 'teacher'),
        ('Test learner', 'student'), ('Guardian', 'guardian'),
    ):
        people[name] = dict(await conn.fetchrow(
            """INSERT INTO users(name,role,account_status,locale,onboarding_completed_at)
               VALUES($1,$2,'active','en',now()) RETURNING *""", name, role,
        ))
    teacher = people['Assigned teacher']['id']
    learner = people['Test learner']['id']
    course = await conn.fetchval(
        "INSERT INTO courses(slug,title) VALUES('rescue-browser','IELTS B2') RETURNING id"
    )
    group = await conn.fetchval(
        """INSERT INTO academy_groups(course_id,name,branch,room,capacity,starts_on)
           VALUES($1,'IELTS B2','Tashkent','1',40,current_date-10) RETURNING id""", course,
    )
    await conn.execute('INSERT INTO academy_group_teachers VALUES($1,$2)', group, teacher)
    await conn.execute(
        'INSERT INTO teacher_student_links(teacher_user_id,student_user_id) VALUES($1,$2)', teacher, learner,
    )
    membership = await conn.fetchval(
        """INSERT INTO academy_group_memberships(group_id,course_id,student_user_id,starts_on,activated_on,status)
           VALUES($1,$2,$3,current_date-10,current_date-10,'active') RETURNING id""", group, course, learner,
    )
    for days in (1, 2, 3):
        session = await conn.fetchval(
            """INSERT INTO academy_sessions(group_id,series_id,branch,room,starts_at,ends_at,status)
               VALUES($1,$2,'Tashkent','1',now()-$3::int*interval '1 day',
                      now()-$3::int*interval '1 day'+interval '1 hour','held') RETURNING id""", group, uuid4(), days,
        )
        await conn.execute(
            """INSERT INTO academy_attendance(session_id,membership_id,student_user_id,status,marked_at)
               VALUES($1,$2,$3,'absent',now())""", session, membership, learner,
        )
    await conn.execute(
        """WITH peers AS (
               INSERT INTO users(name,role,account_status,locale)
               SELECT 'Peer ' || n, 'student', 'active', 'en' FROM generate_series(1,26) n
               RETURNING id
           )
           INSERT INTO academy_group_memberships(group_id,course_id,student_user_id,starts_on,activated_on,status)
           SELECT $1,$2,id,current_date-10,current_date-10,'active' FROM peers""", group, course,
    )

    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        origin = f'http://127.0.0.1:{listener.getsockname()[1]}'
        config = uvicorn.Config(application, lifespan='off', log_config=None, access_log=False)
        server = uvicorn.Server(config)
        running = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            async with httpx.AsyncClient(trust_env=False) as client:
                for _ in range(100):
                    with suppress(httpx.ConnectError):
                        if (await client.get(origin+'/readyz')).status_code == 200:
                            break
                    if running.done():
                        await running
                        pytest.fail('Local ASGI server stopped before initialization')
                    await asyncio.sleep(0.05)
                else:
                    pytest.fail('Local ASGI server did not become ready')

            child = await asyncio.create_subprocess_exec(
                'node', str(ROOT/'frontend/vanilla/tests/browser-rescue-journey.mjs'),
                cwd=ROOT, env={**os.environ, 'RESCUE_TEST_ORIGIN':origin},
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            try:
                output, errors = await asyncio.wait_for(child.communicate(json.dumps({
                    'tokens': {name:issue_token(person) for name, person in people.items()},
                    'group':str(group), 'learner':str(learner), 'teacher':str(teacher),
                }).encode()), timeout=75)
            except TimeoutError:
                child.kill()
                await child.communicate()
                raise
            assert child.returncode == 0, (output.decode(), errors.decode())
            print(output.decode().strip())
        finally:
            server.should_exit = True
            await asyncio.wait_for(running, timeout=10.0)

    case = await conn.fetchrow(
        """SELECT status,revision,assigned_to FROM academy_rescue_cases
           WHERE group_id=$1 AND student_id=$2""", group, learner,
    )
    assert dict(case) == {'status':'resolved', 'revision':2, 'assigned_to':teacher}
    history = await conn.fetch(
        """SELECT action,actor_id FROM academy_rescue_actions
           WHERE group_id=$1 AND student_id=$2 ORDER BY revision""", group, learner,
    )
    assert [(row['action'],row['actor_id']) for row in history] == [('claim',teacher),('resolve',teacher)]
    assert await conn.fetchval('SELECT attendance_percent FROM academy_rescue_thresholds WHERE id=1') == 80
    print('PostgreSQL: thresholds, case revision and two audit actions verified')
