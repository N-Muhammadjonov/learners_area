"""210-method checkpoint tests. These isolate HTTP contract and no-auth access.

No database, object-storage, Dictionary Worker or TypeScript differential test
is performed here; these must still be checked in a configured environment.
"""
from __future__ import annotations
import json
from pathlib import Path
from uuid import UUID
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.step21_reading_port import norm, matches, correct, assessment_question_selection
from app.step21_vocabulary_create import cleaned
from app.step21_dictionary_entry_save import present

ID='11111111-1111-4111-8111-111111111111'
C=TestClient(core.app)
NEW=[
 ('GET','/api/assignments'),
 ('POST','/api/assignments'),
 ('GET',f'/api/dictionary/entries/{ID}'),
 ('POST','/api/dictionary/save'),
 ('GET','/api/history'),
 ('GET',f'/api/lessons/{ID}'),
 ('POST',f'/api/lessons/blocks/{ID}/answer'),
 ('GET',f'/api/listening/full/{ID}/authored'),
 ('GET',f'/api/listening/full/{ID}/authored-state'),
 ('GET',f'/api/materials/reading/{ID}'),
 ('POST','/api/reading/academic'),
 ('POST',f'/api/reading/attempts/{ID}/submit'),
 ('POST','/api/reading/general/progress'),
 ('GET',f'/api/retention/attempts/{ID}'),
 ('GET','/api/retention/attempts'),
 ('POST','/api/speaking/prompts/vocabulary'),
 ('POST',f'/api/video-lessons/{ID}/vocabulary'),
 ('GET','/api/vocabulary/meaning'),
 ('POST','/api/vocabulary/packs'),
 ('POST','/api/vocabulary'),
]

def test_route_manifest_strictly_matches_fastapi():
    report=json.loads(Path('PORT_STATUS.json').read_text())
    entries=report['endpoints']
    ported={(e['method'],e['path']) for e in entries if e['status'].startswith('ported_')}
    routes=[(method,route.path) for route in core.app.routes for method in route.methods if route.path.startswith('/api/')]
    assert len(ported)==len(routes)==len(set(routes)) and len(ported)>=210
    assert ported==set(routes)
    assert len(entries)==report['total_methods']==272 and report['unported_methods']==len(entries)-len(ported)
    assert len(NEW)==len(set(NEW))==20
    for method,path in NEW:
        template=path.replace(ID,'{id}')
        if 'materials/' in template: template=template.replace('reading/{id}','{type}/{id}')
        if 'lessons/blocks' in template: template=template.replace('{id}','{blockId}')
        elif 'dictionary/entries' in template:template=template.replace('{id}','{lexemeId}')
        assert (method,template) in ported

@pytest.mark.parametrize('method,path',NEW)
def test_all_new_methods_deny_anonymous_requests(monkeypatch,method,path):
    async def no_user(*args,**kwargs):return None
    async def no_pool(): raise AssertionError('anonymous request must not access database')
    monkeypatch.setattr(core,'current_user',no_user)
    monkeypatch.setattr(core,'pool',no_pool)
    r=C.request(method,path,json={} if method=='POST' else None)
    assert r.status_code==401,(method,path,r.status_code,r.text)

@pytest.fixture
def student(monkeypatch):
    async def user(*args,**kwargs):return {'id':UUID(ID),'role':'student','account_status':'active'}
    async def no_pool():raise AssertionError('invalid input must be blocked before database access')
    monkeypatch.setattr(core,'current_user',user)
    monkeypatch.setattr(core,'pool',no_pool)

@pytest.mark.parametrize('method,path,data,expected',[
    ('POST','/api/vocabulary',{'items':[]},400),
    ('POST','/api/vocabulary',{'items':[{'term':' '} ]},400),
    ('POST','/api/vocabulary',{'items':[{'term':'valid','acceptedTranslations':['a']*5}]},400),
    ('POST','/api/vocabulary/packs',{'packId':23},400),
    ('POST','/api/dictionary/save',{'lexemeId':ID,'senseId':ID,'releaseId':'bad'},400),
    ('POST','/api/reading/general/progress',{'passageId':ID,'answers':{ID:5}},400),
    ('POST',f'/api/reading/attempts/{ID}/submit',{'answers':[{'questionId':ID,'answer':51}]},400),
    ('POST',f'/api/lessons/blocks/{ID}/answer',{'answer':' '*501},400),
])
def test_new_input_validation_without_side_effects(student,method,path,data,expected):
    r=C.request(method,path,json=data)
    assert r.status_code==expected,(method,path,r.status_code,r.text)

def test_vocabulary_cleaning_requires_sense_and_caps_lengths():
    assert cleaned({'items':[{'term':'  trim  ','partOfSpeech':' noun '}]})==[{'term':'trim','partOfSpeech':'noun'}]
    assert cleaned({'items':[]}) is None
    assert cleaned({'items':[{'term':'a'}]*101}) is None
    assert cleaned({'items':[{'term':'a','acceptedTranslations':['x'*121]}]}) is None

def test_reading_answer_normalization_and_nonempty_answers():
    assert norm('  The   Book. ')=='the book'
    assert matches('A - Paris','a')
    assert not matches('','anything')
    question={'correct_answer':'B','accepted_answers':['b - bird'],'answer_constraint':{},'type_code':'multiple_choice','type':None}
    assert correct(question,'B') is True
    assert correct(question,'A') is False
    question.update(type_code='mcq_multi',correct_answer='A, C',accepted_answers=[],answer_constraint={'selection_count':2})
    assert correct(question,'C, A') is True
    assert correct(question,'A, A') is False

def test_reading_question_selection_40_or_specific_41_only():
    rows=[{'id':i,'external_id':'unused','question_no':i} for i in range(40)]
    assert assessment_question_selection('reading105:test:08',rows)==rows
    assert assessment_question_selection('other',rows+[{'id':40,'external_id':'unused','question_no':40}]) is None

def test_dictionary_presentation_never_assigns_unrelated_example():
    entry={'lexeme_id':'00000000-0000-4000-8000-000000000001','display_lemma':'run','part_of_speech':'verb','lexical_type':'word','forms':[],
           'senses':[{'sense_id':'s1','definition_en':'To move quickly','translations':[],'examples':[{'text_en':'I run every morning.'},{'text_en':'A random sentence.'}]}],
           'relations':[],'collocations':[]}
    p=present(entry)
    assert p['senses']['s1']['examples']==[{'text_en':'I run every morning.'}]


def test_academic_105_reviewed_omission_exact_match():
    # Regression: sourceRef test 12 has no leading space in the original TypeScript.
    rows=[{'id':i,'external_id':f'other-{i}','question_no':i} for i in range(40)]
    rows.append({'id':40,'external_id':'t12-p1-how-printed-books-began','question_no':14})
    result=assessment_question_selection('reading105:test:12',rows)
    assert result is not None and len(result)==40
    assert all(q['id']!=40 for q in result)
    assert assessment_question_selection('reading105:test:11',rows) is None
