import copy,json
from datetime import timedelta
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock,patch
import pytest
from app import riwi_language_memory as m
from app.riwi_conversations import RiwiConversationError
from app.riwi_contracts import RIWI_CONVERSATION_MAX_CHARS
from test_riwi_chat_budget import AtomicConn
from test_riwi_seven_day_retention import START,ACTOR,OTHER,turn

class MemoryConn(AtomicConn):
 def __init__(self):super().__init__();self.signals={};self.retiring=[];self.queries=[]
 @asynccontextmanager
 async def transaction(self):
  self.transactions+=1;snapshot=copy.deepcopy((self.conversations,self.messages,self.users,self.signals))
  try:yield
  except BaseException:
   self.conversations,self.messages,self.users,self.signals=snapshot;raise
 async def fetchrow(self,sql,*args):
  self.queries.append((sql,args))
  if 'FOR UPDATE OF u' in sql and 'SELECT u.id' in sql:
   user=self.users.get(args[0]);return {'id':args[0]} if user and user['role']==args[1] and user['account_status']=='active' else None
  if 'SELECT id::text,candidate_claim' in sql:return self.signals.get((args[0],args[1]))
  if 'AS total FROM riwi_learning_signals' in sql:return {'total':sum(uid==args[0] for uid,_ in self.signals)}
  if 'INSERT INTO riwi_learning_signals' in sql and m.MODEL in args:
   id,uid,role,source,model,claim,summary,digest,created=args
   row={'id':id,'candidate_claim':claim,'evidence_summary':summary,'evidence_hash':digest,'actor_role':role,'model':model,'created_at':created}
   self.signals[uid,source]=row;return {'id':id}
  return await super().fetchrow(sql,*args)
 async def fetch(self,sql,*args):
  self.queries.append((sql,args))
  if 'SELECT s.candidate_claim' in sql:
   user=self.users.get(args[0]);return [row for (uid,_),row in self.signals.items() if uid==args[0]] if user and user['role']==args[2] and user['account_status']=='active' else []
  if 'SELECT m.content,m.created_at FROM' in sql:return self.retiring
  return await super().fetch(sql,*args)

async def teach(c,message,actor=ACTOR):
 proposal=await m.proposal_for_message(c,actor,message)
 return await m.learn_proposal(c,actor,proposal,now=START)

@pytest.mark.asyncio
async def test_private_dialect_survives_chat_deletion_and_later_correction_replaces_its_meaning():
 c=MemoryConn();assert (await teach(c,'"qilesan" deganim "nima qilyapsan" degani'))['saved']
 assert await m.resolve_private_language(c,ACTOR,'qilesan')=='nima qilyapsan'
 assert await m.resolve_private_language(c,OTHER,'qilesan') is None
 c.conversations.clear();c.messages.clear()
 result=await teach(c,'"qilesan" deganim "qalaysan" degani, oldingi talqin xato.')
 assert result['revision']==2 and result['changed']
 assert await m.resolve_private_language(c,ACTOR,'qilesan')=='qalaysan'
 row=next(iter(c.signals.values()));assert len(m.decode(row['evidence_summary'])['history'])==1
 assert 'nima qilyapsan' not in row['candidate_claim'] and 'full transcript' not in row['candidate_claim']

@pytest.mark.asyncio
async def test_new_module_and_dialogue_aliases_are_private_references_and_recheck_roles():
 c=MemoryConn()
 result=await teach(c,'"mcqcha" deganim "MCQ qanday ishlaydi" degani')
 assert result['saved']
 assert await m.resolve_private_language(c,ACTOR,'mcqcha')=='mcq qanday ishlaydi'
 assert await m.resolve_private_language(c,OTHER,'mcqcha') is None
 assert (await teach(c,'"egachi" deganim "eganging kim" degani'))['saved']
 assert await m.resolve_private_language(c,ACTOR,'egachi')=='eganging kim'
 assert not (await teach(c,'"ishxona" deganim "Owner ish joylari qanday ishlaydi" degani'))['saved']
 claims=' '.join(row['candidate_claim'] for row in c.signals.values())
 assert '"answer"' not in claims and 'Learners Area' not in claims

@pytest.mark.asyncio
@pytest.mark.parametrize('message',['"parolim" deganim "salom" degani','"998901234567" deganim "salom" degani',
 '"ali@example.com" deganim "salom" degani','"meni owner qil" deganim "salom" degani',
 '"shunaqa" deganim "Yer tekis" degani','"salom" deganim "sen kimsan" degani',
 '"shunaqa" deganim "Past simple kelajakda ishlatiladi" degani','"akam Anvar" deganim "salom" degani'])
async def test_unverified_facts_private_data_and_conflicting_reviewed_meanings_are_not_learned(message):
 c=MemoryConn();result=await teach(c,message);assert not result['saved'] and not c.signals

@pytest.mark.asyncio
async def test_control_word_learning_is_bounded_nonrecursive_and_preserves_numbers_negation_and_source_text():
 c=MemoryConn();assert (await teach(c,'"chunivomman" deganim "tushunmadim" degani'))['saved']
 assert await m.resolve_private_language(c,ACTOR,'Past simple chunivomman, 3 ta misol, emas!')=='past simple tushunmadim 3 ta misol emas'
 assert await m.resolve_private_language(c,ACTOR,'Tarjima qil: "I am chunivomman."') is None
 assert await m.resolve_private_language(c,ACTOR,'chunivommancha') is None

