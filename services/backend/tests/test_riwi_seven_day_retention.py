from datetime import datetime,timedelta,timezone
import pytest
from app.riwi_capabilities import RiwiActor
from app.riwi_conversations import append_conversation_turn,get_conversation_transcript,archive_conversation,RiwiConversationError
from app.riwi_retention import is_message_within_retention_window
from test_riwi_phase2_auth_conversations import FakeRiwiConn

START=datetime(2026,11,1,22,tzinfo=timezone.utc)
ACTOR=RiwiActor('11111111-1111-4111-8111-111111111111','student')
OTHER=RiwiActor('22222222-2222-4222-8222-222222222222','student')
def fixture():
 c=FakeRiwiConn(START)
 for actor in [ACTOR,OTHER]:c.users[actor.id]={'role':'student','account_status':'active','last_active_at':START}
 return c
async def turn(c,time,cid=None,actor=ACTOR):
 return await append_conversation_turn(c,actor=actor,conversation_id=cid,user_message='Question',assistant_answer='Answer',correlation_id='33333333-3333-4333-8333-333333333333',provenance='canonical_grammar',provider=None,citations=[],now=time)

@pytest.mark.asyncio
async def test_active_chat_expires_each_message_at_exact_deadline_without_dropping_recent_turns():
 c=fixture();cid=await turn(c,START);await turn(c,START+timedelta(days=6),cid)
 assert is_message_within_retention_window(START,START+timedelta(days=7,milliseconds=-1))
 assert not is_message_within_retention_window(START,START+timedelta(days=7))
 at=await get_conversation_transcript(c,ACTOR,cid,now=START+timedelta(days=7))
 assert len(at['messages'])==3 and at['messages'][0]['role']=='assistant'
 after=await get_conversation_transcript(c,ACTOR,cid,now=START+timedelta(days=7,milliseconds=1))
 assert len(after['messages'])==2 and after['messages'][0]['role']=='user'

@pytest.mark.asyncio
async def test_archived_chat_expires_as_a_whole_and_cannot_be_extended_or_touch_a_new_chat():
 c=fixture();old=await turn(c,START);await turn(c,START+timedelta(days=1),old)
 foreign=await turn(c,START+timedelta(days=1),actor=OTHER)
 with pytest.raises(RiwiConversationError):await archive_conversation(c,OTHER,old,now=START+timedelta(days=2))
 await archive_conversation(c,ACTOR,old,now=START+timedelta(days=2))
 assert c.conversations[old]['expires_at']==START+timedelta(days=7)
 with pytest.raises(RiwiConversationError):await turn(c,START+timedelta(days=3),old)
 fresh=await turn(c,START+timedelta(days=2));await turn(c,START+timedelta(days=6),fresh)
 with pytest.raises(RiwiConversationError):await get_conversation_transcript(c,ACTOR,old,now=START+timedelta(days=7))
 assert len((await get_conversation_transcript(c,ACTOR,fresh,now=START+timedelta(days=7)))['messages'])==4
 assert len((await get_conversation_transcript(c,OTHER,foreign,now=START+timedelta(days=7)))['messages'])==2

@pytest.mark.asyncio
async def test_new_server_conversation_archives_previous_context_even_if_client_archive_request_was_lost():
 c=fixture();old=await turn(c,START);await turn(c,START+timedelta(days=1),old)
 fresh=await turn(c,START+timedelta(days=2))
 assert c.conversations[old]['archived'] and c.conversations[old]['expires_at']==START+timedelta(days=7)
 assert fresh!=old and not c.conversations[fresh].get('archived',False)

@pytest.mark.asyncio
async def test_stale_online_activity_does_not_delete_a_chat_with_fresh_messages():
 from app.riwi_retention import purge_expired_riwi_conversations
 c=fixture();cid=await turn(c,START+timedelta(days=6));c.users[ACTOR.id]['last_active_at']=START-timedelta(days=30)
 result=await purge_expired_riwi_conversations(c,now=START+timedelta(days=7),dry_run=False)
 assert result['deletedConversations']==0 and cid in c.conversations
 assert len((await get_conversation_transcript(c,ACTOR,cid,now=START+timedelta(days=7)))['messages'])==2
