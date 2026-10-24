"""Actual write -> native read -> resume/submit workflows on the isolated DB."""
from urllib.parse import urlencode
from fastapi.testclient import TestClient
from app.asgi import application
from browser_fixtures import id


def run(client, check, uid, password):
    checks = 0
    def call(method,path,body=None,status=200):
        nonlocal checks
        r=client.request(method,path,json=body,headers={'origin':'http://preview.test'})
        assert r.status_code==status,(method,path,r.status_code,r.text[:400])
        checks+=1
        return r.json()
    def view(route): return check('/api/frontend/view?'+urlencode({'route':route}))['data']
    grammar=view('/app/grammar/'+id('topic'))
    assert len(grammar['exercises'])==1
    assert not any(key in grammar['exercises'][0] for key in ('correctOption','explanation','answerKey'))
    lesson_route='/app/listening/lessons/'+id('listening-lesson')
    quiz=view(lesson_route)['detail']['blocks'][0]['quiz']
    assert 'answerKey' not in quiz and 'explanation' not in quiz
    call('POST','/api/lessons/blocks/'+id('listening-quiz')+'/answer',{'answer':'First'})
    detail=view(lesson_route)['detail']
    assert detail['blocks'][0]['response']['correct'] is True
    assert 'answerKey' not in detail['blocks'][0]['quiz']
    call('POST','/api/lessons/'+id('listening-lesson')+'/notes',{'body':'Saved through the existing Python API.'})
    assert view(lesson_route)['detail']['note']=='Saved through the existing Python API.'
    denied=client.post('/api/lessons/'+id('listening-lesson')+'/notes',json={'body':'Cross-origin overwrite'},headers={'origin':'https://evil.example.test'})
    assert denied.status_code==403,denied.text
    assert view(lesson_route)['detail']['note']=='Saved through the existing Python API.'
    checks+=2
    reading=call('POST','/api/reading/academic',{'setId':id('reading-set')})
    aid=reading['id']; route='/app/reading/attempts/'+aid
    detail=view(route)['detail']
    assert len(detail['questions'])==40 and len(detail['sections'])==3
    assert not any('correctAnswer' in q for q in detail['questions'])
    answers=[{'questionId':q['id'],'answer':'fixture'} for q in detail['questions']]
    call('PATCH','/api/reading/attempts/'+aid,{'answers':answers})
    assert len(view(route)['detail']['answers'])==40
    result=call('POST','/api/reading/attempts/'+aid+'/submit',{'answers':answers})
    assert result['score']==40
    finished=view(route)['detail']
    assert finished['attempt']['status']=='completed' and all('correctAnswer' in q for q in finished['questions'])
    # Existing General Check releases only this learner's persisted checked result.
    general_route='/app/reading/general/'+id('reading-set')
    assert view(general_route)['initialProgress']=={}
    call('POST','/api/reading/general/progress',{'passageId':id('passage1'),'answers':{id('reading-1-1'):'fixture'},'check':True})
    saved=view(general_route)['initialProgress'][id('passage1')]
    assert saved['checked'] is True and saved['result'][0]['correctAnswer']=='fixture'
    listening=call('POST','/api/listening/attempts',{'testId':id('listening-academic')})
    aid=listening['id']; route='/app/listening/attempts/'+aid
    exam=view(route)['exam']
    assert len(exam['questions'])==40 and all('key' not in q and 'evidence' not in q for q in exam['questions'])
    assert view('/app/listening/tests/'+id('listening-academic')+'/2')['kind']=='exam-locked'
    answers=[{'questionId':q['id'],'answer':'A'} for q in exam['questions']]
    result=call('POST','/api/listening/attempts/'+aid+'/submit',{'answers':answers})
    assert result['score']==40
    assert view('/app/listening/tests/'+id('listening-academic')+'/2')['activity']['data']['report']['score']==40
    for i in range(1,6):
        question=id('listening-mcq-'+str(i))
        session=call('POST','/api/listening/mcq',{'questionId':question})
        sid=session['session']['id']
        assert session['options'] is None and session['correctAnswer'] is None
        call('PATCH','/api/listening/mcq/'+sid,{'step':'reasoned','text':'Cannot skip the sequence'},409)
        for step,text in (('notes','Authored notes'),('committed','A'),('revealed',None),('chosen','A'),('reasoned','Because the recording supports option A.')):
            session=call('PATCH','/api/listening/mcq/'+sid,{'step':step,**({'text':text} if text else {})})
        assert session['session']['stage']=='reasoned'
    program=view('/app/listening/mcq')
    assert program['days'][0]['status']['state']=='completed'
    assert program['progress']['questionsCompleted']==5
    foreign=TestClient(application,base_url='http://preview.test')
    assert foreign.post('/api/auth/login',json={'email':'other-student@browser.example.test','password':password},headers={'origin':'http://preview.test'}).status_code==200
    for path in ('/api/frontend/view?route='+route,'/api/listening/mcq/'+sid):
        r=foreign.get(path);assert r.status_code==404,(path,r.text);checks+=1
    other_note=foreign.get('/api/frontend/view?'+urlencode({'route':lesson_route})).json()['data']['detail']['note']
    assert other_note=='';checks+=1
    teacher=TestClient(application,base_url='http://preview.test')
    assert teacher.post('/api/auth/login',json={'email':'teacher@browser.example.test','password':password},headers={'origin':'http://preview.test'}).status_code==200
    listed=teacher.get('/api/frontend/staff/teacher-students').json()['data']['students']
    assert [s['id'] for s in listed]==[uid];checks+=1
    assert teacher.get('/api/frontend/staff/teacher-student?id='+uid).status_code==200;checks+=1
    assert teacher.get('/api/frontend/staff/teacher-student?id='+id('other-student')).status_code==404;checks+=1
    assert teacher.get('/api/frontend/staff/student-learning?id='+id('other-student')).status_code==404;checks+=1
    assert teacher.get('/api/frontend/staff/owner-overview').status_code==403;checks+=1
    assert teacher.get('/api/frontend/staff/teacher-live-class?id='+id('live')).status_code==200;checks+=1
    return checks
