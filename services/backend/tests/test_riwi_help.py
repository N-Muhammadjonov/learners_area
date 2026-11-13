import asyncio
import pytest
from unittest.mock import AsyncMock,patch
from app import riwi_help as h
from app import riwi_new_questions as q
from app.riwi_capabilities import RiwiActor

UID = '11111111-1111-4111-8111-111111111111'


@pytest.mark.parametrize('role', ['student', 'teacher', 'admin', 'owner'])
@pytest.mark.parametrize('group', h.GROUPS, ids=lambda x: x['id'])
def test_every_module_has_three_clickable_answerable_questions_with_role_filter(role, group):
    actor = RiwiActor(UID, role)
    response = h.reply(actor, group['questions'][0], 'uz')
    assert response
    choices = h.suggestions(actor, group['questions'][0], 'uz')
    if role not in group['roles']:
        assert response['provenance'] == 'policy_refusal' and choices == []
        return
    assert len(choices) == 3 and len({c['id'] for c in choices}) == 3
    for choice in choices:
        reply = h.reply(actor, choice['question'], 'uz') or q.reply(actor, choice['question'], 'uz')
        assert reply and reply['provenance'] == 'deterministic_learning_data'


@pytest.mark.parametrize('text', ['MCQ qanaqa ishlidi?', 'MCQni qanday ishlataman?', 'MCQ qanday ishlaydi?'])
def test_dialect_generic_control_understood_without_picking_an_exam_answer(text):
    assert 'yo‘riqnomadagi' in h.reply(RiwiActor(UID, 'student'), text, 'uz')['answer']


def test_keywords_alone_cannot_invent_an_intent_or_change_number_negation():
    actor = RiwiActor(UID, 'student')
    assert h.reply(actor, 'MCQ uchun binafsha daraxt ekish kerakmi', 'uz') is None
    for text in ('Choose FOUR letters MCQ javobini ber', 'MCQda ikkita emas uchta emas yettita javob tanlaymanmi'):
        assert q.find(text) is None
        fallback = h.fallback(actor, text, 'uz')
        assert len(fallback['questionSuggestions']) == 3
    assert h.items(actor, ['owner', 'management', 'teaching', '<script>'], 'uz') == []


def test_semantic_keyword_retrieval_compares_specific_meaning():
    assert q.find('Please explain how I choose THREE answers in an MCQ')['id'] == 'RIWI-NEW-002'
    assert q.find('How can I select two letters in an MCQ?')['id'] == 'RIWI-NEW-001'


@pytest.mark.asyncio
async def test_gateway_fallback_then_click_question_returns_real_method():
    from app.riwi_gateway import handle_riwi_chat
    actor = RiwiActor(UID, 'student')
    first = await handle_riwi_chat(None, actor, {'message': 'MCQ purple hedgehog unknown question'}, env={})
    assert first['provenance'] == 'unavailable'
    assert len(first['questionSuggestions']) == 3
    second = await handle_riwi_chat(None, actor, {'message': first['questionSuggestions'][0]['question']}, env={})
    assert second['provenance'] == 'deterministic_learning_data'
    assert second['provider']['model'] == 'riwi-new-questions-v1'


@pytest.mark.asyncio
@pytest.mark.parametrize('module', ['reading', 'listening', 'writing', 'speaking', 'retention', 'podcast'])
async def test_live_material_resolution_path_also_offers_role_safe_question_buttons(module):
    from app.riwi_gateway import handle_riwi_chat
    actor = RiwiActor(UID, 'student')
    with patch('app.riwi_material_search.resolve_material', AsyncMock(return_value={'clarification':'name','kinds':[module]})):
        first = await handle_riwi_chat(None, actor, {'message': module+' uchun binafsha daraxt ekaymi?'}, env={})
    assert len(first['questionSuggestions']) == 3
    assert first['provider']['suggestionIds'] == [q['id'] for q in first['questionSuggestions']]
    assert first['provider']['materialSearchKinds'] == [module]


@pytest.mark.asyncio
async def test_active_assessment_refusal_does_not_offer_a_material_lookup_bypass():
    from app.riwi_gateway import handle_riwi_chat
    with patch('app.riwi_material_search.resolve_material', AsyncMock(return_value={'clarification':'active_exam_lookup_forbidden','kinds':['reading']})):
        result = await handle_riwi_chat(None, RiwiActor(UID,'student'), {'message':'Reading uchun boshqa matnni top'}, env={})
    assert result['provenance'] == 'policy_refusal'
    assert not result.get('questionSuggestions')
