"""Real Mock material upload, publication, learner media and export contracts; synthetic fixtures only."""
import asyncio,base64,hashlib,io,json,os,tempfile,zipfile
from uuid import UUID
from fastapi.testclient import TestClient
from stdio_postgres import Connection
from app import main as core
from app.asgi import application

os.environ.update(AUTH_SECRET='isolated-mock-workflow-signing-secret',APP_ENV='test',RATE_LIMIT_BACKEND='memory',PUBLIC_BASE_URL='http://mock.test',STORAGE_PROVIDER='local')
os.environ.pop('CLOUDFLARE_ORIGIN_SECRET',None)
temporary=tempfile.TemporaryDirectory(prefix='mock-workflow-');os.environ['STORAGE_LOCAL_DIR']=temporary.name
con=Connection()
async def pool():return con
core.pool=pool

def sql(q,*args):return asyncio.run(con.execute(q,*args))
def row(q,*args):return asyncio.run(con.fetchrow(q,*args))
def scalar(q,*args):return asyncio.run(con.fetchval(q,*args))
checks=0

def check(value,label):
 global checks
 assert value,label
 checks+=1

def ok(response):
 check(response.status_code==200,str(response.status_code)+': '+response.text[:500])
 return response.json()
clients={};ids={}
for i,role in enumerate(('owner','teacher','student','other-student','other-teacher','admin'),801):
 uid=UUID(int=i);ids[role]=uid
 actual=role.removeprefix('other-')
 sql("INSERT INTO users(id,name,role,account_status,locale) VALUES($1,$2,$3,'active','en')",uid,'Private '+role,actual)
 c=TestClient(application,base_url='http://mock.test');c.cookies.set('la_session',core.issue_token(dict(row('SELECT * FROM users WHERE id=$1',uid))));clients[role]=c
sql('INSERT INTO teacher_student_links(teacher_user_id,student_user_id,assigned_by_user_id) VALUES($1,$2,$3)',ids['teacher'],ids['student'],ids['owner'])
for n,part in enumerate(('part1','part2','part3'),901):
 sql("INSERT INTO speaking_prompts(id,part,topic,prompt_text,category) VALUES($1,$2,$3,$4,'general')",UUID(int=n),part,part+' topic','Exact '+part+' question?')
image=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5RkAAAAASUVORK5CYII=')
audio=b'RIFF'+(164).to_bytes(4,'little')+b'WAVEfmt '+(16).to_bytes(4,'little')+b'\x01\x00\x01\x00'+(8000).to_bytes(4,'little')+(16000).to_bytes(4,'little')+b'\x02\x00\x10\x00data'+(128).to_bytes(4,'little')+bytes(128)
versions={}
for slot in ('listening','reading','writingTask1','writingTask2'):
 payload={'prompt':'Exact '+slot+' prompt & <original>.'} if slot.startswith('writing') else {'questions':[{'id':str(n),'questionText':'Synthetic check '+str(n),'correctAnswer':'yes','type':'short_answer'} for n in range(1,41)]}
 if slot=='reading':payload['passages']=[{'id':'P'+str(n),'bodyText':'Synthetic transport fixture passage.'} for n in (1,2,3)]
 files={'material':(slot+'.json',json.dumps(payload).encode(),'application/json')}
 if slot=='listening':files['media']=('audio.wav',audio,'audio/wav')
 if slot=='writingTask1':files['media']=('original.png',image,'image/png')
 response=clients['teacher'].post('/api/staff/mocks/materials',data={'slot':slot,'track':'academic','title':'Synthetic '+slot},files=files)
 versions[slot]=ok(response)['id']
letter={'prompt':'Write an original General Training letter.'}
for track,expected in (('general',200),('academic',422)):
 response=clients['teacher'].post('/api/staff/mocks/materials',data={'slot':'writingTask1','track':track,'title':'Synthetic letter'},files={'material':('letter.json',json.dumps(letter).encode(),'application/json')})
 check(response.status_code==expected,'General letter needs no image; Academic visual remains required')
