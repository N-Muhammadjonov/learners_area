import copy
from contextlib import asynccontextmanager
from datetime import timedelta
from types import SimpleNamespace
import pytest
from app.riwi_contracts import RIWI_CONVERSATION_MAX_CHARS
from app.riwi_conversations import append_conversation_turn,get_conversation_sizing,RiwiConversationError
from app.riwi_port import RiwiQueryPool,_riwi_error_response
from test_riwi_seven_day_retention import START,ACTOR,OTHER,turn
from test_riwi_phase2_auth_conversations import FakeRiwiConn

class AtomicConn(FakeRiwiConn):
 def __init__(self):
  super().__init__(START);self.transactions=0
  for actor in [ACTOR,OTHER]:self.users[actor.id]={'role':'student','account_status':'active','last_active_at':START}
 @asynccontextmanager
 async def transaction(self):
  self.transactions+=1;snapshot=copy.deepcopy((self.conversations,self.messages,self.users))
  try:yield
  except BaseException:
   self.conversations,self.messages,self.users=snapshot;raise

@pytest.mark.asyncio
async def test_server_cap_rejects_whole_turn_without_partial_insert_and_counts_unicode_characters():
 c=AtomicConn();cid=await turn(c,START)
 # Fill with valid individual message sizes, stopping just below the total cap.
 existing=sum(len(m['content']) for m in c.messages);remaining=RIWI_CONVERSATION_MAX_CHARS-existing-3
 while remaining:
  count=min(6000,remaining);remaining-=count;c.messages.append({'id':str(len(c.messages)),'conversation_id':cid,'role':'assistant','content':'🙂'*count,'metadata':{},'created_at':START})
 before=copy.deepcopy((c.conversations,c.messages))
 with pytest.raises(RiwiConversationError,match='conversation_limit_reached'):
  await turn(c,START+timedelta(minutes=1),cid)
 assert (c.conversations,c.messages)==before
 sizing=await get_conversation_sizing(c,ACTOR,cid)
 assert sizing['usedChars']==RIWI_CONVERSATION_MAX_CHARS-3 and sizing['tokenCountIsEstimate']
 assert (await get_conversation_sizing(c,OTHER,cid))['usedChars']==0
 assert _riwi_error_response(RiwiConversationError('conversation_limit_reached')).status_code==409
 fresh=await turn(c,START+timedelta(minutes=1));assert fresh!=cid
 assert (await get_conversation_sizing(c,ACTOR,fresh))['usedChars']==len('QuestionAnswer')

@pytest.mark.asyncio
async def test_http_query_pool_borrows_one_connection_for_atomic_budget_check_and_turn_insert():
 c=AtomicConn();borrows=[]
 class Pool:
  @asynccontextmanager
  async def acquire(self):borrows.append(True);yield c
 pool=RiwiQueryPool(Pool())
 cid=await turn(pool,START)
 assert cid in c.conversations and len(c.messages)==2
 assert len(borrows)==1 and c.transactions==1
