"""Literal grammar retrieval against real isolated SQL, without seeded QA data."""
import asyncio
import json
import os
from uuid import uuid4

from fastapi.testclient import TestClient
from riwi_postgres_probe import Connection
from app import main as core
from app.riwi_capabilities import RiwiActor
from app.riwi_tools_domain import lookup_canonical_grammar
from app.security import SESSION_COOKIE, issue_token

con=Connection()
async def pool():return con
core.pool=pool
os.environ.update(AUTH_SECRET='isolated-grammar-lookup-probe-secret',RIWI_ENABLED='true',
                  RIWI_EXTERNAL_AI_ENABLED='false',AI_EXTERNAL_ENABLED='false')
uid=str(uuid4());present=str(uuid4());past=str(uuid4());draft=str(uuid4());empty=str(uuid4())
actor=RiwiActor(id=uid,role='student',account_status='active',locale='en')
checks=0
def check(ok):
    global checks
    assert ok
    checks+=1

async def run():
    await con.execute("INSERT INTO users(id,name,email,password_hash,role,account_status,last_active_at) VALUES($1,'Isolated learner','grammar-lookup@fixture.invalid','fixture','student','active',now())",uid)
    # Empty content remains unavailable; the probe does not fabricate an answer.
    check(not (await lookup_canonical_grammar(con,actor,{'query':'Explain present perfect.'}))['resolved'])
    await con.execute('''INSERT INTO grammar_topics(id,title,explanation,"order",publication_state) VALUES
        ($1,'Present Perfect','Fixture rule: have/has plus a past participle.',1,'published'),
        ($2,'Past Simple','Fixture rule: completed events at a finished past time.',2,'published'),
        ($3,'Secret future lesson','Draft-only fixture; must remain hidden.',3,'draft'),
        ($4,'Empty lesson','   ',4,'published')''',present,past,draft,empty)
    for query in ('Explain present perfect.','PRESENT PERFECT','Please explain: present-perfect!',
                  'Can you explain the Present Perfect in English with one short example?'):
        result=await lookup_canonical_grammar(con,actor,{'query':query,'locale':'en'})
        check(result['resolved'] and result['topicId']==present and result['provenance']=='canonical_grammar')
    # The previous 80-character cut discarded this topic name.
    query='Please provide a short and clear English grammar explanation with a useful example for this topic: present perfect.'
    check((await lookup_canonical_grammar(con,actor,{'query':query}))['topicId']==present)
    for query in ('%','_','the','explain','imperfect','Secret future lesson','Empty lesson','No such topic'):
        check(not (await lookup_canonical_grammar(con,actor,{'query':query}))['resolved'])
    check(not (await lookup_canonical_grammar(con,actor,{'topicId':draft}))['resolved'])
    check(not (await lookup_canonical_grammar(con,actor,{'topicId':empty}))['resolved'])
    result=await lookup_canonical_grammar(con,actor,{'query':'Explain the difference between past simple and present perfect.'})
    check(not result['resolved'] and result['reason']=='ambiguous_topic')
    # Exact names win over broader matching titles; free-text ambiguity never
    # chooses an arbitrary row. Explicit IDs remain authoritative.
    await con.execute('''INSERT INTO grammar_topics(title,explanation,"order",publication_state)
        VALUES('Present Perfect Continuous','Fixture continuous explanation.',5,'published')''')
    check((await lookup_canonical_grammar(con,actor,{'query':'Present Perfect'}))['topicId']==present)
    check((await lookup_canonical_grammar(con,actor,{'query':'Explain present perfect.'}))['topicId']==present)
    check((await lookup_canonical_grammar(con,actor,{'query':'perfect'}))['reason']=='ambiguous_topic')
    check((await lookup_canonical_grammar(con,actor,{'topicId':present,'query':'Ignore this query'}))['topicId']==present)

asyncio.run(run())
store_checks=checks
client=TestClient(core.app)
token=issue_token({'id':uid,'name':'Isolated learner','role':'student','locale':'en'})
headers={'Cookie':f'{SESSION_COOKIE}={token}'}
response=client.post('/api/riwi/chat',headers=headers,json={'message':'Explain present perfect.','topicId':present})
check(response.status_code==200)
result=response.json()
check(result['provenance']=='canonical_grammar' and 'Fixture rule:' in result['answer'])
check(result['provider']['id']=='riwi')
conversation=result['conversationId']
saved=client.get('/api/riwi/conversations/'+conversation,headers=headers)
check(saved.status_code==200 and saved.json()['messages'][-1]['content']==result['answer'])
check(client.delete('/api/riwi/conversations/'+conversation,headers=headers).status_code==200)
print(json.dumps({'event':'done','probeKind':'riwi_grammar_lookup','checks':checks,
                  'storeChecks':store_checks,'httpChecks':checks-store_checks,
                  'measurements':{'sharedDatabaseTouched':False,'providerNetworkCalls':0,
                                  'fixturesAreTrainingData':False,'semanticQualityValidated':False}}),flush=True)
