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
for i,role in enumerate(('owner','teacher','student','other-student','other-teacher','admin','unassigned-student'),801):
 uid=UUID(int=i);ids[role]=uid
 actual=role.removeprefix('other-').removeprefix('unassigned-')
 sql("INSERT INTO users(id,name,role,account_status,locale) VALUES($1,$2,$3,'active','en')",uid,'Private '+role,actual)
 c=TestClient(application,base_url='http://mock.test');c.cookies.set('la_session',core.issue_token(dict(row('SELECT * FROM users WHERE id=$1',uid))));clients[role]=c
sql('INSERT INTO teacher_student_links(teacher_user_id,student_user_id,assigned_by_user_id) VALUES($1,$2,$3)',ids['teacher'],ids['student'],ids['owner'])
for n,part in enumerate(('part1','part2','part3'),901):
 sql("INSERT INTO speaking_prompts(id,part,topic,prompt_text,category) VALUES($1,$2,$3,$4,'general')",UUID(int=n),part,part+' topic','Exact '+part+' question?')
sql("INSERT INTO speaking_prompts(id,part,topic,prompt_text,category) VALUES($1,'part1','part1 topic','Second exact question?','general')",UUID(int=904))
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
test_id=mock.get('id') or mock.get('mockTestId') or mock.get('testId')
# Keep actual schema/data untouched; simulate only optional feature detection.
from app import mock_speaking_questions as captures
original_available=captures.available
async def capability_disabled(con):return False
captures.available=capability_disabled
try:
 legacy=ok(clients['other-student'].post('/api/mocks/'+test_id+'/attempts',json={}))
 legacy_id=legacy['attemptId']
 legacy_view=ok(clients['other-student'].get('/api/mocks/attempts/'+legacy_id))['attempt']
 check(legacy_view['speakingCaptureMode']=='part','disabled optional capability preserves original Part mode')
finally:captures.available=original_available
meta={'part':'P1','codec':'wav','mimeType':'audio/wav','bytes':len(audio),'durationMs':4000,'sha256':hashlib.sha256(audio).hexdigest(),'questionIds':[str(UUID(int=901)),str(UUID(int=904))]}
intent=ok(clients['other-student'].post('/api/mocks/attempts/'+legacy_id+'/speaking/upload-intent',json=meta))
ok(clients['other-student'].put(intent['uploadUrl'],content=audio,headers={'content-type':'audio/wav'}))
final=ok(clients['other-student'].post('/api/mocks/attempts/'+legacy_id+'/speaking/upload-finalize',json={**meta,'uploadId':intent['uploadId'],'objectKey':intent['objectKey']}))
check(clients['other-student'].get('/api/resources/'+final['objectKey']).content==audio,'legacy Part audio stays privately playable')
start=ok(clients['student'].post('/api/mocks/'+test_id+'/attempts',json={}))
attempt_id=start.get('attemptId') or start.get('id');assert attempt_id,start
aid=UUID(attempt_id)
check(scalar("SELECT EXTRACT(epoch FROM w.deadline_at-r.deadline_at)::int FROM mock_section_submissions w JOIN mock_section_submissions r ON r.attempt_id=w.attempt_id AND r.skill='reading' WHERE w.attempt_id=$1 AND w.skill='writing'",aid)==3600,'Task1 and Task2 receive the full shared 60 minutes')
view=ok(clients['student'].get('/api/mocks/attempts/'+attempt_id));attempt=view.get('attempt',view)
task1=next(t for t in attempt['writingTasks'] if t['taskType']=='task1')
media=clients['student'].get(task1['mediaUrl']);check(media.status_code==200 and media.content==image,'new Mock Task1 image accessible to its learner')
audio_url='/api/mocks/media/'+versions['listening']
partial=clients['student'].get(audio_url,headers={'range':'bytes=20-39'})
check(partial.status_code==206 and partial.content==audio[20:40] and partial.headers.get('content-range')==f'bytes 20-39/{len(audio)}','Mock audio uses bounded private byte-range delivery')
check(clients['student'].get(audio_url,headers={'range':'bytes=-0'}).status_code==416,'invalid Mock byte range is rejected')
key=scalar('SELECT content_snapshot->>\'mediaObjectKey\' FROM content_versions WHERE id=$1',UUID(versions['writingTask1']))
check(clients['unassigned-student'].get('/api/resources/'+key).status_code==403,'direct resource URL cannot bypass Mock roster authorization')
check(clients['unassigned-student'].get('/api/mocks/media/'+versions['writingTask1']).status_code==403,'unassigned learner cannot read uploaded material')
check(clients['admin'].get('/api/mocks/media/'+versions['writingTask1']).status_code==403,'operational admin cannot access private mock material')
# Freeze synthetic submissions for export/round-trip checks; this does not simulate elapsed exam hours.
for task,answer in [('task1','  Original task1\n\nwith ummm & <literal>  '),('task2','Original task2 answer.')]:
 sql('UPDATE mock_writing_answers SET content=$3,word_count=5,finalized_at=now() WHERE attempt_id=$1 AND task_type=$2',aid,task,answer)
