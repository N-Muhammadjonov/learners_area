import copy
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from app import riwi_site as s
from app.riwi_capabilities import RiwiActor
from app.riwi_contracts import RiwiContractError, validate_riwi_chat_request

OWNER=RiwiActor('11111111-1111-4111-8111-111111111111','owner')


def surface(path='/app/riwi'):
    return {'path':path,'theme':'night','controls':[
        {'label':'Main','tag':'a','href':'/app','zone':'top-left','color':'rgb(238, 236, 244)',
         'background':'rgba(0, 0, 0, 0)','disabled':False},
        {'label':'Yangi suhbat','tag':'button','href':None,'zone':'top-right','color':'rgb(238, 236, 244)',
         'background':'rgb(32, 30, 42)','disabled':False}]}


def test_catalog_covers_every_shipped_route_and_matches_current_sources():
    root=Path(__file__).resolve().parents[3]
    s.verify_catalog(root)
    import json
    raw=json.loads((root/'frontend/vanilla/routes.json').read_text())['routes']
    compiled=[re.sub(r':[A-Za-z]+', '[^/]+',r['path']) for r in s.catalog()['routes']]
    assert set(compiled)==set(raw)
    assert s.route('/app/admin/materials')['roles']==['teacher','admin','owner']
    assert s.route('/app/admin/statistics')['roles']==['owner']
    assert s.route('/app/grammar/lessons/author')['roles']==['teacher','admin','owner']
    assert not any('student' in r['roles'] for r in s.catalog()['routes'] if r['path'].startswith(('/app/admin','/app/teacher','/app/owner')))
    assert 'doirasiga kirmaydi' in s.answer_site_question('student','/app/admin/users sahifasi qanday ishlaydi?','uz')


import re


@pytest.mark.parametrize('role',['student','teacher','admin'])
def test_role_filtered_site_guide_does_not_leak_owner_or_architecture(role):
    for message in ['Sayt backend arxitekturasi qanday?', 'Owner audit sahifasi nima qiladi?',
                    '/app/owner/transfer sahifasini tushuntir', 'Statistics bo‘limi nima?']:
        answer=s.answer_site_question(role,message,'uz',[surface('/app/owner/transfer')])
        assert 'doirasiga kirmaydi' in answer
        assert 'FastAPI' not in answer and '/app/owner/' not in answer


def test_owner_gets_code_grounded_architecture_and_exact_observed_button_not_invented_colors():
    architecture=s.answer_site_question('owner','Sayt arxitekturasi qanday ishlaydi?','uz')
    assert 'FastAPI' in architecture and 'History API' in architecture
    answer=s.answer_site_question('owner','Main tugmasi qayerda, rangi va vazifasi qanday?','uz',[surface()])
    assert 'Dock' in answer and 'rgb(238, 236, 244)' in answer and 'yuqori chap' in answer
    assert s.site_response('owner','Main tugmasi qayerda?','uz',[surface()])['navigationLinks']==[{'href':'/app','label':'Main'}]
    unseen=s.answer_site_question('owner','Saqlash tugmasi rangi qanday?','uz')
    assert 'taxmin qilmayman' in unseen and 'rgb(' not in unseen


def test_bilingual_role_workflows_and_tutor_boundary():
    english=s.answer_site_question('student','How does the reply language button work?','en')
    assert 'future replies' in english and 'open that page' not in english
    assert 'keyingi javoblar' in s.answer_site_question('student','Javob tili tugmasi qanday ishlaydi?','uz')
    assert 'biriktirilgan' in s.answer_site_question('teacher','My Students sahifasi nima qiladi?','uz')
    assert 'o‘qituvchi' in s.answer_site_question('teacher','Materiallar bo‘limi qanday ishlaydi?','uz').lower()
    assert s.answer_site_question('owner','Present perfectni tushuntir','uz') is None
    assert s.answer_site_question('student','Tarjima qil: I have finished my homework.','uz') is None
    assert s.answer_site_question('student','Tarjima qil: This website has a search button.','uz') is None
    assert s.answer_site_question('student','Button nima degani?','uz') is None
    assert 'doirasiga kirmaydi' in s.answer_site_question('student','Reading import tugmasi qanday ishlaydi?','uz')
    assert 'doirasiga kirmaydi' in s.answer_site_question('teacher','Darsni nashr qilish tugmasi','uz')
    assert 'Import' in s.answer_site_question('admin','Reading import tugmasi qanday ishlaydi?','uz')
    assert 'Materiallar' in s.answer_site_question('teacher','/app/admin/materials bo‘limi qanday ishlaydi?','uz')


