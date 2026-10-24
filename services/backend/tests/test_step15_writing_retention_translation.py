"""Migration 125->150: mocked HTTP validation and transaction-side effects.
These checks do not claim database-level or JS side-by-side parity.
"""
from __future__ import annotations
from uuid import UUID
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.retention_authoring_port import counted_words,content,structured,RetentionFault
from app.writing_admin_content_port import validate as writing_validate,Invalid
from test_migration_phase2 import FakePool

client=TestClient(core.app)
ACTOR=UUID('11111111-1111-4111-8111-111111111111')
ATTEMPT='22222222-2222-4222-8222-222222222222'
SET='33333333-3333-4333-8333-333333333333'
WORD='44444444-4444-4444-8444-444444444444'

class Db:
 def __init__(self):self.calls=[];self.next=None;self.doc=None;self.attempt=None;self.sentences=[];self.answers=[]
 async def __aenter__(self):return self
 async def __aexit__(self,*args):return False
 def transaction(self):return self
 async def execute(self,sql,*args):self.calls.append(('execute',sql,args));return 'OK'
 async def executemany(self,sql,rows):self.calls.append(('executemany',sql,rows));return 'OK'
 async def fetch(self,sql,*args):
  self.calls.append(('fetch',sql,args))
  if 'FROM grammar_exercises' in sql:return self.sentences
  if 'FROM writing_translation_sentences' in sql:return self.sentences
  if 'FROM writing_translation_answers' in sql:return self.answers
  return []
 async def fetchrow(self,sql,*args):
  self.calls.append(('fetchrow',sql,args))
  if 'writing_translation_attempts' in sql:return self.attempt
  if 'writing_translation_sets' in sql:return self.doc
  if 'RETURNING id' in sql:return {'id':UUID(WORD)}
  return self.next
 async def fetchval(self,sql,*args):
  self.calls.append(('fetchval',sql,args))
  if 'SELECT id FROM writing_translation_sets' in sql:return UUID(SET)
  if 'INSERT INTO writing_translation_attempts' in sql:return UUID(ATTEMPT)
  if 'SELECT id FROM writing_translation_attempts' in sql:return None
  if 'SELECT count(*)' in sql:return 0
  if 'RETURNING id' in sql:return UUID(WORD)
  if 'last_sequence' in sql:return 1
  if 'SELECT id FROM writing_model_texts' in sql:return UUID(WORD)
  return self.next

@pytest.fixture
def scoped(monkeypatch):
 db=Db()
 async def user(req,active=False):return {'id':ACTOR,'role':'owner','account_status':'active'}
 async def pool():return FakePool(db)
 monkeypatch.setattr(core,'current_user',user)
 monkeypatch.setattr(core,'pool',pool)
 return db

def valid_prompt():return {'taskType':'task2','category':'Coherence','prompt':'How can people study English efficiently?','targetWordCount':250}

@pytest.mark.parametrize('path,method,payload',[
 ('/api/admin/writing-prompts','post',{}),
 ('/api/admin/writing/prompt','post',{'taskType':'task2','category':'A','prompt':'too short','targetWordCount':250}),
 ('/api/admin/writing/model-text','post',{'taskType':'task2'}),
 ('/api/admin/writing/model-text/'+WORD,'put',valid_prompt()),
 ('/api/admin/writing/pattern','post',{'pattern':'x'}),
 ('/api/admin/writing/prompt','post',{**valid_prompt(),'extra':'forged'}),
])
def test_invalid_writing_has_no_db_effect(scoped,path,method,payload):
 resp=getattr(client,method)(path,json=payload)
 assert resp.status_code==400,resp.text
 assert not scoped.calls

def test_legacy_admin_writing_creates_only_draft(scoped):
 r=client.post('/api/admin/writing-prompts',json=valid_prompt())
 assert r.status_code==200,r.text
 assert r.json()=={'ok':True,'id':WORD}
 text='\n'.join(x[1] for x in scoped.calls)
 assert 'publication_state' in text and "'draft'" in text
 assert "'content.updated'" in text

def test_writing_new_create_and_edit(scoped):
 r=client.post('/api/admin/writing/prompt',json=valid_prompt())
 assert r.status_code==200 and r.json()['id']==WORD
 scoped.calls.clear()
 scoped.next=UUID(WORD)
 r=client.put('/api/admin/writing/prompt/'+WORD,json=valid_prompt())
 assert r.status_code==200
 assert any('UPDATE writing_prompts' in sql for _,sql,_ in scoped.calls)

def test_writing_band_validation_and_number_options():
 from app.writing_admin_content_port import validate
 raw={'title':'Essay','taskType':'task2','topic':'History','targetBand':8.5,
      'body':'word '*250,'provenance':'Review'}
 v=validate('model-text',raw)
 assert v['targetBand']==8.5 and v['wordCount']==250
 raw['targetBand']=7
 with pytest.raises(Invalid):validate('model-text',raw)
 t={'title':'A','topic':'Life','questionType':'opinion','targetBand':7,'promptText':'Question','provenance':'Reviewer','sentences':[]}
 assert validate('translation',t)['targetBand']==7
 t['targetBand']=8.5
 with pytest.raises(Invalid):validate('translation',t)