sql("UPDATE mock_section_submissions SET status='awaiting_export',submitted_at=now() WHERE attempt_id=$1 AND skill='writing'",aid)
export=ok(clients['teacher'].post('/api/staff/mocks/exports',json={'section':'writing','attemptIds':[attempt_id]}))
batch=export['batches'][0];download=clients['teacher'].get(batch['downloadUrl']);check(download.status_code==200,'Writing export download')
from docx import Document
document=Document(io.BytesIO(download.content))
check(any(p.text=='  Original task1\n\nwith ummm & <literal>  ' for p in document.paragraphs),'DOCX reader sees the exact original answer text')
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
# Per-question capture uses the site's recorder; no STT/AI endpoint is contacted.
check(attempt['speakingCaptureMode']=='question','new attempts freeze question recording mode')
sql('INSERT INTO teacher_student_links(teacher_user_id,student_user_id,assigned_by_user_id) VALUES($1,$2,$3)',ids['teacher'],ids['student'],ids['owner'])
materials=next(s['material'] for s in attempt['sections'] if s['skill']=='speaking')['parts']
endpoint='/api/mocks/attempts/'+attempt_id+'/speaking/responses'
raw_transcript='  ummm I I was uh ...\nNo correction!  '
def upload(q,client=None,transcript=raw_transcript,sha=None):
 return (client or clients['student']).post(endpoint,data={'part':q['part'],'questionId':q['questionId'],'durationMs':'4000','sha256':sha or hashlib.sha256(audio).hexdigest(),'transcriptCapture':json.dumps({'text':transcript,'status':'browser_unverified','reason':''})},files={'audio':('original.wav',audio,'audio/wav')})
check(upload(materials[0]).status_code==409,'recording before Speaking stage is refused')
sql('UPDATE mock_attempts SET active_section_position=4 WHERE id=$1',aid)
check(upload(materials[0],clients['other-student']).status_code==403,'foreign student cannot attach audio')
first=ok(upload(materials[0]));ok(upload(materials[0]))
check(scalar('SELECT count(*)::int FROM mock_speaking_question_captures WHERE attempt_id=$1',aid)==1,'question retry is idempotent')
check(upload(materials[0],transcript='changed').status_code==409,'finalized transcript cannot be replaced')
check(upload(materials[1],sha='0'*64).status_code==409,'mismatched audio digest refused')
check(clients['student'].post('/api/mocks/attempts/'+attempt_id+'/sections/speaking/submit',json={}).status_code==409,'missing question audio blocks submit')
for q in materials[1:]:ok(upload(q))
check(scalar('SELECT transcript_capture->>\'text\' FROM mock_speaking_question_captures WHERE attempt_id=$1 LIMIT 1',aid)==raw_transcript,'ummm, repetitions, whitespace and source errors stored verbatim')
reloaded=ok(clients['student'].get('/api/mocks/attempts/'+attempt_id))['attempt']
check(len(reloaded['speakingParts'])==4 and all(x.get('questionId') for x in reloaded['speakingParts']),'refresh retains individual question recordings')
check('No correction!' not in json.dumps(reloaded),'exam API does not expose transcript to learner')
for who,expected in (('student',200),('other-student',403),('teacher',200),('admin',403),('owner',200)):
 response=clients[who].get('/api/resources/'+first['objectKey'])
 check(response.status_code==expected,'private question audio scope: '+who)
 if expected==200:check(response.content==audio,'original question bytes unchanged')
