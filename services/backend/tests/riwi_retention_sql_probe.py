"""Emit rollback-only PostgreSQL QA from the actual conversation functions.

All writes target transaction-local temp tables; public data is read only to
copy table definitions and verify the final fixture boundary. No credentials.
"""
import asyncio,json,sys
from datetime import datetime,timedelta,timezone
from pathlib import Path
sys.path[:0]=[str(Path(__file__).parents[1]),str(Path(__file__).parent)]
from app.riwi_conversations import append_conversation_turn,get_conversation_transcript,archive_conversation,RiwiConversationError
from app.riwi_capabilities import RiwiActor
from test_riwi_phase2_auth_conversations import FakeRiwiConn

START=datetime(2026,11,1,22,tzinfo=timezone.utc)
A=RiwiActor('11111111-1111-4111-8111-111111111111','student')
B=RiwiActor('22222222-2222-4222-8222-222222222222','student')
def literal(value):
 if value is None:return 'NULL'
 if isinstance(value,datetime):value=value.isoformat()
 if isinstance(value,list):return 'ARRAY['+','.join(literal(x) for x in value)+']'
 return "'"+str(value).replace("'","''")+"'"
class Capture(FakeRiwiConn):
 def emit(self,sql,args):
  import re
  print(re.sub(r'\$(\d+)\b',lambda m:literal(args[int(m[1])-1]),sql).strip()+';')
 async def fetchrow(self,sql,*args):self.emit(sql,args);return await super().fetchrow(sql,*args)
 async def fetch(self,sql,*args):self.emit(sql,args);return await super().fetch(sql,*args)
 async def execute(self,sql,*args):self.emit(sql,args);return await super().execute(sql,*args)
def check(expression,label):print("DO $$ BEGIN IF NOT ("+expression+") THEN RAISE EXCEPTION '"+label+"'; END IF; END $$;")
async def main():
 print('''BEGIN;
CREATE TEMP TABLE users(id uuid PRIMARY KEY,role public.role,account_status text,last_active_at timestamptz);
CREATE TEMP TABLE activity_events(user_id uuid,created_at timestamptz);
CREATE TEMP TABLE riwi_conversations(LIKE public.riwi_conversations INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE pg_temp.riwi_conversations ADD PRIMARY KEY(id);
CREATE TEMP TABLE riwi_conversation_messages(LIKE public.riwi_conversation_messages INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE pg_temp.riwi_conversation_messages ADD FOREIGN KEY(conversation_id) REFERENCES pg_temp.riwi_conversations(id) ON DELETE CASCADE;
CREATE TEMP TABLE audit_log(LIKE public.audit_log INCLUDING DEFAULTS INCLUDING CONSTRAINTS);''')
 c=Capture(START)
 for actor in [A,B]:
  c.users[actor.id]={'role':'student','account_status':'active','last_active_at':START}
  print(f"INSERT INTO pg_temp.users VALUES({literal(actor.id)},'student','active',{literal(START)});")
 async def turn(at,cid=None,actor=A):
  return await append_conversation_turn(c,actor=actor,conversation_id=cid,user_message='Synthetic question',assistant_answer='Synthetic answer',correlation_id='33333333-3333-4333-8333-333333333333',provenance='canonical_grammar',provider=None,citations=[],now=at)
 old=await turn(START);await turn(START+timedelta(days=1),old)
 try:await archive_conversation(c,B,old,now=START+timedelta(days=2))
 except RiwiConversationError:pass
 check(f"(SELECT expires_at FROM pg_temp.riwi_conversations WHERE id={literal(old)})={literal(START+timedelta(days=8,milliseconds=1))}::timestamptz",'foreign archive changed expiry')
 await archive_conversation(c,A,old,now=START+timedelta(days=2))
 check(f"(SELECT expires_at FROM pg_temp.riwi_conversations WHERE id={literal(old)})={literal(START+timedelta(days=2,minutes=30))}::timestamptz",'archive did not set thirty-minute deadline')
 check(f"EXISTS(SELECT 1 FROM pg_temp.riwi_conversation_messages WHERE conversation_id={literal(old)} AND metadata ? 'riwiArchivedAt')",'archive marker missing')
 try:await turn(START+timedelta(days=2,minutes=10),old)
 except RiwiConversationError:pass
 fresh=await turn(START+timedelta(days=2));foreign=await turn(START+timedelta(days=2),actor=B)
 await get_conversation_transcript(c,A,old,now=START+timedelta(days=2,minutes=30,milliseconds=-1))
 check(f"EXISTS(SELECT 1 FROM pg_temp.riwi_conversations WHERE id={literal(old)})",'archived chat deleted before thirty minutes')
 try:await get_conversation_transcript(c,A,old,now=START+timedelta(days=2,minutes=30))
 except RiwiConversationError:pass
 check(f"NOT EXISTS(SELECT 1 FROM pg_temp.riwi_conversations WHERE id={literal(old)})",'expired archived chat survived')
 check(f"(SELECT count(*) FROM pg_temp.riwi_conversation_messages WHERE conversation_id={literal(fresh)})=2",'archived expiry touched new chat')
 check(f"(SELECT count(*) FROM pg_temp.riwi_conversation_messages WHERE conversation_id={literal(foreign)})=2",'actor cleanup touched another learner')
 await turn(START+timedelta(days=6),fresh)
 await get_conversation_transcript(c,A,fresh,now=START+timedelta(days=9))
 check(f"(SELECT count(*) FROM pg_temp.riwi_conversation_messages WHERE conversation_id={literal(fresh)})=3",'exact user deadline not applied')
 await get_conversation_transcript(c,A,fresh,now=START+timedelta(days=9,milliseconds=1))
 check(f"(SELECT count(*) FROM pg_temp.riwi_conversation_messages WHERE conversation_id={literal(fresh)})=2",'exact assistant deadline not applied')
 print("ROLLBACK; SELECT 'passed: archive, IDOR, active-message exact boundary, new-chat isolation; all fixture writes rolled back' AS result;")
asyncio.run(main())
