from pathlib import Path
import runpy
import pytest
from app import riwi_site_grammar as g
from app.riwi_capabilities import RiwiActor

ACTOR = RiwiActor('11111111-1111-4111-8111-111111111111', 'student')


def test_all_current_grammar_sources_are_covered_without_exercise_keys():
    root = Path(__file__).resolve().parents[3]
    assert runpy.run_path(str(root / 'scripts/riwi/build_site_grammar.py'))['compile_pack']() == g.pack()
    assert {track: sum(e['track'] == track for e in g.pack()['entries']) for track in ('grammar', 'speaking', 'writing')} == {'grammar': 80, 'speaking': 77, 'writing': 120}
    forbidden = {'items', 'answer', 'answers', 'correctAnswer', 'correct_option', 'model', 'practice_qa'}
    def inspect(value):
        if isinstance(value, dict):
            assert not forbidden.intersection(value)
            for v in value.values(): inspect(v)
        elif isinstance(value, list):
            for v in value: inspect(v)
    inspect(g.pack())


@pytest.mark.parametrize('entry', g.pack()['entries'], ids=lambda e: e['id'])
def test_every_unit_can_teach_three_examples_and_how_to_do_all_stages(entry):
    assert g.select(entry['id'])['id'] == entry['id']
    for lang in ('uz', 'en'):
        reply = g.reply(ACTOR, entry['id'], lang)
        assert reply['provider']['grammarUnitId'] == entry['id']
        assert all(f'{i}) ' in reply['answer'] for i in (1, 2, 3))
        assert ('javobini bermayman' in reply['answer']) if lang == 'uz' else ('exercise key' in reply['answer'])
        assert len(reply['answer']) <= 5800


def test_ambiguous_generic_queries_do_not_pick_a_random_unit():
    assert g.select('grammar') is None
    assert g.reply(RiwiActor(ACTOR.id, 'student', 'suspended'), 'spk-01', 'uz') is None


def test_spoken_contractions_are_common_not_mandatory_and_markup_is_readable():
    reply = g.reply(ACTOR, 'a0-2 darsini tushuntir', 'uz')
    assert 'urg‘u yoki qarama-qarshilikda to‘liq shakl ham keladi' in reply['answer']
    assert 'Og\'zaki nutqda doim shunday' not in reply['answer']
    assert '**' not in reply['answer'] and '`' not in reply['answer']
