"""Cross-page totals, authoring fallback and saved Writing lifecycle regressions.

Runs only against the disposable embedded PostgreSQL fixture in browser_http_probe.
"""
import asyncio
from urllib.parse import urlencode
from fastapi.testclient import TestClient
from app.asgi import application
from browser_fixtures import id


def run(con,client,check,uid,password):
    checks=0
    def sql(statement,*args):return asyncio.run(con.execute(statement,*args))
    def view(route):return check('/api/frontend/view?'+urlencode({'route':route}))['data']
    def call(method,path,body=None,status=200):
        nonlocal checks
        r=client.request(method,path,json=body,headers={'origin':'http://preview.test'})
        assert r.status_code==status,(method,path,r.status_code,r.text[:500])
        checks+=1
        return r.json()

    # More than one 60-card lesson page, with many newer rows in another area.
    sql('''INSERT INTO lessons(id,unit_id,slug,title,"order",learning_area,publication_state,default_state,updated_at)
      SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,'page-fixture-'||n,'Page lesson '||n,n,
        CASE WHEN n<=61 THEN 'listening' ELSE 'reading' END,'published','available',now()+n*interval '1 second'
      FROM generate_series(1,122) n''',id('unit'))
    sql("UPDATE lessons SET teacher_notes=NULL WHERE id=$1",id('listening-lesson'))
    sql("INSERT INTO lesson_blocks(lesson_id,position,type,object_key) VALUES($1,1,'image','lessons/fixture.png')",id('listening-lesson'))
    first=view('/app/listening/lessons')['library'];second=view('/app/listening/lessons?page=2')['library']
    assert len(first['rows'])==60 and first['hasMore'] and len(second['rows'])==2 and not second['hasMore']
    assert first['rows'][0]['title']=='Page lesson 61'
    assert not {r['id'] for r in first['rows']}&{r['id'] for r in second['rows']}
    fallback=next(r for r in second['rows'] if r['id']==id('listening-lesson'))
    assert fallback['hasMedia'] and fallback['hasTeacherNotes'];checks+=4

    # Global MCQ totals survive a page without the completed first day.
    sql('''INSERT INTO listening_tests(id,created_by_user_id,title,audio_type,audio_url,publication_state,program_ref,program_ordinal)
      SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,'Page day '||n,'audio','/api/resources/listening/fixture.mp3',
        'published','listening-mcq-program',n FROM generate_series(2,26) n''',id('teacher'))
    program=view('/app/listening/mcq?page=2')
    assert program['page']==2 and [d['day'] for d in program['days']]==[25,26]
    assert program['progress']=={'daysPublished':26,'daysCompleted':1,'questionsPublished':5,'questionsCompleted':5};checks+=2

    # A persisted Check must not release a stale result after an authored key edit.
    sql("UPDATE reading_questions SET correct_answer='edited-key' WHERE id=$1",id('reading-1-1'))
    assert view('/app/reading/general/'+id('reading-set'))['initialProgress'][id('passage1')]['result'] is None
    sql("UPDATE reading_questions SET correct_answer='fixture' WHERE id=$1",id('reading-1-1'));checks+=1
    # Exercise the existing reviewed 41->40 omission instead of excluding the set.
    sql("UPDATE general_reading_sets SET source_ref='reading105:test:08' WHERE id=$1",id('reading-set'))
    sql("UPDATE reading_passages SET external_id='t08-p2-european-heat-wave' WHERE id=$1",id('passage2'))
    sql('''INSERT INTO reading_questions(id,passage_id,"order",question_no,type,question_text,correct_answer,explanation)
      VALUES($1,$2,14,14,'short_answer','Reviewed duplicate question','fixture','Reviewed source omission')''',id('reviewed-omission'),id('passage2'))
    assert any(s['id']==id('reading-set') for s in view('/app/reading/academic')['sets'])
    assert view('/app/reading/academic/'+id('reading-set'))['set']['id']==id('reading-set');checks+=2

    # 321 patterns force a real next cursor; filtering and saved bank are SQL-side.
    sql('''INSERT INTO writing_model_texts(id,title,task_type,topic,target_band,body,word_count,provenance,publication_state)
      VALUES($1,'Authored model','task2','education',8,repeat('Authored example sentence. ',12),36,'isolated test','published')''',id('model'))
    sql('''INSERT INTO writing_language_patterns(id,pattern,function,task_type,topic,target_band,example,provenance,publication_state,source_ref)
      SELECT ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Pattern '||lpad(n::text,3,'0'),'argument','task2','education',8,
        'An authored example.','isolated test','published',CASE WHEN n=1 THEN $1 ELSE NULL END
      FROM generate_series(1,321) n''',id('model'))
    sql("INSERT INTO writing_pattern_bank(user_id,pattern_id) VALUES($1,'30000000-0000-4000-8000-000000000321')",uid)
    patterns=view('/app/writing?tab=language-stealing&task=task2&fn=argument')['library']
    assert len(patterns['patterns'])==300 and patterns['hasMore'] and patterns['matching']==321
    cursor=patterns['nextCursor']
    remainder=view('/app/writing?'+urlencode({'tab':'language-stealing','task':'task2','fn':'argument','cursor':cursor}))['library']
    assert len(remainder['patterns'])==21 and not remainder['hasMore']
    assert not {p['id'] for p in patterns['patterns']}&{p['id'] for p in remainder['patterns']}
    bank=view('/app/writing?tab=language-stealing&bank=1')['library']
    assert len(bank['patterns'])==1 and bank['patterns'][0]['saved']
    check('/api/frontend/view?'+urlencode({'route':'/app/writing?'+urlencode({'tab':'language-stealing','fn':'trend','cursor':cursor})}),400)
    checks+=4

    # Native exam read matches the existing revision-safe write lifecycle.
    exam=call('POST','/api/writing/exam',{'mode':'task2'})['id']
    assert view('/app/writing/exam/'+exam)['paper']['entries'][0]['content']==''
    call('PUT','/api/writing/exam/'+exam+'/draft',{'position':1,'revision':2,'content':'A saved examination draft.'})
    assert call('PUT','/api/writing/exam/'+exam+'/draft',{'position':1,'revision':1,'content':'Stale overwrite'})['stale']
    assert view('/app/writing/exam/'+exam)['paper']['entries'][0]['content']=='A saved examination draft.'
    call('POST','/api/writing/exam/'+exam+'/finalize',{'reason':'submitted'})
    assert view('/app/writing/exam/'+exam)['paper']['finalizeReason']=='submitted';checks+=4

    # Exact translation is deterministic; unfinished answers remain private.
    sql('''INSERT INTO writing_translation_sets(id,title,topic,question_type,target_band,prompt_text,provenance,publication_state)
      VALUES($1,'Authored translation','education','opinion',8,'An authored question.','isolated test','published')''',id('translation'))
    sql('''INSERT INTO writing_translation_sentences(id,set_id,position,uzbek_source,model_english)
      VALUES($1,$2,1,'Men kitob o‘qiyman.','I read books.')''',id('sentence'),id('translation'))
    translation=call('POST','/api/writing/translation',{'setId':id('translation')})['id']
    before=view('/app/writing/translation/'+translation)['view']
    assert 'model' not in before['current'] and before['finished']==[]
    call('POST','/api/writing/translation/'+translation+'/answer',{'position':1,'answer':'I read books.'})
    after=view('/app/writing/translation/'+translation)['view']
    assert after['status']=='completed' and after['finished'][0]['model']=='I read books.';checks+=2

    # An unavailable external grader saves the essay without inventing a band.
    grade=call('POST','/api/writing/grade',{'taskType':'task2','question':'Discuss the purpose of education.',
      'essay':' '.join(['education']*60),'idempotencyKey':'browser_grade_fixture'})
    assert not grade['ok'] and grade['status']=='failed'
    own_grade=view('/app/writing/grade/'+grade['id'])['view']
    assert own_grade['evaluation'] is None and own_grade['request']['essayText'].startswith('education')
    assert call('POST','/api/writing/grade',{'taskType':'task2','question':'A duplicate request question.',
      'essay':' '.join(['duplicate']*60),'idempotencyKey':'browser_grade_fixture'})['id']==grade['id'];checks+=3

    # Server progression, masked source, and selected pattern recall remain authoritative.
    session=call('POST','/api/writing/stealing/sessions',{'modelTextId':id('model')})['id']
    route='/app/writing/language-stealing/'+session
    assert view(route)['view']['modelBody']
    call('POST','/api/writing/stealing/sessions/'+session,{'action':'draft','text':'Cannot skip'},409)
    call('POST','/api/writing/stealing/sessions/'+session,{'action':'read'})
    assert view(route)['view']['modelBody'] is None
    call('POST','/api/writing/stealing/sessions/'+session,{'action':'brainstorm','text':' '.join(['idea']*10)})
    call('POST','/api/writing/stealing/sessions/'+session,{'action':'draft','text':' '.join(['draft']*45)})
    analysed=view(route)['view'];assert analysed['step']==4 and analysed['modelBody']
    pid=analysed['patterns'][0]['id']
    call('POST','/api/writing/stealing/sessions/'+session,{'action':'analyse','patternIds':[pid]})
    call('POST','/api/writing/stealing/sessions/'+session,{'action':'compare','text':' '.join(['comparison']*14)})
    recall=view(route)['view'];assert recall['patterns'][0]['pattern']==''
    call('POST','/api/writing/stealing/sessions/'+session,{'action':'recall','patternId':pid,'attempt':'Pattern 001'})
    assert not view(route)['view']['rewriteUnlocked'];checks+=5

    foreign=TestClient(application,base_url='http://preview.test')
    assert foreign.post('/api/auth/login',json={'email':'other-student@browser.example.test','password':password},headers={'origin':'http://preview.test'}).status_code==200
    for route in ('/app/writing/exam/'+exam,'/app/writing/translation/'+translation,'/app/writing/grade/'+grade['id'],'/app/writing/language-stealing/'+session):
        r=foreign.get('/api/frontend/view?'+urlencode({'route':route}))
        assert r.status_code==404,(route,r.status_code,r.text);checks+=1
    return checks
