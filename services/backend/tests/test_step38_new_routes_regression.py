"""Additional deterministic/HTTP regression coverage for 250 -> 260 methods.
External services and database boundaries are excluded; no mock successes are shipped.
"""
from __future__ import annotations
import io,json,zipfile
from datetime import datetime, timezone
from uuid import UUID
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.step32_grammar_practice import check_structures,structure_verdict
from app.step32_writing_riwi import wval
from app.step34_reading_import import validate_bundle,InvalidBundle
from app.step35_retention_scoring import evaluate_recall,StructureError
from app.step36_student_export import render_archive
from app.step37_reports import period_window,input_ok
from app.step37_report_exports import render,sha

C=TestClient(core.app)
UID=UUID('11111111-1111-4111-8111-111111111111')

def test_grammar_practice_structure_check_does_not_require_ai():
 check=check_structures('I have studied German for years.', ['have studied'])
 assert check['complete'] and check['used']==['have studied']
 assert structure_verdict(check,True)=='correct'
 check=check_structures('I am learning English.', ['have studied'])
 assert not check['complete'] and structure_verdict(check,True)=='incorrect'
 assert structure_verdict(check,False)=='undetermined'

def test_grammar_practice_missing_activity_is_invalid_without_sql(monkeypatch):
 async def user(*a,**k):return {'id':UID,'role':'student','account_status':'active'}
 async def nope():raise AssertionError('input validation must not reach SQL')
 monkeypatch.setattr(core,'current_user',user);monkeypatch.setattr(core,'pool',nope)
 r=C.post('/api/grammar/exercises/'+str(UID)+'/practice',json={'activity':'activate_it','answer':'a'})
 assert r.status_code==400 and r.json()=={'error':'invalid_input'}

def test_riwi_writing_undersized_attempt_lowers_task_band():
 short=wval('task2','Discuss education.', 'Some thoughts.',250)
 good=wval('task2','Discuss education.', ('I think education is important.\n\n'+'Students can learn skills from experience. '*35+'\n\n'+'However, schools need support. '*15+'\n\n'+'Therefore, we should invest.'),250)
 assert short['criteria'][0]['band'] <= good['criteria'][0]['band']
 assert short['overallEstimate']>=4 and short['overallEstimate']<=9
 assert any(i['category']=='WRITING_LENGTH' for i in short['issues'])

def test_reading_bundle_validation_rejects_unknown_question_type():
 base={'sourceRef':'reading-1','title':'Reading Sample','passages':[{'passageNo':1,'title':'Passage','body':'Some content','questions':[{'questionNo':1,'type':'short_answer','text':'Question?','answer':'Answer'}]}]}
 assert validate_bundle(base)==base
 base['passages'][0]['questions'][0]['type']='invented_choice_type'
 with pytest.raises(InvalidBundle):validate_bundle(base)

def test_retention_deterministic_score_cannot_credit_negated_claim():
 structure={'schemaVersion':1,'maxScore':100,'claims':[{'id':'idea-1','label':'The claim about the budget','points':100,'scope':'sentence',
     'groups':[{'id':'g1','points':100,'kind':'concept','anyOf':['budget increased'],'critical':True}]}]}
 score,info=evaluate_recall('The budget increased.',structure)
 assert score==100 and info['evaluatorVersion']=='retention-deterministic-v5'
 score,info=evaluate_recall('The budget did not increase.',structure)
 assert score<100
 with pytest.raises(StructureError):evaluate_recall('Budget increased.',{**structure,'maxScore':90})

def test_report_period_window_rejects_bad_ranges():
 now=datetime(2026,10,23,12,tzinfo=timezone.utc)
 assert period_window('custom',now,'2026-10-01','2026-09-30')=='range_reversed'
 assert period_window('custom',now,'2026-11-01','2026-11-03')=='range_in_future'
 assert period_window('custom',now,'bad','bad')=='invalid_date'
 w=period_window('weekly',now)
 assert w['timezone']=='Asia/Tashkent' and w['from'].endswith('Z') and w['to'].endswith('Z')

def test_report_scope_and_format_whitelist():
 assert input_ok({'scope':'owner','period':'monthly','format':'zip','lang':'uz'})
 assert not input_ok({'scope':'teacher','period':'today','format':'json'})
 assert not input_ok({'scope':'owner','period':'monthly','format':'xml'})

def snapshot():
 return {'schemaVersion':'riwi-report/1','reportId':'11111111-1111-4111-8111-111111111111',
  'generatedAt':'2026-10-23T12:00:00.000Z','timezone':'Asia/Tashkent',
  'scope':{'kind':'owner'},'period':{'kind':'monthly','fromDate':'2026-09-01','toDate':'2026-09-30','from':'2026-08-31T19:00:00.000Z','to':'2026-09-30T19:00:00.000Z'},
  'metrics':[],'narrative':{'en':['No activity in this period.'],'uz':['Bu davrda faollik yo‘q.']}}

@pytest.mark.parametrize('fmt',('json','csv','xlsx','docx','pdf','zip'))
def test_all_six_report_export_formats_are_real_binary(fmt):
 content=render(snapshot(),fmt,'en')
 assert isinstance(content,bytes) and len(content)>100
 assert len(sha(content))==64
 if fmt in ('zip','xlsx','docx'):
  with zipfile.ZipFile(io.BytesIO(content)) as archive:
   assert archive.testzip() is None
   assert len(archive.namelist())>=3
   if fmt=='zip':
    assert sorted(archive.namelist())==['manifest.json','report.csv','report.docx','report.json','report.pdf','report.xlsx']
    manifest=json.loads(archive.read('manifest.json'))
    assert manifest['reportId']==snapshot()['reportId'] and len(manifest['files'])==5
 if fmt=='pdf':assert content.startswith(b'%PDF-')
 if fmt=='json':assert json.loads(content)['reportId']==snapshot()['reportId']
 if fmt=='csv':assert content.startswith(b'\xef\xbb\xbf')

@pytest.mark.parametrize('fmt',('pdf','docx','zip'))
def test_student_archive_actual_binary_output(fmt):
 archive={'version':1,'id':str(UID),'generatedAt':'2026-10-23T12:00:00.000Z','students':[],'results':{}}
 content=render_archive(archive,fmt)
 assert isinstance(content,bytes) and len(content)>100
 if fmt=='pdf':assert content.startswith(b'%PDF-')
 else:
  with zipfile.ZipFile(io.BytesIO(content)) as z:
   assert z.testzip() is None

def test_owner_export_invalid_format_rejected_without_db(monkeypatch):
 async def owner(*a,**kw):return {'id':UID,'role':'owner','account_status':'active'}
 async def no_database():raise AssertionError('invalid export format must not reach DB')
 monkeypatch.setattr(core,'current_user',owner);monkeypatch.setattr(core,'pool',no_database)
 r=C.get('/api/owner/student-export?format=html')
 assert r.status_code==400 and r.json()=={'error':'invalid_format'}

@pytest.mark.parametrize('path,expected',[
 ('/api/speaking/attempts/bad/submit',404),
 ('/api/assignments/bad/evaluate',404),
 ('/api/retention/attempts/bad/submit',401),
])
def test_invalid_uuid_not_routed_to_other_handler(path,expected,monkeypatch):
 async def no_db():raise AssertionError('invalid identifier reached DB')
 monkeypatch.setattr(core,'pool',no_db)
 r=C.post(path,json={})
 assert r.status_code==expected,r.text
