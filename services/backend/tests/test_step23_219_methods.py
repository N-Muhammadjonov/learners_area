"""Static and unit tests for step23, not PostgreSQL differential parity."""
import json
from pathlib import Path
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.step23_version_preview import projection,build_preview

client=TestClient(core.app)
ID=str(uuid4())
NEW={('GET','/api/vocabulary/lookup'),('GET','/api/admin/content/versions/{id}/preview')}

def test_inventory_exact():
    state=json.loads(Path('PORT_STATUS.json').read_text())
    found={(method,r.path) for r in core.app.routes for method in r.methods if r.path.startswith('/api/')}
    assert len(found)==272
    assert state['ported_methods']==272
    assert NEW<={((x['method'],x['path'])) for x in state['endpoints'] if x['status'].startswith('ported_')}

@pytest.mark.parametrize('path',('/api/vocabulary/lookup','/api/admin/content/versions/'+ID+'/preview'))
def test_anonymous_is_denied(monkeypatch,path):
    async def no_user(*args,**kwargs):return None
    async def no_pool():raise AssertionError('must not hit DB')
    monkeypatch.setattr(core,'current_user',no_user)
    monkeypatch.setattr(core,'pool',no_pool)
    assert client.get(path).status_code==401

@pytest.mark.parametrize('type,content,expected',[
 ('task1',{'prompt':'Write an essay'},'prompt'),
 ('model_text',{'body':'Example','wordCount':12},'body'),
 ('translation_set',{'sentences':[{'uzbek':'Hello'}]},'sentences'),
 ('pattern',{'pattern':'in order to'},'pattern'),
])
def test_writing_projection(type,content,expected):
    parts=projection('writing',type,content)
    assert expected in [p['key'] for p in parts]
    assert not parts[0].get('problem')

def test_invalid_preview_is_partial():
    parts=projection('writing','task1',{'prompt':''})
    assert parts[0]['problem']=='missing_prompt'

def test_grammar_preview_includes_own_answers():
    parts=projection('grammar','topic',{'explanation':'Use since','exercises':[{'correctAnswer':'B'}]})
    assert parts[1]['value']==[{'correctAnswer':'B'}]

@pytest.mark.asyncio
async def test_executable_runtime_is_never_returned():
    row={'id':ID,'module':'listening','content_type':'full_test','source_ref':'original:3',
      'version_no':2,'status':'draft','publication_state':'draft','track':'unspecified','title':'Draft',
      'target_id':None,'content_snapshot':{'runtime':'<script>secret()</script>','questions':[{'answer':'A'}]}}
    result=await build_preview(None,row)
    assert result['canonical'] is None
    assert result['status']=='MISSING'
    assert 'executable_content_redacted' in result['problems']
    assert 'secret' not in json.dumps(result)

@pytest.mark.asyncio
async def test_missing_snapshot_not_fabricated():
    row={'id':ID,'module':'writing','content_type':'task1','source_ref':'t1',
      'version_no':1,'status':'draft','publication_state':'draft','track':'unspecified','title':'Draft',
      'target_id':None,'content_snapshot':None}
    result=await build_preview(None,row)
    assert result['status']=='MISSING'
    assert result['canonical'] is None