check(clients['student'].post('/api/staff/mocks/materials' ,data={},files={'material':('x.json',b'{}','application/json')}).status_code==403,'student cannot author')
mock=ok(clients['teacher'].post('/api/staff/mocks/authoring',json={'title':'Isolated Mock Workflow','track':'academic','publish':True,'sections':versions,'speakingTopics':{'P1':'part1 topic','P2':'part2 topic','P3':'part3 topic'},'speakingMode':'fixed'}))
test_id=mock.get('id') or mock.get('mockTestId') or mock.get('testId');start=ok(clients['student'].post('/api/mocks/'+test_id+'/attempts',json={}))
attempt_id=start.get('attemptId') or start.get('id');assert attempt_id,start
aid=UUID(attempt_id)
check(scalar("SELECT EXTRACT(epoch FROM w.deadline_at-r.deadline_at)::int FROM mock_section_submissions w JOIN mock_section_submissions r ON r.attempt_id=w.attempt_id AND r.skill='reading' WHERE w.attempt_id=$1 AND w.skill='writing'",aid)==3600,'Task1 and Task2 receive the full shared 60 minutes')
view=ok(clients['student'].get('/api/mocks/attempts/'+attempt_id));attempt=view.get('attempt',view)
task1=next(t for t in attempt['writingTasks'] if t['taskType']=='task1')
media=clients['student'].get(task1['mediaUrl']);check(media.status_code==200 and media.content==image,'new Mock Task1 image accessible to its learner')
check(clients['other-student'].get('/api/mocks/media/'+versions['writingTask1']).status_code==403,'unassigned learner cannot read uploaded material')
check(clients['admin'].get('/api/mocks/media/'+versions['writingTask1']).status_code==403,'operational admin cannot access private mock material')
# Freeze synthetic submissions for export/round-trip checks; this does not simulate elapsed exam hours.
for task,answer in [('task1','  Original task1\n\nwith ummm & <literal>  '),('task2','Original task2 answer.')]:
 sql('UPDATE mock_writing_answers SET content=$3,word_count=5,finalized_at=now() WHERE attempt_id=$1 AND task_type=$2',aid,task,answer)
sql("UPDATE mock_section_submissions SET status='awaiting_export',submitted_at=now() WHERE attempt_id=$1 AND skill='writing'",aid)
export=ok(clients['teacher'].post('/api/staff/mocks/exports',json={'section':'writing','attemptIds':[attempt_id]}))
batch=export['batches'][0];download=clients['teacher'].get(batch['downloadUrl']);check(download.status_code==200,'Writing export download')
with zipfile.ZipFile(io.BytesIO(download.content)) as z:
 check(z.read('word/media/task1_figure_1.png')==image,'Writing original figure unchanged')
 text=z.read('word/document.xml').decode();check('  Original task1' in text and '&amp; &lt;literal&gt;  ' in text,'Writing answer preserved')
 check('Private student' not in text,'export excludes names')
check(clients['other-teacher'].get(batch['downloadUrl']).status_code==403,'other Teacher cannot download batch')
sql('DELETE FROM teacher_student_links WHERE teacher_user_id=$1 AND student_user_id=$2',ids['teacher'],ids['student'])
check(clients['teacher'].get(batch['downloadUrl']).status_code==403,'revoked teacher denied batch')
check(clients['owner'].get(batch['downloadUrl']).status_code==200,'Owner can access batch')
for bad in ({'maxPerBatch':{}},{'dateFrom':'2026-02-30'},{'attemptIds':[attempt_id]*201}):
 check(clients['owner'].post('/api/staff/mocks/exports',json={'section':'writing',**bad}).status_code==400,'malformed export input controlled')
check(clients['owner'].post('/api/staff/mocks/exports',json={'section':'writing','student':'no-matching-learner'}).status_code==404,'student export filter respected')
from app.step19_storage import local_object_path
key=scalar("SELECT media_ref FROM mock_writing_answers WHERE attempt_id=$1 AND task_type='task1'",aid)
file=local_object_path(key);file.write_bytes(image+b'changed')
check(clients['owner'].get(batch['downloadUrl']).status_code==409,'changed figure refused')
file.unlink()
check(clients['owner'].get(batch['downloadUrl']).status_code==503,'missing figure never produces incomplete DOCX')
source=UUID(int=999)
sql("INSERT INTO writing_prompts(id,task_type,category,prompt,target_word_count) VALUES($1,'task2','opinion','Synthetic existing Exam source?',250)",source)
clone_ids=[]
for who in ('teacher','other-teacher'):
 clone=ok(clients[who].post('/api/staff/mocks/existing',json={'slot':'writingTask2','track':'academic','sourceId':str(source)}))
 clone_ids.append(clone['id'])
 ok(clients[who].post('/api/staff/mocks/authoring',json={'title':'Own draft '+who,'track':'academic','sections':{'writingTask2':clone['id']}}))
check(clone_ids[0]!=clone_ids[1],'each teacher binds an own immutable source version')
temporary.cleanup()
print(json.dumps({'event':'done','checks':checks,'wire':{},'result':'passed'}),flush=True)