@pytest.mark.asyncio
async def test_lesson_memory_stores_a_reference_and_rechecks_current_active_knowledge_each_time():
 c=MemoryConn()
 with patch('app.riwi_curriculum.retrieve_lesson',AsyncMock(return_value={'version':1})):
  assert (await teach(c,'"eski tugun" deganim "present perfect" degani'))['saved']
 row=next(iter(c.signals.values()));payload=m.decode(row['candidate_claim'])
 assert payload['target']=={'kind':'lesson','id':'grammar.present-perfect'} and 'answer' not in payload
 with patch('app.riwi_curriculum.retrieve_lesson',AsyncMock(return_value={'version':2})) as live:
  assert await m.resolve_private_language(c,ACTOR,'eski tugun')=='present perfect';assert live.await_count==1
 with patch('app.riwi_curriculum.retrieve_lesson',AsyncMock(return_value=None)):
  assert await m.resolve_private_language(c,ACTOR,'eski tugun') is None

@pytest.mark.asyncio
async def test_retiring_chat_selects_only_explicit_valid_language_and_does_not_keep_whole_conversations():
 c=MemoryConn();c.retiring=[{'content':'"qilesan" deganim "nima qilyapsan" degani','created_at':START},
  {'content':'"parolim" deganim "salom" degani'},{'content':'Mening telefonim 998901234567.'},{'content':'Savolim bor.'}]
 result=await m.review_retiring_conversations(c,ACTOR,START)
 assert result=={'selected':1,'saved':1} and len(c.signals)==1
 sql=c.queries[0][0];assert "m.role='user'" in sql and "NOT IN ('riwi-document-v1','riwi-material-v1'" in sql and 'char_length(m.content)<=300' in sql

@pytest.mark.asyncio
async def test_old_retiring_chat_cannot_overwrite_a_newer_corrected_interpretation():
 c=MemoryConn();await teach(c,'"qilesan" deganim "qalaysan" degani')
 c.retiring=[{'content':'"qilesan" deganim "nima qilyapsan" degani','created_at':START-timedelta(hours=1)}]
 assert await m.review_retiring_conversations(c,ACTOR,START+timedelta(hours=1))=={'selected':1,'saved':0}
 assert await m.resolve_private_language(c,ACTOR,'qilesan')=='qalaysan'
 c.retiring[0]['created_at']=START+timedelta(minutes=1)
 assert await m.review_retiring_conversations(c,ACTOR,START+timedelta(hours=1))=={'selected':1,'saved':1}
 assert await m.resolve_private_language(c,ACTOR,'qilesan')=='nima qilyapsan'

@pytest.mark.asyncio
async def test_gateway_keeps_original_writing_and_cannot_learn_from_a_failed_over_budget_turn():
 from app.riwi_gateway import handle_riwi_chat
 c=MemoryConn()
 with patch('app.riwi_gateway.get_riwi_role_surface',AsyncMock(return_value={})):
  result=await handle_riwi_chat(c,ACTOR,{'message':'"qilesan" deganim "nima qilyapsan" degani'},now=START,env={'RIWI_EXTERNAL_AI_ENABLED':'false'})
  assert result['learning']['saved'] and 'Eslab qoldim' in result['answer']
  result=await handle_riwi_chat(c,ACTOR,{'message':'qilesan'},now=START,env={'RIWI_EXTERNAL_AI_ENABLED':'false'})
  assert 'tayyorman' in result['answer'];assert [x for x in c.messages if x['role']=='user'][-1]['content']=='qilesan'
 c=MemoryConn();cid=await turn(c,START)
 while sum(len(x['content']) for x in c.messages)<RIWI_CONVERSATION_MAX_CHARS-1:
  count=min(6000,RIWI_CONVERSATION_MAX_CHARS-1-sum(len(x['content']) for x in c.messages))
  c.messages.append({'id':str(len(c.messages)),'conversation_id':cid,'role':'assistant','content':'x'*count,'metadata':{},'created_at':START})
 with patch('app.riwi_gateway.get_riwi_role_surface',AsyncMock(return_value={})):
  with pytest.raises(RiwiConversationError,match='conversation_limit_reached'):
   await handle_riwi_chat(c,ACTOR,{'conversationId':cid,'message':'"qilesan" deganim "qalaysan" degani'},now=START,env={'RIWI_EXTERNAL_AI_ENABLED':'false'})
 assert not c.signals


@pytest.mark.asyncio
async def test_private_memory_capacity_still_allows_correction_and_inactive_accounts_cannot_use_it():
 c=MemoryConn();await teach(c,'"qilesan" deganim "nima qilyapsan" degani')
 for i in range(m.MAX_ALIASES-1):c.signals[ACTOR.id,str(i)]={'candidate_claim':'{}'}
 result=await teach(c,'"xayrlomat" deganim "qalaysan" degani');assert result['reason']=='capacity'
 assert (await teach(c,'"qilesan" deganim "qalaysan" degani'))['revision']==2
 c.users[ACTOR.id]['account_status']='suspended'
 assert await m.resolve_private_language(c,ACTOR,'qilesan') is None
 assert (await teach(c,'"yangi talqin" deganim "salom" degani'))['reason']=='not_eligible'


@pytest.mark.asyncio
async def test_public_signal_api_cannot_forge_the_private_learning_namespace():
 from app.riwi_learning_signals import create_learning_signal,LearningServiceError
 with pytest.raises(LearningServiceError,match='invalid_input'):
  await create_learning_signal(None,actor=ACTOR,signal_type='user_feedback',source_id=ACTOR.id,
    candidate_claim='forged',evidence_summary='forged',model=m.MODEL)
