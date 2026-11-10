"""Real auth, bank visibility and history preservation on disposable PostgreSQL.

No external DSN, audio hardware, browser or production write is used.
"""
from __future__ import annotations
import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'performance_phase2'))
from isolated_db import OwnedDatabase,PASSWORD

async def run(output:Path)->None:
    output.mkdir(parents=True,exist_ok=True)
    db=OwnedDatabase(output)
    cases:list[dict]=[]
    clients=[]
    started=time.monotonic()
    def check(name:str,condition:bool)->None:
        cases.append({'name':name,'pass':bool(condition)})
        print(('PASS ' if condition else 'FAIL ')+name,flush=True)
    try:
        await db.start()
        import httpx
        from app import asgi
        from app.db import pool
        from browser_fixtures import id as fixture_id
        transport=httpx.ASGITransport(app=asgi.application)
        for email in (None,'phase2@example.test','pending@browser.example.test'):
            client=httpx.AsyncClient(transport=transport,base_url='http://localhost:4173',headers={'Origin':'http://localhost:4173'})
            clients.append(client)
            if email:
                response=await client.post('/api/auth/login',json={'email':email,'password':PASSWORD})
                check('real login '+email,response.status_code==200)
        anonymous,student,pending=clients
        pool_=await pool()
        async with pool_.acquire() as con:
            for name,state,channels in [('visible','published',['practice_alone']),('draft','draft',['practice_alone']),('ai-only','published',['ai']),('deleted','published',['practice_alone'])]:
                await con.execute('''INSERT INTO speaking_prompts(id,part,category,prompt_text,available_in,publication_state)
                  VALUES($1,'part3','part3',$2,$3::jsonb,$4)''',fixture_id('fluency-'+name),'Synthetic fluency fixture: explain this test case.',channels,state)
            deleted=fixture_id('fluency-deleted')
            await con.execute("INSERT INTO activity_events(id,user_id,type,payload) VALUES(md5('deleted-content:'||$1::text)::uuid,$2,'CONTENT_DELETED','{}'::jsonb)",deleted,fixture_id('owner'))
            before=[dict(row) for row in await con.fetch('SELECT id,status,recording_object_key,transcript FROM speaking_attempts ORDER BY id')]
        route='/api/frontend/view?route=%2Fapp%2Fspeaking%2Fspeak-or-die'
        bank='/api/speaking/practice/questions?part=part3&channel=practice_alone'
        for client,name in [(anonymous,'anonymous'),(pending,'pending')]:
            for path in (route,bank):
                response=await client.get(path)
                check(name+' denied '+path,response.status_code in (401,403))
        response=await student.get(route)
        check('authorized canonical game projection',response.status_code==200 and response.json()['data']['kind']=='speaking_fluency')
        response=await student.get(bank)
        ids={row['id'] for row in response.json().get('prompts',[])}
        check('published existing question is available without AI provider',response.status_code==200 and fixture_id('fluency-visible') in ids)
        check('draft, deleted and AI-only questions are excluded',all(fixture_id('fluency-'+name) not in ids for name in ('draft','deleted','ai-only')))
        check('question page remains bounded and no study answers are projected',len(ids)<=100 and all('studySupport' not in row for row in response.json()['prompts']))
        response=await student.get('/api/frontend/view?route=%2Fapp%2Fspeaking%2Fhistory')
        check('historical speaking recordings remain accessible to their owner',response.status_code==200 and any(row['id']==fixture_id('speaking-attempt') for row in response.json()['data']['attempts']))
        async with pool_.acquire() as con:
            after=[dict(row) for row in await con.fetch('SELECT id,status,recording_object_key,transcript FROM speaking_attempts ORDER BY id')]
        check('game entry and bank reads create no attempt and alter no historical recording',before==after)
    finally:
        for client in clients:await client.aclose()
        try:
            from app.db import close_pool
            await close_pool()
        finally:db.close()
        receipt={'scope':'owned PostgreSQL + real FastAPI auth/API, synthetic prompts only','browserQA':'OWNER_NOT_RUN','realMicrophoneQA':'OWNER_NOT_RUN','pass':sum(case['pass'] for case in cases),'fail':sum(not case['pass'] for case in cases),'elapsedSeconds':round(time.monotonic()-started,3),'cases':cases}
        (output/'integration.json').write_text(json.dumps(receipt,indent=2)+'\n')
    if not cases or any(not case['pass'] for case in cases):raise SystemExit(1)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,required=True)
    asyncio.run(run(parser.parse_args().output))
