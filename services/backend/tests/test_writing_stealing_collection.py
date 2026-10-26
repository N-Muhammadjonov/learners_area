"""Collection content validity, genuine stage projection and learner-owned writes."""
import asyncio
from datetime import datetime,timezone
from uuid import UUID,uuid4
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app import browser_writing as writing
from app import writing_stealing_collection as collection
from app.step17_stealing_workflow_port import session_view,uses,validate
from app.step23_stealing_practice import near_copy
from test_migration_phase2 import FakePool

C=TestClient(core.app)
NOW=datetime.now(timezone.utc)
UID=UUID('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')

def model_row(m):
    return {'id':UUID(m['id']),'title':m['title'],'task_type':m['taskType'],'topic':m['topic'],'target_band':m['targetBand'],'body':m['body'],'source_ref':m['sourceRef']}
def pattern_rows(mid):
    return [{'id':UUID(p['id']),'pattern':p['pattern'],'function':p['function'],'example':p['example'],'usage_note':p['usageNote']} for p in collection.DATA['patterns'] if p['modelId']==mid]
def session(m,step=1):
    return {'id':uuid4(),'model_text_id':UUID(m['id']),'user_id':UID,'step':step,'brainstorm':None,'draft':None,'comparison':None,'rewrite':None,'selected_pattern_ids':[],
      'memorised_pattern_ids':[],'rewrite_pattern_ids':[],'rewrite_available_at':None,'completed_at':None}

def test_collection_all_original_chunks_fit_schema_and_have_source_examples():
    data=collection.DATA
    assert len(data['models'])==15 and len(data['patterns'])==150 and len(data['method'])==5
    assert len({p['id'] for p in data['patterns']})==150
    assert [m['number'] for m in data['models']]==list(range(1,16))
    assert {m['targetBand'] for m in data['models']}=={8,8.5,9}
    for m in data['models']:
        assert m['body']=='\n\n'.join(m['paragraphs']) and m['wordCount']==len(m['body'].split())>=250
        assert m['estimatedBand'] is True and 'estimates' in m['provenance']
        linked=[p for p in data['patterns'] if p['modelId']==m['id']]
        assert len(linked)==10
        for p in linked:
            assert p['sourceRef']==m['id'] and p['topic']==m['topic']
            assert p['targetBand'] is None and len(p['example'])<=400 and len(p['pattern'])<=240
            assert p['example'] in m['body'] and uses(p['example'],p['pattern'])
            assert near_copy(p['example'],p['example'],p['pattern'])['nearCopy']
    assert any(p['pattern']=='the real issue is not X but Y' for p in data['patterns'])

@pytest.mark.parametrize('m',collection.DATA['models'],ids=lambda m:str(m['number']))
@pytest.mark.parametrize('step',range(1,8))
def test_original_model_and_feedback_obey_existing_seven_stage_reveal(m,step):
    class Conn:
        async def fetchrow(self,sql,*args):assert args==(UUID(m['id']),);return model_row(m)
        async def fetch(self,sql,*args):assert args==(m['id'],);return pattern_rows(m['id'])
    view=asyncio.run(session_view(Conn(),session(m,step),NOW))
    assert view['source']['prompt']==m['prompt'] and view['source']['estimatedBand'] is True
    assert view['source']['targetBand']==m['targetBand'] and view['source']['promptSourceUrl']==m['promptSourceUrl']
    assert view['modelBody']==(m['body'] if step in (1,4,5,6) else None)
    assert view['modelFeedback']==(m['feedback'] if step in (4,5,6) else None)
    assert len(view['patterns'] or [])==(10 if step in (4,5) else 0)

def test_metadata_does_not_attach_to_a_revised_or_unrelated_model():
    m=collection.DATA['models'][0];row=model_row(m)
    assert collection.metadata_for_model(row)['prompt']==m['prompt']
    for field,value in [('body','Revised essay'),('source_ref','other'),('topic','New topic'),('target_band',8.5)]:
        assert collection.metadata_for_model({**row,field:value}) is None

