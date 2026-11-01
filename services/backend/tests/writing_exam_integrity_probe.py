"""Actual Writing exam ownership/atomic-save checks against isolated PostgreSQL."""
import asyncio,json,os
from uuid import UUID
from fastapi.testclient import TestClient
from stdio_postgres import Connection
from app import main as core
from app.asgi import application

os.environ.update(AUTH_SECRET='isolated-writing-exam-integrity-secret',APP_ENV='test',RATE_LIMIT_BACKEND='memory',PUBLIC_BASE_URL='http://exam.test')
os.environ.pop('CLOUDFLARE_ORIGIN_SECRET',None)
con=Connection()
async def pool():return con
core.pool=pool

def sql(q,*args):return asyncio.run(con.execute(q,*args))
def row(q,*args):return asyncio.run(con.fetchrow(q,*args))
def scalar(q,*args):return asyncio.run(con.fetchval(q,*args))
checks=0

def check(condition,label):
 global checks
 assert condition,label
 checks+=1

users=[UUID(int=501),UUID(int=502)]
for uid in users:sql("INSERT INTO users(id,name,role,account_status,locale) VALUES($1,'Isolated learner','student','active','en')",uid)
prompt=UUID(int=503)
sql("INSERT INTO writing_prompts(id,task_type,category,prompt,target_word_count) VALUES($1,'task2','opinion','Exact original question?',250)",prompt)
clients=[]
for uid in users:
 c=TestClient(application,base_url='http://exam.test',raise_server_exceptions=False)
 c.cookies.set('la_session',core.issue_token(dict(row('SELECT * FROM users WHERE id=$1',uid))))
 clients.append(c)
api,other=clients
started=api.post('/api/writing/exam',json={'mode':'task2','promptId':str(prompt)})
check(started.status_code==200,'start selected published prompt')
paper=started.json()['id'];paper_id=UUID(paper)
check(api.post('/api/writing/exam',json={'mode':'task2','promptId':str(prompt)}).json()['id']==paper,'start resumes original deadline')
foreign=UUID(int=504);submission=UUID(int=505)
sql("INSERT INTO writing_exam_papers(id,user_id,mode,duration_seconds,started_at,expires_at) VALUES($1,$2,'task2',2400,now()-interval '2 hours',now()-interval '80 minutes')",foreign,users[1])
sql("INSERT INTO writing_submissions(id,user_id,prompt_id,content) VALUES($1,$2,$3,'untouched foreign draft')",submission,users[1],prompt)
sql("INSERT INTO writing_exam_paper_entries(paper_id,position,task_type,prompt_id,submission_id) VALUES($1,1,'task2',$2,$3)",foreign,prompt,submission)
for response in (api.get('/api/writing/exam/'+str(foreign)),api.post('/api/writing/exam/'+str(foreign)+'/finalize',json={'reason':'submitted'})):
 check(response.status_code==404,'foreign paper denied')
 check(scalar('SELECT finalized_at IS NULL FROM writing_exam_papers WHERE id=$1',foreign),'foreign expiry unchanged')
 check(scalar('SELECT status FROM writing_submissions WHERE id=$1',submission)=='draft','foreign draft not submitted')
path='/api/writing/exam/'+paper+'/draft'
check(api.put(path,json={'position':1,'content':'first exact text','revision':1}).status_code==200,'first autosave')
original=con.execute
async def fail_content(q,*args):
 if 'UPDATE writing_submissions SET content=' in q:raise OSError('isolated injected write failure')
 return await original(q,*args)
con.execute=fail_content
try:check(api.put(path,json={'position':1,'content':'second exact text','revision':2}).status_code>=500,'failed write not acknowledged')
finally:con.execute=original
state=row('SELECT e.draft_revision,s.content FROM writing_exam_paper_entries e JOIN writing_submissions s ON s.id=e.submission_id WHERE e.paper_id=$1',paper_id)
check(state=={'draft_revision':1,'content':'first exact text'},'revision and content roll back together')
check(api.put(path,json={'position':1,'content':'second exact text','revision':2}).status_code==200,'same revision can retry after failure')
stale=api.put(path,json={'position':1,'content':'late old text','revision':1})
check(stale.status_code==409 and stale.json()['error']['code']=='draft_conflict','late different answer is not falsely acknowledged as saved')
check(api.put(path,json={'position':1,'content':'second exact text','revision':2}).status_code==200,'same-content retry is idempotent')
check(scalar('SELECT s.content FROM writing_submissions s JOIN writing_exam_paper_entries e ON e.submission_id=s.id WHERE e.paper_id=$1',paper_id)=='second exact text','late save preserves latest text')
check(api.post('/api/writing/exam/'+paper+'/finalize',json={'reason':'submitted'}).status_code==200,'owner finalizes own paper')
check(api.put(path,json={'position':1,'content':'after submit','revision':3}).status_code==409,'finalized paper rejects writes')
check(other.get('/api/writing/exam/'+str(foreign)).status_code==200,'owner can expire own paper')
check(scalar('SELECT status FROM writing_submissions WHERE id=$1',submission)=='submitted','legitimate timeout submits draft')
print(json.dumps({'event':'done','checks':checks,'wire':{},'result':'passed'}),flush=True)
