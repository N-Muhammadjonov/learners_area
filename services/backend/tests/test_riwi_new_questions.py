import runpy
from pathlib import Path
import pytest
from app.riwi_capabilities import RiwiActor
from app import riwi_new_questions as q

ROOT = Path(__file__).resolve().parents[3]
STUDENT = RiwiActor('11111111-1111-4111-8111-111111111111', 'student')


def test_source_and_authored_answers_compile_reproducibly():
    assert runpy.run_path(str(ROOT / 'scripts/riwi/build_new_questions.py'))['compile_pack']() == q.pack()
    assert sum(len(e['queries']) for e in q.pack()['entries']) == 1000


@pytest.mark.parametrize('entry', q.pack()['entries'], ids=lambda e: e['id'])
def test_every_original_variant_resolves_without_ambiguous_intent(entry):
    for query in entry['queries']:
        assert q.find(query)['id'] == entry['id']
    for lang in ('uz', 'en'):
        assert q.reply(STUDENT, entry['queries'][0], lang)['answer']


def test_unrelated_and_changed_numbers_do_not_select_an_answer():
    assert q.find('Choose FOUR letters MCQ javobini ber') is None
    assert q.find('MCQ uchun nechta daraxt ekay') is None
    two = q.reply(STUDENT, 'Choose THREE degani uchta harfmi?', 'uz')
    assert 'uchta' in two['answer']


def test_role_is_server_actor_not_the_question_claim():
    entry = q.pack()['entries'][-1]
    for role in ('student', 'admin'):
        assert q.reply(RiwiActor(STUDENT.id, role), entry['queries'][0], 'uz')['provenance'] == 'policy_refusal'
    assert q.reply(RiwiActor(STUDENT.id, 'teacher'), entry['queries'][0], 'uz')['provenance'] == 'deterministic_learning_data'


@pytest.mark.asyncio
@pytest.mark.parametrize('entry', q.pack()['entries'], ids=lambda e: e['id'])
async def test_gateway_preserves_specific_procedure_before_broad_module_router(entry):
    from app.riwi_gateway import handle_riwi_chat
    result = await handle_riwi_chat(None, STUDENT, {'message': entry['queries'][1]}, env={})
    assert result['provider']['questionId'] == entry['id']
    assert result['provenance'] == ('deterministic_learning_data' if 'student' in entry['roles'] else 'policy_refusal')