def test_browser_catalogue_orders_all_fifteen_sources_and_keeps_chunks_in_language_stealing(monkeypatch):
    calls=[]
    class Conn:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def fetch(self,sql,*args):
            calls.append((sql,args))
            if 'FROM writing_model_texts t' in sql:
                return [{**model_row(m),'pattern_count':10} for m in sorted(collection.DATA['models'],key=lambda m:m['title'])]
            if 'FROM writing_stealing_sessions' in sql:assert args==(UID,);return []
            if 'SELECT DISTINCT topic' in sql:return [{'topic':t} for t in sorted({m['topic'] for m in collection.DATA['models']})]
            if 'SELECT DISTINCT target_band' in sql:return []
            if 'FROM writing_language_patterns p' in sql:
                if 'ls_model' in sql:return []
                return [{'id':p['id'],'pattern':p['pattern'],'fn':p['function'],'task_type':'task2','topic':p['topic'],'target_band':None,'example':p['example'],'usage_note':p['usageNote'],'saved':False} for p in collection.DATA['patterns']]
            raise AssertionError(sql)
        async def fetchval(self,sql,*args):return 0 if 'writing_pattern_bank' in sql else 150
    con=Conn()
    async def pool():return FakePool(con)
    async def ready():return False
    monkeypatch.setattr(core,'pool',pool);monkeypatch.setattr(writing,'ai_ready',ready)
    result=asyncio.run(writing.read(None,{'id':UID},'/app/writing',{'tab':'language-stealing'},None))
    assert [s['id'] for s in result['sources']]==[m['id'] for m in collection.DATA['models']]
    assert all(s['patternCount']==10 and s['estimatedBand'] for s in result['sources'])
    assert len(result['library']['patterns'])==150 and not result['library']['hasMore']
    assert len(result['sourceCollection']['method'])==5
    assert asyncio.run(writing.patterns(con,UID,{},False))==[]

@pytest.mark.parametrize('uid',[UID,UUID('cccccccc-cccc-cccc-cccc-cccccccccccc')])
def test_starting_new_collection_uses_authenticated_student_and_original_model(monkeypatch,uid):
    model=collection.DATA['models'][0];sid=uuid4();writes=[]
    class Conn:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        def transaction(self):return self
        async def fetchval(self,sql,*args):
            assert 'CONTENT_DELETED' in sql and 'EXISTS (SELECT 1 FROM writing_language_patterns' in sql
            assert args==(model['id'],);return UUID(model['id'])
        async def execute(self,sql,*args):writes.append((sql,args))
        async def fetchrow(self,sql,*args):assert args==(uid,model['id']);return {'id':sid}
    async def current(req,active=False):return {'id':uid,'role':'student','account_status':'active'}
    async def pool():return FakePool(Conn())
    monkeypatch.setattr(core,'current_user',current);monkeypatch.setattr(core,'pool',pool)
    r=C.post('/api/writing/stealing/sessions',json={'modelTextId':model['id']})
    assert r.status_code==200 and r.json()['id']==str(sid)
    assert len(writes)==1 and writes[0][1]==(uid,model['id']) and 'ON CONFLICT(user_id,model_text_id) DO NOTHING' in writes[0][0]

def test_cross_student_session_is_not_returned_or_modified(monkeypatch):
    class Conn:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        def transaction(self):return self
        async def fetchrow(self,sql,*args):assert 'user_id=$2' in sql and args[1]==UID;return None
        async def execute(self,*args):raise AssertionError('No writes for someone else\'s session')
    async def current(req,active=False):return {'id':UID,'role':'student','account_status':'active'}
    async def pool():return FakePool(Conn())
    monkeypatch.setattr(core,'current_user',current);monkeypatch.setattr(core,'pool',pool)
    assert C.post('/api/writing/stealing/sessions/'+str(uuid4()),json={'action':'read'}).status_code==404

def test_analysis_accepts_fifty_and_seventy_chunks_but_rejects_seventy_one():
    ids=[str(uuid4()) for _ in range(71)]
    assert validate({'action':'analyse','patternIds':ids[:50]})
    assert validate({'action':'analyse','patternIds':ids[:70]})
    assert not validate({'action':'analyse','patternIds':ids})

def test_admin_capacity_error_is_clear_and_does_not_write_audit(monkeypatch):
    from app import writing_admin_content_port as admin
    class CapacityError(Exception):constraint_name='writing_language_patterns_model_capacity'
    model=collection.DATA['models'][0]
    class Conn:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        def transaction(self):return self
        async def fetchval(self,sql,*args):
            if 'FROM writing_model_texts' in sql:return UUID(model['id'])
            raise CapacityError()
        async def execute(self,*args):raise AssertionError('Rejected writes do not create an audit')
    async def pool():return FakePool(Conn())
    monkeypatch.setattr(core,'pool',pool)
    raw={'pattern':'a new chunk','function':'collocation','taskType':'task2','example':'An original example sentence.','provenance':'User material','sourceRef':model['id']}
    result=asyncio.run(admin.save_content('pattern',None,raw,{'id':UID,'locale':'uz'}))
    assert result=={'ok':False,'issues':['Bitta essayga ko‘pi bilan 70 ta ibora bog‘lash mumkin.']}
