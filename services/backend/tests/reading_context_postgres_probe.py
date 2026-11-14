"""Real source-bound HTTP lookup/save against an isolated PostgreSQL engine."""
import asyncio
import hashlib
import json
import os
from uuid import UUID
from fastapi.testclient import TestClient
from stdio_postgres import Connection
from app import main as core
from app.asgi import application

os.environ['AUTH_SECRET']='isolated-reading-integration-signing-secret-20261114'
os.environ['NODE_ENV']='development'
con=Connection()
async def pool():return con
core.pool=pool
UID=UUID('11111111-1111-4111-8111-111111111111')
PID=UUID('22222222-2222-4222-8222-222222222222')
SID=UUID('33333333-3333-4333-8333-333333333333')
LEX=UUID('44444444-4444-4444-8444-444444444444')
OID=UUID('55555555-5555-4555-8555-555555555555')
body='They find out a fact.'

async def seed():
    await con.execute("INSERT INTO users(id,name,email,role,account_status,locale) VALUES($1,'Reading test learner','reading@example.test','student','active','uz')",UID)
    await con.execute("INSERT INTO reading_passages(id,title,body_text,is_active,publication_state) VALUES($1,'Isolated passage title',$2,true,'published')",PID,body)
    await con.execute("INSERT INTO general_reading_sets(id,title,publication_state) VALUES($1,'Isolated set','published')",SID)
    await con.execute('INSERT INTO general_reading_passages(passage_id,set_id,passage_no) VALUES($1,$2,1)',PID,SID)
    await con.execute("INSERT INTO lexemes(id,term,part_of_speech,definition_en,translation_uz,sense_key,provenance,verification_status) VALUES($1,'find out','phrasal verb','discover information','bilib olmoq','isolated-reading-sense','authored','verified')",LEX)
    await con.execute("INSERT INTO lexical_occurrences(id,passage_id,lexeme_id,start_char,end_char,surface_form,source_type,resolution_status) VALUES($1,$2,$3,5,13,'find out','reading','resolved')",OID,PID,LEX)
asyncio.run(seed())

async def user(req,active=False):return {'id':UID,'role':'student','account_status':'active'}
core.current_user=user
client=TestClient(application,base_url='http://preview.test')
checks=0

response=client.get('/api/vocabulary/lookup',params={'sourceType':'reading','sourceId':str(PID),'occurrenceId':str(OID)})
assert response.status_code==200,response.text
assert response.json()['contextual']['translationUz']=='bilib olmoq'
assert 'alternatives' not in response.json()
checks+=1

payload={'sourceType':'reading','sourceId':str(PID),'occurrenceId':str(OID),'folderId':None,
         'items':[{'term':'fake word','definitionEn':'injected meaning','translationUz':'noto‘g‘ri'}]}
response=client.post('/api/vocabulary',json=payload,headers={'origin':'http://preview.test'})
assert response.status_code==200,response.text
assert response.json()['added']==1
saved=asyncio.run(con.fetchrow('SELECT * FROM user_vocabulary WHERE user_id=$1',UID))
assert saved['lexeme_id']==LEX
snapshot=saved['source_snapshot'];snapshot=json.loads(snapshot) if isinstance(snapshot,str) else snapshot
assert snapshot['occurrenceId']==str(OID) and snapshot['sourceTitle']=='Isolated passage title'
assert asyncio.run(con.fetchval('SELECT name FROM vocab_folders WHERE id=$1',saved['folder_id']))=='Isolated passage title'
checks+=1

response=client.post('/api/vocabulary',json=payload,headers={'origin':'http://preview.test'})
assert response.status_code==200 and response.json()['added']==0,response.text
again=asyncio.run(con.fetchrow('SELECT * FROM user_vocabulary WHERE user_id=$1',UID))
assert saved==again,'A repeated save must preserve the complete learner/SRS row'
checks+=1

foreign=UUID('99999999-9999-4999-8999-999999999999')
response=client.get('/api/vocabulary/lookup',params={'sourceType':'reading','sourceId':str(foreign),'occurrenceId':str(OID)})
assert response.status_code==404,response.text
checks+=1

print(json.dumps({'event':'done','checks':checks,'probeKind':'reading_context','wire':{'saved':True,'saveFlowFailures':0}}),flush=True)