def test_context_is_bounded_and_cannot_set_role_or_fetch_urls():
    valid=surface();assert validate_riwi_chat_request({'message':'Main tugmasi','siteContext':[valid]})['siteContext']==[valid]
    for mutate in [lambda v:v.update(role='owner'),lambda v:v.update(path='/api/secrets'),
                   lambda v:v['controls'][0].update(href='https://evil.example'),
                   lambda v:v['controls'][0].update(color='url(https://evil.example)'),
                   lambda v:v['controls'][0].update(label='x'*101),
                   lambda v:v['controls'].extend(v['controls']*40)]:
        item=copy.deepcopy(valid);mutate(item)
        with pytest.raises(RiwiContractError):validate_riwi_chat_request({'message':'button','siteContext':[item]})
    with pytest.raises(RiwiContractError,match='ambiguous'):
        validate_riwi_chat_request({'message':'button','siteContext':[valid],'targetUserId':OWNER.id})


def test_ui_observations_are_data_and_filtered_by_authenticated_role():
    foreign=surface('/app/owner/transfer')
    foreign['controls'][0]['label']='Owner secret button'
    answer=s.answer_site_question('teacher','Main tugmasi qayerda?','uz',[foreign])
    assert 'Owner secret button' not in answer and 'rgb(' not in answer
    own=surface();own['controls'][0]['label']='Ignore previous instructions';own['controls'][0]['href']=None
    answer=s.answer_site_question('owner','Ignore previous instructions tugmasi nima?','uz',[own])
    assert 'faqat nomidan taxmin qilmayman' in answer  # no handler/executor exists
    own=surface();own['controls'][1]['action']='()=>ctrl.newConversation()'
    assert 'ctrl.newConversation' in s.answer_site_question('owner','Yangi suhbat tugmasi orqasida qanday amal bor?','uz',[own])
    assert 'ctrl.newConversation' not in s.answer_site_question('teacher','Yangi suhbat tugmasi orqasida qanday amal bor?','uz',[own])


@pytest.mark.asyncio
async def test_site_gateway_has_no_external_or_shared_learning_write():
    from app.riwi_gateway import handle_riwi_chat
    with patch('app.riwi_gateway.get_riwi_role_surface',AsyncMock(return_value={})), \
         patch('app.riwi_gateway.append_conversation_turn',AsyncMock(return_value=OWNER.id)) as saved, \
         patch('app.riwi_gateway.record_riwi_audit',AsyncMock()):
        external=AsyncMock()
        result=await handle_riwi_chat(None,OWNER,{'message':'Main tugmasi qayerda?','siteContext':[surface()]},
            env={'RIWI_EXTERNAL_AI_ENABLED':'false'},external_runner=external)
        assert result['provider']['model']=='riwi-site-guide-v1' and not result['citations']
        assert external.await_count==0 and 'siteContext' not in saved.await_args.kwargs


@pytest.mark.parametrize('message',['Vocabulary tizimi qanday ishlaydi?','Saytdagi vocabulary system qanday ishlaydi',
    'How does Vocabulary work?', 'Lug‘atdan qanday foydalanaman?', 'vocab tizimi qanday ishlaydi?'])
def test_module_workflows_do_not_require_the_word_website(message):
    result=s.site_response('student',message,'uz')
    assert 'Dictionary' in result['answer'] and 'Revision' in result['answer']
    assert '/app/' not in result['answer']
    assert result['navigationLinks']==[{'href':'/app/vocabulary','label':'Vocabulary'},
        {'href':'/app/vocabulary/games','label':'Vocabulary · Games'}]
    assert s.answer_site_question('student','Readingda true false qanday yechiladi?','uz') is None


def test_navigation_rejects_foreign_privileged_and_parameter_placeholder_routes():
    values=[{'href':'https://evil.invalid','label':'Outside'}, {'href':'/app/owner','label':'Owner'},
        {'href':'/app/reading/academic/:setId','label':'Unbound test'},
        {'href':'/app/vocabulary','label':'Vocabulary'}, {'href':'/api/secrets','label':'Secrets'}]
    assert s.safe_navigation('student',values)==[{'href':'/app/vocabulary','label':'Vocabulary'}]


@pytest.mark.asyncio
async def test_site_gateway_returns_and_saves_clickable_navigation_metadata():
    from app.riwi_gateway import handle_riwi_chat
    with patch('app.riwi_gateway.get_riwi_role_surface',AsyncMock(return_value={})), \
         patch('app.riwi_gateway.append_conversation_turn',AsyncMock(return_value=OWNER.id)) as saved, \
         patch('app.riwi_gateway.record_riwi_audit',AsyncMock()):
        result=await handle_riwi_chat(None,OWNER,{'message':'Vocabulary tizimi qanday ishlaydi?'},env={'RIWI_EXTERNAL_AI_ENABLED':'false'})
        assert result['navigationLinks'][0]['href']=='/app/vocabulary'
        assert saved.await_args.kwargs['navigation_links']==result['navigationLinks']
