import json
from uuid import UUID,uuid5,NAMESPACE_URL
from unittest.mock import AsyncMock,patch
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app import writing_study_port as port
from app.writing_study_data import study_id,source_hash,personal_patterns

USER,SESSION,MODEL,FOLDER=[UUID(int=n) for n in range(1,5)]
BODY='Alpha beta gamma delta.'
SOURCE={'id':SESSION,'model_text_id':MODEL,'body':BODY,'title':'Original essay','step':1,'completed_at':None,'task_type':'task2','topic':'Education'}
C=TestClient(core.app)
class Con:
    def __init__(self):self.saved=None;self.writes=[];self.limit=10
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    def transaction(self):return self
    async def fetchrow(self,sql,*args):
        if 'FROM users' in sql:assert args==(USER,);return {'id':USER}
        if 'SELECT payload FROM activity_events' in sql:
            assert args==(study_id(USER,MODEL),USER,port.STUDY)
            return {'payload':self.saved} if self.saved else None
        if 'FROM writing_language_patterns' in sql:return {'pattern':'Alpha beta','example':'Original example','usage_note':'Original usage','model_id':MODEL,'source_title':'Original essay'}
        raise AssertionError(sql)
    async def fetchval(self,sql,*args):
        if 'SELECT id FROM activity_events' in sql:return None
        if 'SELECT (SELECT count' in sql:return self.limit
        if 'vocab_folders' in sql:
            if 'AND user_id=$2' in sql:assert args==(FOLDER,USER)
            return FOLDER
        raise AssertionError(sql)
    async def execute(self,sql,*args):
        self.writes.append((sql,args))
        assert args[1]==USER
        if args[2]==port.STUDY:self.saved=json.loads(args[3])
        return 'INSERT 1'
class Pool:
    def __init__(self,con):self.con=con
    def acquire(self):return self.con
@pytest.fixture
def env(monkeypatch):
    con=Con();monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':USER,'role':'student','account_status':'active'}));monkeypatch.setattr(core,'pool',AsyncMock(return_value=Pool(con)));monkeypatch.setattr(port,'session_source',AsyncMock(return_value=SOURCE));monkeypatch.setattr(port,'counter',lambda *a,**k:None);return con

def value(**patches):return {'notes':'Private notes','highlights':[{'id':str(UUID(int=9)),'start':0,'end':5,'color':'blue'}],'sourceHash':source_hash(BODY),'revision':0,**patches}

def test_private_notes_and_colors_roundtrip_with_revision_and_owner_scope(env):
    url=f'/api/writing/stealing/sessions/{SESSION}/study'
    assert C.get(url).json()=={'notes':'','highlights':[],'sourceHash':source_hash(BODY),'revision':0}
    assert C.put(url,json=value()).json()=={'ok':True,'revision':1}
    got=C.get(url);assert got.headers['cache-control']=='private, no-store'
    assert got.json()['notes']=='Private notes' and got.json()['highlights']==value()['highlights']
    assert C.put(url,json=value(notes='stale other tab')).status_code==409
    assert len(env.writes)==1 and env.saved['notes']=='Private notes'
    assert C.put(url,json=value(revision=1,highlights=[])).status_code==200
    assert C.get(url).json()['highlights']==[]

@pytest.mark.parametrize('patches',[{'revision':True},{'notes':'x'*20001},{'sourceHash':'wrong'},{'highlights':[{'id':str(UUID(int=9)),'start':'bad','end':5,'color':'blue'}]},{'highlights':[{'id':str(UUID(int=9)),'start':0,'end':99,'color':'blue'}]},{'highlights':[{'id':str(UUID(int=9)),'start':0,'end':5,'color':'red'}]}])
def test_invalid_study_data_never_writes(env,patches):
    assert C.put(f'/api/writing/stealing/sessions/{SESSION}/study',json=value(**patches)).status_code==400
    assert env.writes==[]

def test_foreign_session_is_hidden_before_notes_or_pattern_writes(env,monkeypatch):
    monkeypatch.setattr(port,'session_source',AsyncMock(return_value=None))
    assert C.get(f'/api/writing/stealing/sessions/{SESSION}/study').status_code==404
    assert C.put(f'/api/writing/stealing/sessions/{SESSION}/study',json=value()).status_code==404
    assert C.post(f'/api/writing/stealing/sessions/{SESSION}/patterns',json={'pattern':'extra phrase','example':'','usageNote':''}).status_code==404
    assert env.writes==[]

def test_personal_chunk_is_private_bounded_and_keeps_the_source(env,monkeypatch):
    p={'id':str(uuid5(NAMESPACE_URL,f'learners-area:personal-pattern:{USER}:{MODEL}:extra phrase')),'sourceId':str(MODEL),'pattern':'extra phrase','personal':True}
    monkeypatch.setattr(port,'personal_patterns',AsyncMock(return_value=[p]))
    res=C.post(f'/api/writing/stealing/sessions/{SESSION}/patterns',json={'pattern':'extra phrase','example':'A useful original example.','usageNote':'My usage note.'})
    assert res.status_code==200 and res.json()['pattern']==p
    payload=json.loads(env.writes[0][1][3]);assert payload['modelId']==str(MODEL) and payload['pattern']=='extra phrase'
    assert 'writing_language_patterns' not in env.writes[0][0]
    env.limit=70
    assert C.post(f'/api/writing/stealing/sessions/{SESSION}/patterns',json={'pattern':'another phrase','example':'','usageNote':''}).status_code==409
    assert len(env.writes)==1

def test_vocabulary_save_uses_server_pattern_and_owned_folder(env,monkeypatch):
    from app import step21_vocab_batch as batch
    add=AsyncMock(return_value={'ok':True,'added':1});monkeypatch.setattr(batch,'add_batch',add)
    assert C.post(f'/api/writing/stealing/patterns/{UUID(int=6)}/vocabulary',json={'folderId':str(FOLDER)}).status_code==200
    args,kwargs=add.call_args;assert args[1]==USER and args[2][0]['term']=='Alpha beta'
    assert args[2][0]['definitionEn']=='Original usage'
    assert args[2][0]['sourceSnapshot']['sourceTitle']=='Original essay'
    assert kwargs['folder_id']==FOLDER and kwargs['source_id']==MODEL
    assert C.post(f'/api/writing/stealing/patterns/{UUID(int=6)}/vocabulary',json={'folderId':str(FOLDER),'pattern':'forged'}).status_code==400
    assert add.await_count==1

@pytest.mark.parametrize('method,path,body',[('GET','study',None),('PUT','study',value()),('POST','patterns',{}),('POST','vocabulary',{})])
def test_new_operations_deny_anonymous_before_database(monkeypatch,method,path,body):
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value=None));pool=AsyncMock(side_effect=AssertionError('No anonymous DB access'));monkeypatch.setattr(core,'pool',pool)
    url=f'/api/writing/stealing/patterns/{SESSION}/vocabulary' if path=='vocabulary' else f'/api/writing/stealing/sessions/{SESSION}/{path}'
    assert C.request(method,url,json=body).status_code==401
    assert pool.await_count==0

def test_utf16_highlights_accept_emoji_offsets_and_reject_overlaps():
    text='A😀B';a=value(sourceHash=source_hash(text),highlights=[{'id':str(UUID(int=8)),'start':1,'end':3,'color':'orange'}]);assert port.validate_study(a,text)
    a['highlights'].append({'id':str(UUID(int=9)),'start':2,'end':4,'color':'yellow'});assert not port.validate_study(a,text)