def test_retention_word_counter_nfkc_and_joining():
 assert counted_words("well-known don't 50,000\u00a0500") == 3
 assert counted_words('Ｌｉｆｅ １２３')==2

def good_structure():
 return {'schemaVersion':1,'maxScore':100,'claims':[{'id':'c1','label':'Explain the point','points':100,'scope':'answer',
   'groups':[{'id':'g1','points':100,'kind':'concept','anyOf':['the idea']}]}]}

def test_retention_structure_canonicalization():
 v=structured(good_structure())
 assert v['claims'][0]['groups'][0]['critical'] is False
 assert v['claims'][0]['acceptedPhrases']==[]

def test_retention_rejects_weight_not_100():
 b=good_structure();b['claims'][0]['groups'][0]['points']=99
 with pytest.raises(RetentionFault) as e:structured(b)
 assert e.value.code=='retention_invalid_structure'
 assert any(i['code']=='claim_group_points_mismatch' for i in e.value.details['issues'])

def test_retention_editor_invalid_word_length(scoped):
 b={'level':'A2','bodyText':'only a few words','scoringStructure':good_structure()}
 r=client.post('/api/admin/retention/validate',json=b)
 assert r.status_code==200
 assert r.json()['valid'] is False
 assert r.json()['error']=='retention_word_count_out_of_range'
 assert not scoped.calls

def test_retention_editor_valid(scoped):
 b={'level':'A2','bodyText':'word '*110,'scoringStructure':good_structure()}
 r=client.post('/api/admin/retention/validate',json=b)
 assert r.status_code==200,r.text
 assert r.json()=={'valid':True,'wordCount':110,'level':'A2','claims':1}
 assert not scoped.calls

def test_retention_create_writes_immutable_version(scoped):
 b={'level':'A2','bodyText':'word '*110,'scoringStructure':good_structure()}
 r=client.post('/api/admin/retention/texts',json=b)
 assert r.status_code==200,r.text
 sql=' '.join(x[1] for x in scoped.calls)
 assert 'pg_advisory_xact_lock' in sql
 assert 'INSERT INTO retention_text_versions' in sql
 assert 'UPDATE retention_texts' in sql
 assert "'retention_text.created'" in sql

def test_grammar_topic_results_nonexistent_exercise(scoped):
 r=client.post('/api/grammar/topics/'+SET+'/submit',json={'answers':[{'exerciseId':WORD,'selectedOption':'x'}]})
 assert r.status_code==404
 assert not any('INSERT INTO grammar_attempts' in sql for _,sql,_ in scoped.calls)

def test_grammar_topic_submission_atomic(scoped):
 scoped.sentences=[{'id':UUID(WORD),'correct_option':'A','explanation':'Because A'}]
 r=client.post('/api/grammar/topics/'+SET+'/submit',json={'answers':[{'exerciseId':WORD,'selectedOption':'A'}]})
 assert r.status_code==200,r.text
 assert r.json()['results'][0]['isCorrect'] is True
 sql=' '.join(x[1] for x in scoped.calls)
 assert 'INSERT INTO grammar_attempts' in sql
 assert 'INSERT INTO activity_events' in sql

def test_translation_start_refuses_invalid_shape(scoped):
 for b in ({'setId':'bad'},{'random':{'targetBand':9}},{'setId':SET,'random':{}},{}):
  resp=client.post('/api/writing/translation',json=b)
  assert resp.status_code==400
 assert not scoped.calls

def test_translation_start_selected_published(scoped):
 r=client.post('/api/writing/translation',json={'setId':SET})
 assert r.status_code==200,r.text
 assert r.json()=={'ok':True,'id':ATTEMPT,'resumed':False}

def test_translation_get_never_leaks_future_references(scoped):
 scoped.attempt={'set_id':UUID(SET),'status':'in_progress','overall_estimate':None,'meaning_score':None,
 'grammar_band':None,'vocabulary_band':None,'elapsed_ms':None}
 scoped.doc={'title':'Essay','topic':'Writing','question_type':'opinion','target_band':7,'prompt_text':'Question?'}
 scoped.sentences=[{'id':UUID(WORD),'position':1,'uzbek_source':'Mahalliy gap','model_english':'SECRET ENGLISH',
   'notes':['NEVER LEAK'],'target_lexical_items':[]}]
 r=client.get('/api/writing/translation/'+ATTEMPT)
 assert r.status_code==200,r.text
 assert r.json()['view']['current']['uzbek']=='Mahalliy gap'
 assert 'SECRET ENGLISH' not in r.text and 'NEVER LEAK' not in r.text

@pytest.mark.parametrize('path,method',[('/api/admin/retention/validate','post'),('/api/admin/writing/prompt','post'),
 ('/api/writing/translation','post'),('/api/grammar/topics/'+SET+'/submit','post')])
def test_auth_required(scoped,monkeypatch,path,method):
 async def guest(req,active=False):return None
 monkeypatch.setattr(core,'current_user',guest)
 r=getattr(client,method)(path,json={})
 assert r.status_code in (401,403)
 assert not scoped.calls
