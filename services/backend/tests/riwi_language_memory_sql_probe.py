"""Emit real-Postgres, rollback-only SQL from the language-memory functions."""
import asyncio,json,re,sys
from datetime import datetime,timedelta
from pathlib import Path
sys.path[:0]=[str(Path(__file__).parents[1]),str(Path(__file__).parent)]
from app import riwi_language_memory as m
from test_riwi_language_memory import MemoryConn,ACTOR,OTHER,START,teach

def literal(value):
 if value is None:return 'NULL'
 if isinstance(value,datetime):value=value.isoformat()
 return "'"+str(value).replace("'","''")+"'"
class Capture(MemoryConn):
 def emit(self,sql,args):print(re.sub(r'\$(\d+)\b',lambda x:literal(args[int(x[1])-1]),sql).strip()+';')
 async def fetchrow(self,sql,*args):self.emit(sql,args);return await super().fetchrow(sql,*args)
 async def fetch(self,sql,*args):self.emit(sql,args);return await super().fetch(sql,*args)
 async def execute(self,sql,*args):self.emit(sql,args);return await super().execute(sql,*args)
def check(expression,label):print("DO $$ BEGIN IF NOT ("+expression+") THEN RAISE EXCEPTION '"+label+"'; END IF; END $$;")
async def main():
 print('''BEGIN;
CREATE TEMP TABLE users(id uuid PRIMARY KEY,role public.role,account_status text,last_active_at timestamptz);
CREATE TEMP TABLE reading_attempts(user_id uuid,status text);
CREATE TEMP TABLE listening_attempts(user_id uuid,status text);
CREATE TEMP TABLE retention_attempts(user_id uuid,status text);
CREATE TEMP TABLE riwi_learning_signals(LIKE public.riwi_learning_signals INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TEMP TABLE audit_log(LIKE public.audit_log INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TEMP TABLE riwi_conversations(id uuid);
''')
 c=Capture()
 for actor in [ACTOR,OTHER]:print(f"INSERT INTO pg_temp.users VALUES({literal(actor.id)},'student','active',{literal(START)});")
 assert (await teach(c,'"qilesan" deganim "nima qilyapsan" degani'))['saved']
 check("(SELECT candidate_claim::jsonb->>'canonical' FROM pg_temp.riwi_learning_signals LIMIT 1)='nima qilyapsan'",'private interpretation not stored')
 assert await m.resolve_private_language(c,OTHER,'qilesan') is None
 check(f"NOT EXISTS(SELECT 1 FROM pg_temp.riwi_learning_signals WHERE actor_user_id={literal(OTHER.id)})",'memory crossed actor scope')
 print(f"INSERT INTO pg_temp.riwi_conversations VALUES({literal(ACTOR.id)}); DELETE FROM pg_temp.riwi_conversations;")
 check('(SELECT count(*) FROM pg_temp.riwi_learning_signals)=1','deleting chat removed reviewed language')
 assert (await teach(c,'"qilesan" deganim "qalaysan" degani'))['revision']==2
 check("(SELECT candidate_claim::jsonb->>'canonical' FROM pg_temp.riwi_learning_signals LIMIT 1)='qalaysan'",'correction did not replace old interpretation')
 check("(SELECT (candidate_claim::jsonb->>'revision')::int FROM pg_temp.riwi_learning_signals LIMIT 1)=2",'revision not advanced')
 check("(SELECT jsonb_array_length(evidence_summary::jsonb->'history') FROM pg_temp.riwi_learning_signals LIMIT 1)=1",'correction history missing')
 proposal=await m.proposal_for_message(c,ACTOR,'"qilesan" deganim "nima qilyapsan" degani')
 assert (await m.learn_proposal(c,ACTOR,proposal,now=START+timedelta(hours=1),origin='retiring_chat',observed_at=START-timedelta(hours=1)))['reason']=='newer_interpretation'
 check("(SELECT candidate_claim::jsonb->>'canonical' FROM pg_temp.riwi_learning_signals LIMIT 1)='qalaysan'",'old chat undid newer correction')
 assert not (await teach(c,'"shunaqa" deganim "Yer tekis" degani'))['saved']
 check('(SELECT count(*) FROM pg_temp.riwi_learning_signals)=1','unverified fact was stored')
 assert (await teach(c,'"chunivomman" deganim "tushunmadim" degani'))['saved']
 assert await m.resolve_private_language(c,ACTOR,'Past simple chunivomman 3 emas')=='past simple tushunmadim 3 emas'
 c.users[ACTOR.id]['account_status']='suspended';print(f"UPDATE pg_temp.users SET account_status='suspended' WHERE id={literal(ACTOR.id)};")
 assert await m.resolve_private_language(c,ACTOR,'qilesan') is None
 check("(SELECT count(*) FROM pg_temp.riwi_learning_signals s JOIN pg_temp.users u ON u.id=s.actor_user_id WHERE u.account_status='active')=0",'inactive actor could read memory')
 print("ROLLBACK; SELECT 'passed: private language upsert, correction history, stale-retirement protection, actor isolation, deletion independence, fact rejection, account gate; all fixture writes rolled back' AS result;")
if __name__=='__main__':asyncio.run(main())