ok(clients['student'].post('/api/mocks/attempts/'+attempt_id+'/sections/speaking/submit',json={}))
check(upload(materials[0],transcript='post-submit change').status_code==409,'submitted attempt cannot replace question capture')
spoken=ok(clients['teacher'].post('/api/staff/mocks/exports',json={'section':'speaking','attemptIds':[attempt_id]}))['batches'][0]
response=clients['teacher'].get(spoken['downloadUrl']);check(response.status_code==200,'Speaking ZIP download')
with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
 manifest=json.loads(archive.read('manifest.json'));recordings=manifest['attempts'][0]['parts']
 check(len(recordings)==4 and len({q['filename'] for q in recordings})==4,'one distinct original audio per question')
 check(all(archive.read(q['filename'])==audio for q in recordings),'question audio is never recompressed or rewritten')
 check(all(q['transcript']==raw_transcript and q['transcript_status']=='browser_unverified' for q in recordings),'raw transcript and honest provenance exported')
 text=archive.read('questions.txt').decode()
 offsets=[]
 for q,recording in zip(materials,recordings):
  i=text.index(q['promptText'],offsets[-1]+1 if offsets else 0);a=text.index('Audio: '+recording['filename'],i);t=text.index(raw_transcript,a)
  check(i<a<t,'question -> matching audio -> raw transcript order');offsets.append(t)
 check('Private student' not in text and 'Private student' not in json.dumps(manifest),'Speaking export excludes personal name')
# Simulate the owner's external grading JSON, then validate/import/review/publish.
item=manifest['attempts'][0]
grade={'schema_version':'la.mock.grading.v1','batch_id':manifest['batch_id'],'section':'speaking','results':[{
 'student_id':item['student_id'],'attempt_id':attempt_id,'source_sha256':item['source_sha256'],
 'rubric_version':'ielts-speaking-v1','status':'graded',
 'criteria':{'fluency_coherence':6,'lexical_resource':6,'grammar_accuracy':6,'pronunciation':6},
 'part_feedback':[{'part':q['part'],'question_id':q['questionId'],'timestamp':'00:00:01','feedback':'Synthetic transport check only.','explanation':'Evidence from matching original audio.'} for q in materials],
 'pronunciation_feedback':['Synthetic pronunciation evidence.'],'grammar_feedback':['Synthetic grammar evidence.'],
 'vocabulary_feedback':['Synthetic vocabulary evidence.'],'overall_feedback':'Synthetic pipeline verification only.','review_reason':None}]}
body={'batchId':spoken['id'],'gradingJson':grade}
bad=json.loads(json.dumps(body));bad['gradingJson']['results'][0]['part_feedback'][0]['question_id']=str(UUID(int=99999))
report=ok(clients['teacher'].post('/api/staff/mocks/grade-imports/validate',json=bad))['report']
check(not report['ok'] and any(i['errorCode']=='speaking_question_mismatch' for i in report['issues']),'wrong question grading evidence rejected')
report=ok(clients['teacher'].post('/api/staff/mocks/grade-imports/validate',json=body))['report'];check(report['ok'],'correct external grading JSON validates')
check(clients['student'].post('/api/staff/mocks/grade-imports/commit',json=body).status_code==403,'student cannot import own grade')
committed=ok(clients['teacher'].post('/api/staff/mocks/grade-imports/commit',json=body));revision=committed['revisions'][0]['revisionId']
check(scalar("SELECT status FROM mock_section_submissions WHERE attempt_id=$1 AND skill='speaking'",aid)=='imported_draft','external grade stays draft before approval')
ok(clients['teacher'].post('/api/staff/mocks/grades/'+revision+'/approve',json={}))
ok(clients['teacher'].post('/api/staff/mocks/batches/'+spoken['id']+'/publish',json={}))
section=row("SELECT status,band FROM mock_section_submissions WHERE attempt_id=$1 AND skill='speaking'",aid)
check(section['status']=='published' and section['band']==6,'server calculates and publishes approved Speaking band')
check(scalar('SELECT estimated_band FROM mock_attempts WHERE id=$1',aid) is None,'partial attempt never fabricates a full Mock band')
temporary.cleanup()
print(json.dumps({'event':'done','checks':checks,'wire':{},'result':'passed'}),flush=True)
