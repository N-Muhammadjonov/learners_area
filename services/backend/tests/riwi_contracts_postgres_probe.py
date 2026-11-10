"""Current-main categories, immutable provenance and Owner policy on a real SQL engine.

The fixtures establish persistence and machine contracts, not semantic IELTS accuracy.
"""
import asyncio
import json
import os
from uuid import uuid4
from unittest.mock import AsyncMock,patch
from fastapi.testclient import TestClient
from riwi_postgres_probe import Connection
from app import main as core
from app import step31_coach as coach
from app import riwi_assessment_policy_store as policy
from app.riwi_capabilities import RiwiActor
from app.riwi_assessment_contracts import get_assessment_contract
from app.security import SESSION_COOKIE,issue_token

os.environ.update(AUTH_SECRET='isolated-basebook-contract-test-secret',RIWI_ENABLED='true',RIWI_EVALUATION_MODE='independent-v1')
con=Connection()
async def pool():return con
core.pool=pool
ids={k:str(uuid4()) for k in ['student','owner','line','opinion','line_draft','opinion_draft']}
checks=0
def check(value):
    global checks
    assert value
    checks+=1


async def prepare():
    for role in ['student','owner']:
        await con.execute("INSERT INTO users(id,name,email,password_hash,role,account_status,last_active_at) VALUES($1,$2,$3,'fixture',$4,'active',now())",ids[role],role,role+'@contract-probe.invalid',role)
    for name,task,category in [('line','task1','line_graph'),('opinion','task2','opinion')]:
        await con.execute("INSERT INTO writing_prompts(id,task_type,category,prompt,target_word_count) VALUES($1,$2,$3,'Authored test question; no examiner band label.',$4)",ids[name],task,category,150 if task=='task1' else 250)
        await con.execute("INSERT INTO writing_submissions(id,user_id,prompt_id,content) VALUES($1,$2,$3,$4)",ids[name+'_draft'],ids['student'],ids[name],
            'People is becoming more dependent on technology. We should provide clear evidence for each reason. '*15)
    owner=RiwiActor(id=ids['owner'],role='owner')
    created=await policy.create(con,owner,'writing.task2.*',{'maxWeaknesses':1,'maxNextActions':1})
    candidate=created['policyVersion']
    await policy.review(con,owner,candidate['id'],candidate['contentHash'],'approve')
    check(await con.fetchval('SELECT count(*) FROM evaluations')==0)

asyncio.run(prepare())
client=TestClient(core.app)
token=issue_token({'id':ids['student'],'role':'student','name':'student','locale':'en'})
headers={'Cookie':f'{SESSION_COOKIE}={token}'}
forbidden=AsyncMock(side_effect=AssertionError('Mode B attempted external inference'))
with patch.object(coach,'status',forbidden),patch.object(coach,'vendor',forbidden):
    for name,key in [('line','writing.task1.line-chart'),('opinion','writing.task2.opinion')]:
        response=client.post('/api/writing/submissions/'+ids[name+'_draft']+'/submit',headers=headers)
        assert response.status_code==200,response.text
        check(response.json()['checkedBy']=='RIWI')
        async def inspect():
            row=await con.fetchrow("SELECT * FROM evaluations WHERE source_type='writing_submission' AND source_id=$1",ids[name+'_draft'])
            contract=get_assessment_contract(key)
            check(row['assessment_contract_key']==key)
            check(row['prompt_version']==contract.version and row['rubric_version']==contract.rubric_version)
            check(row['overall_estimate'] is None and float(row['confidence'])==0)
            criteria=json.loads(row['criteria']) if isinstance(row['criteria'],str) else row['criteria']
            check(len(criteria)==4 and len({c['key'] for c in criteria})==4 and all(c['band'] is None for c in criteria))
            check(row['provider_id']=='riwi' and row['provider_type']=='internal' and row['model'] is None)
            if name=='opinion':
                check(row['owner_policy_scope']=='writing.task2.*' and row['owner_policy_version']==1)
                weaknesses=json.loads(row['weaknesses']) if isinstance(row['weaknesses'],str) else row['weaknesses']
                check(len(weaknesses)<=1)
        asyncio.run(inspect())
forbidden.assert_not_awaited()
check(True)
print(json.dumps({'event':'done','probeKind':'riwi_contracts','checks':checks,'storeChecks':checks-2,'httpChecks':2,
    'measurements':{'providerNetworkCalls':0,'semanticBandAccuracyClaimed':False}}),flush=True)
