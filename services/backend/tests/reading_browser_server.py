"""Local-only browser fixture: actual ASGI routes, isolated stdio PostgreSQL.

Never connects to production and never impersonates an existing learner.
"""
import asyncio
import json
import os
from pathlib import Path
from uuid import UUID
import uvicorn
from stdio_postgres import Connection

assert os.environ.get('READING_BROWSER_FIXTURE')=='isolated-local-only'
os.environ['APP_ENV']='development'
os.environ['NODE_ENV']='development'
os.environ['PUBLIC_BASE_URL']='http://127.0.0.1:4199'
os.environ['AUTH_SECRET']='isolated-browser-test-signing-secret-20261114'
from app import main as core
from app.asgi import application
from app import browser_reading
con=Connection()
async def pool():return con
core.pool=pool
UID=UUID('11111111-1111-4111-8111-111111111111')
PID=UUID('22222222-2222-4222-8222-222222222222')
SID=UUID('33333333-3333-4333-8333-333333333333')
LEX=UUID('44444444-4444-4444-8444-444444444444')
OID=UUID('55555555-5555-4555-8555-555555555555')

async def seed():
    await con.execute("INSERT INTO users(id,name,email,role,account_status,locale,onboarding_completed_at) VALUES($1,'Isolated reading learner','browser-reading@example.test','student','active','uz',NOW())",UID)
    if os.environ.get('READING_BROWSER_PAIR_SOURCE'):
        passages=json.loads(Path(os.environ['READING_BROWSER_PAIR_SOURCE']).read_text())
        assert len(passages)==2
        for index,p in enumerate(passages):
            pid=UUID(p['id'])
            sid=SID if index==0 else UUID('66666666-6666-4666-8666-666666666666')
            await con.execute("INSERT INTO reading_passages(id,title,body_text,is_active,publication_state) VALUES($1,$2,$3,true,'published')",pid,p['title'],p['body_text'])
            await con.execute("INSERT INTO general_reading_sets(id,title,publication_state) VALUES($1,$2,'published')",sid,p['title'])
            await con.execute('INSERT INTO general_reading_passages(passage_id,set_id,passage_no) VALUES($1,$2,1)',pid,sid)
            for position,text in enumerate(p['body_text'].split('\n\n')):
                await con.execute('INSERT INTO reading_passage_paragraphs(passage_id,position,text) VALUES($1,$2,$3)',pid,position,text)
            for r in p['occurrences']:
                await con.execute('INSERT INTO lexemes(id,term,part_of_speech,definition_en,translation_uz,sense_key,provenance,verification_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING',UUID(r['lexeme_id']),r['term'],r['part_of_speech'],r['definition_en'],r['translation_uz'],r['sense_key'],r['provenance'],r['verification_status'])
                await con.execute("INSERT INTO lexical_occurrences(id,passage_id,lexeme_id,start_char,end_char,surface_form,source_type,resolution_status,is_target_vocabulary) VALUES($1,$2,$3,$4,$5,$6,'reading','resolved',$7)",UUID(r['id']),pid,UUID(r['lexeme_id']),r['start_char'],r['end_char'],r['surface_form'],r['is_target_vocabulary'])
        return
    await con.execute("INSERT INTO reading_passages(id,title,body_text,is_active,publication_state) VALUES($1,'Browser passage title','They find out a fact.',true,'published')",PID)
    await con.execute("INSERT INTO general_reading_sets(id,title,publication_state) VALUES($1,'Browser reading set','published')",SID)
    await con.execute('INSERT INTO general_reading_passages(passage_id,set_id,passage_no) VALUES($1,$2,1)',PID,SID)
    await con.execute("INSERT INTO lexemes(id,term,part_of_speech,definition_en,translation_uz,sense_key,provenance,verification_status) VALUES($1,'find out','phrasal verb','discover information','bilib olmoq','browser-reading-source-sense','authored','verified')",LEX)
    await con.execute("INSERT INTO lexical_occurrences(id,passage_id,lexeme_id,start_char,end_char,surface_form,source_type,resolution_status) VALUES($1,$2,$3,5,13,'find out','reading','resolved')",OID,PID,LEX)
asyncio.run(seed())

async def current_user(req,active=False):
    return await con.fetchrow('SELECT * FROM users WHERE id=$1',UID)
core.current_user=current_user
async def current_authority(req):
    return {'user':await current_user(req),'expiresAt':4070908800}
core.current_authority=current_authority
original_layout=browser_reading.for_passage
browser_reading.for_passage=lambda id: {'passageHtml':'<p>They fi<strong>nd <em>out</em></strong> a fact.</p>','groups':{}} if str(id)==str(PID) else original_layout(id)
# One embedded PostgreSQL connection is shared by this test fixture. Serialize
# complete API requests so concurrent shell reads cannot replace its unnamed
# prepared statement or interleave another request's transaction.
api_lock=asyncio.Lock()
async def fixture_application(scope,receive,send):
    if scope['type']=='http' and scope['path'].startswith('/api/'):
        async with api_lock:
            await application(scope,receive,send)
    else:
        await application(scope,receive,send)
uvicorn.run(fixture_application,host='127.0.0.1',port=4199,log_level='warning',access_log=False,proxy_headers=False)
