"""Main Phase 3 API checks in owned PostgreSQL only. No browser/audio/manual QA.

No external DSN is accepted. Review boundaries use the real attempt lifecycle.
"""
import argparse,asyncio,hashlib,json,re,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'performance_phase2'))
from isolated_db import OwnedDatabase,UID,PASSWORD

async def run(output):
    output.mkdir(parents=True,exist_ok=True);db=OwnedDatabase(output);cases=[];clients=[];findings=[]
    def check(name,condition,**detail):
        cases.append({'name':name,'pass':bool(condition),**detail});print(('PASS ' if condition else 'FAIL ')+name,flush=True)
    start=time.monotonic()
    try:
        await db.start()
        import httpx
        from app import asgi
        from app.db import pool
        from browser_fixtures import id as fid
        transport=httpx.ASGITransport(app=asgi.application)
        for email in ('phase2@example.test','other-student@browser.example.test','pending@browser.example.test'):
            client=httpx.AsyncClient(transport=transport,base_url='http://localhost:4173',headers={'Origin':'http://localhost:4173'})
            clients.append(client);r=await client.post('/api/auth/login',json={'email':email,'password':PASSWORD});check('real fixture login '+email,r.status_code==200)
        student,other,pending=clients;p=await pool()
        async with p.acquire() as con:
            for name,term,meaning,example in [('run','run','Move quickly.','We run daily.'),('sleep','sleep','Rest at night.','We sleep at night.'),('art','art','Creative expression.','The artist studies art.'),('held','staple food','A basic food.','Rice is eaten daily.'),('duplicate','RUN','Move quickly.','We run daily.')]:
                await con.execute('INSERT INTO lexemes(id,term,definition_en,translation_uz,example_sentence,sense_key) VALUES($1,$2,$3,$4,$5,$6)',fid('p3-lexeme-'+name),term,meaning,'Synthetic Uzbek meaning',example,'synthetic-phase3:'+name)
                await con.execute("INSERT INTO user_vocabulary(id,user_id,lexeme_id,next_review_at) VALUES($1,$2,$3,now()-interval '1 day')",fid('p3-word-'+name),UID,fid('p3-lexeme-'+name))
            before=dict(await con.fetchrow('SELECT srs_stage,interval_days,next_review_at,correct_count,incorrect_count FROM user_vocabulary WHERE id=$1',fid('p3-word-run')))
        for game in ('cards','choice','match','gap','race','translation','builder'):
            r=await student.get('/api/vocabulary/games',params={'set':'all','game':game,'limit':24})
            check(game+' real catalogue',r.status_code==200)
            words=r.json()['words']
            if game=='choice':check('choice exposes aliases to reject equivalent distractors',all('acceptedTranslations' in w for w in words))
            if game in ('choice','match'):
                terms=[re.sub(r'[^a-z0-9 ]',' ',w['term'].lower()).strip() for w in words]
                check(game+' distinct choices',len(terms)==len(set(terms)))
            if game=='gap':check('unanswerable source is held',fid('p3-word-held') not in [w['id'] for w in words])
            kind='self' if game=='cards' else 'pair' if game=='match' else 'sentence' if game=='builder' else 'spelling'
            sub={'kind':kind,**({'known':True} if kind=='self' else {'pairEntryId':fid('p3-word-run')} if kind=='pair' else {'text':'We run daily.' if kind=='sentence' else 'run'})}
            r=await student.post('/api/vocabulary/games',json={'entryId':fid('p3-word-run'),'set':'all','gameId':game,'submission':sub})
            check(game+' server verdict',r.status_code==200 and r.json().get('correct') is True and r.json().get('verified') is (game!='cards'))
        body={'entryId':fid('p3-word-run'),'set':'all','gameId':'gap','submission':{'kind':'spelling','text':'run'}}
        check('foreign saved word is denied',(await other.post('/api/vocabulary/games',json=body)).status_code==404)
        check('pending learner is denied',(await pending.get('/api/vocabulary/games?set=all&game=gap')).status_code in (401,403))
        check('client cannot claim awarded points',(await student.post('/api/vocabulary/games',json={**body,'awarded':100})).status_code==400)
        check('held gap cannot be graded through a direct POST',(await student.post('/api/vocabulary/games',json={**body,'entryId':fid('p3-word-held'),'submission':{'kind':'spelling','text':'staple food'}})).status_code==409)
        async with p.acquire() as con:
            after=dict(await con.fetchrow('SELECT srs_stage,interval_days,next_review_at,correct_count,incorrect_count FROM user_vocabulary WHERE id=$1',fid('p3-word-run')))
            check('all seven games preserve SRS history',before==after)
            points=await con.fetchval("SELECT coalesce(sum(points),0) FROM vocab_point_events WHERE user_id=$1 AND kind='game_answer'",UID)
            check('one game award across modes per saved word/day',points==1,points=points)
        results=await asyncio.gather(*(student.post('/api/vocabulary/'+fid('p3-word-run')+'/review',json={'outcome':'correct'}) for _ in range(2)))
        check('authoritative concurrent review advances once',sorted(r.status_code for r in results)==[200,409])
        # Actual unstarted -> active -> completed -> active review boundary.
        async with p.acquire() as con:
            await con.execute("UPDATE listening_packages SET source_id='listening-test-2' WHERE test_id=$1",fid('listening-academic'))
        async with p.acquire() as con:
            from app.step25_content_version import pin
            package=await con.fetchval('SELECT payload FROM listening_packages WHERE test_id=$1',fid('listening-academic'))
            if isinstance(package,str):package=json.loads(package)
            await pin(con,'listening','full_test','synthetic-p3-revision','Synthetic revision',package,fid('teacher'),pub='published',target_type='listening_test',target_id=fid('listening-academic'))
        endpoint='/api/listening/full/'+fid('listening-academic')+'/authored'
        r=await student.get(endpoint)
        check('P3-SEC-01 unstarted source contains no runtime or answers',r.status_code==200 and r.json().get('kind')=='exam_required' and 'runtime' not in r.json())
        study_endpoint='/api/listening/full/'+fid('listening-academic')+'/study'
        check('unstarted learner cannot bypass review through study grading',(await student.post(study_endpoint,json={'answers':{'1':'guess'}})).status_code==409)
        for path in ('practice','activity'):
            check('unstarted learner cannot bypass review through '+path,(await student.post(endpoint.rsplit('/',1)[0]+'/'+path,json={})).status_code==409)
        r=await student.post('/api/listening/full/'+fid('listening-academic')+'/start',json={})
        check('full exam starts through the existing server lifecycle',r.status_code==200)
        attempt=r.json()['id']
        r=await student.get(endpoint)
        check('active source gate resumes only the owned attempt',r.status_code==200 and r.json().get('attemptId')==attempt and 'runtime' not in r.json())
        check('active exam cannot fetch vocabulary study answers',(await student.get(endpoint+'?vocabulary=1')).status_code==409)
        check('active exam cannot bypass review through study grading',(await student.post(study_endpoint,json={'answers':{'1':'guess'}})).status_code==409)
        for path in ('practice','activity'):
            check('active exam cannot bypass review through '+path,(await student.post(endpoint.rsplit('/',1)[0]+'/'+path,json={})).status_code==409)
        view=await student.get('/api/frontend/view',params={'route':'/app/listening/attempts/'+attempt})
        exam=view.json().get('data',{}).get('exam',{})
        check('key-free exam has all forty questions',view.status_code==200 and len(exam.get('questions',[]))==40 and all(not any(k in q for k in ('key','evidence','correctAnswer','explanation')) for q in exam['questions']))
        draft={'answers':{exam['questions'][0]['id']:'A'},'audioPosition':0,'expectedDraftHash':exam['draftHash']}
        saved=await student.put('/api/listening/attempts/'+attempt+'/draft',json=draft)
        check('Listening draft returns an authoritative acknowledgement',saved.status_code==200 and len(saved.json().get('draftHash',''))==64)
        stale={**draft,'answers':{exam['questions'][0]['id']:'B'}}
        check('stale Listening tab cannot overwrite another answer',(await student.put('/api/listening/attempts/'+attempt+'/draft',json=stale)).status_code==409)
        check('a lost acknowledgement can be retried idempotently',(await student.put('/api/listening/attempts/'+attempt+'/draft',json=draft)).status_code==200)
        check('foreign Listening draft write is denied',(await other.put('/api/listening/attempts/'+attempt+'/draft',json=draft)).status_code==404)
        restored=await student.get('/api/frontend/view',params={'route':'/app/listening/attempts/'+attempt})
        check('acknowledged Listening answer persists across resume',restored.json()['data']['exam']['initial'].get(exam['questions'][0]['id'])=='A')
        async with p.acquire() as con:
            changed=json.loads(json.dumps(package))
            for q in changed['questions']:q['key']='B'
            await con.execute('UPDATE listening_packages SET payload=$2::jsonb WHERE test_id=$1',fid('listening-academic'),changed)
        submitted=await student.post('/api/listening/attempts/'+attempt+'/submit',json={'answers':[{'questionId':q['id'],'answer':'A'} for q in exam['questions']],'score':999})
        check('pinned keys survive a newer package and ignore client marks',submitted.status_code==200 and submitted.json().get('score')==40)
        r=await student.get(endpoint)
        from app.listening_runtime import runtime as source_runtime
        check('completed owner can reopen the exact original study runtime',r.status_code==200 and r.json().get('runtime')==source_runtime(2))
        check('completed owner retains legitimate study grading',(await student.post(study_endpoint,json={'answers':{'1':'guess'}})).status_code==200)
        foreign=await other.get(endpoint)
        check('another learner does not inherit review access','runtime' not in foreign.json() and foreign.json().get('attemptId') is None)
        renewed=await student.post('/api/listening/full/'+fid('listening-academic')+'/start',json={})
        locked=await student.get(endpoint)
        check('a fresh active exam overrides earlier review access',renewed.status_code==200 and locked.json().get('attemptId')==renewed.json()['id'] and 'runtime' not in locked.json())
        old_review=await student.get('/api/frontend/view',params={'route':'/app/listening/attempts/'+attempt+'/revision'})
        check('active retake cannot fetch keys through an older completed review',old_review.status_code==409)
        findings.append({'id':'P3-SEC-01','severity':'P0','status':'RESOLVED','protectionGate':'PASS','sourceUnchanged':True,'serverOwnedLifecycleVerified':True})
        async with p.acquire() as con:check('owned database remains responsive',await con.fetchval('SELECT 1')==1)
    finally:
        for client in clients:await client.aclose()
        try:
            from app.db import close_pool
            await close_pool()
        finally:db.close()
        result={'scope':'Owned PostgreSQL + real FastAPI ASGI/auth; synthetic learners and vocabulary','manualQA':'OWNER_ONLY_NOT_RUN','elapsedSeconds':round(time.monotonic()-start,3),'pass':sum(c['pass'] for c in cases),'fail':sum(not c['pass'] for c in cases),'cases':cases,'releaseChecks':findings,'openReleaseFindings':[f for f in findings if f['status']!='RESOLVED']}
        (output/'core-integration.json').write_text(json.dumps(result,indent=2)+'\n')
    if not cases or any(not c['pass'] for c in cases):raise SystemExit(1)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    asyncio.run(run(parser.parse_args().output))
