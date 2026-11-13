from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.riwi_capabilities import RiwiActor
from app.riwi_tools_domain import _validate_dictionary_input, lookup_canonical_dictionary


ACTOR = RiwiActor('11111111-1111-4111-8111-111111111111', 'student')


@pytest.fixture
def dictionary(monkeypatch):
    from app import dictionary_reader_metadata as metadata
    from app import step17_dictionary_read_port as port
    value = {'lexeme_id': 'lexeme', 'display_lemma': 'write', 'part_of_speech': 'v',
             'senses': [
                 {'sense_id': 'spelling', 'definition_en': 'spell a word', 'sense_order': 2,
                  'translations': [{'text': 'harflab yozmoq'}], 'examples': []},
                 {'sense_id': 'writing', 'definition_en': 'form letters or words on a surface', 'sense_order': 1,
                  'translations': [{'text': 'yozmoq'}], 'examples': []}]}
    monkeypatch.setattr(metadata, 'stored', lambda _: None)
    monkeypatch.setattr(port, 'active_release', AsyncMock(return_value={'active_release_id': 'release'}))
    monkeypatch.setattr(port, 'entry', AsyncMock(return_value=value))
    conn = SimpleNamespace(fetchrow=AsyncMock(return_value={'lexeme_id': 'lexeme'}),
                           fetchval=AsyncMock(return_value=False))
    return conn, value


@pytest.mark.asyncio
async def test_general_lookup_uses_ranked_primary_sense_instead_of_storage_order(dictionary):
    conn, _ = dictionary
    result = await lookup_canonical_dictionary(conn, ACTOR, {'term': 'write', 'locale': 'uz'})
    assert result['senseId'] == 'writing'
    assert result['definitionUz'] == 'yozmoq'


@pytest.mark.asyncio
async def test_grammar_looks_up_a_verb_and_the_exact_reviewed_meaning(dictionary):
    conn, _ = dictionary
    result = await lookup_canonical_dictionary(conn, ACTOR, _validate_dictionary_input({
        'term': 'write', 'locale': 'uz', 'partOfSpeech': 'verb', 'meaningUz': 'yozmoq'}))
    assert result['senseId'] == 'writing'
    assert "part_of_speech IN ('v','verb')" in conn.fetchrow.call_args.args[0]
    assert conn.fetchrow.call_args.args[1:] == ('release', 'write')


@pytest.mark.asyncio
async def test_unverified_meaning_or_noun_cannot_supply_a_grammar_example(dictionary):
    conn, value = dictionary
    data = {'term': 'write', 'partOfSpeech': 'verb', 'meaningUz': 'uchmoq'}
    assert not (await lookup_canonical_dictionary(conn, ACTOR, data))['resolved']
    value['part_of_speech'] = 'noun'
    data['meaningUz'] = 'yozmoq'
    assert not (await lookup_canonical_dictionary(conn, ACTOR, data))['resolved']


@pytest.mark.asyncio
async def test_occurrence_binding_is_preserved_and_cannot_be_switched_by_gloss(dictionary):
    conn, _ = dictionary
    conn.fetchrow.return_value = {'lexeme_id': 'lexeme', 'sense_id': 'spelling'}
    data = {'term': 'write', 'occurrenceId': '22222222-2222-4222-8222-222222222222'}
    assert (await lookup_canonical_dictionary(conn, ACTOR, data))['senseId'] == 'spelling'
    data.update(partOfSpeech='verb', meaningUz='yozmoq')
    assert not (await lookup_canonical_dictionary(conn, ACTOR, data))['resolved']


@pytest.mark.asyncio
async def test_exam_lock_runs_before_dictionary_selection(dictionary):
    conn, _ = dictionary
    conn.fetchval.return_value = True
    with pytest.raises(PermissionError, match='active_exam_lookup_forbidden'):
        await lookup_canonical_dictionary(conn, ACTOR, {'term': 'write', 'partOfSpeech': 'verb'})
    conn.fetchrow.assert_not_awaited()


@pytest.mark.parametrize('extra', [
    {'partOfSpeech': 'verb OR true'}, {'meaningUz': 'yozmoq'},
    {'partOfSpeech': 'verb', 'meaningUz': ''}, {'partOfSpeech': 'verb', 'meaningUz': ['yozmoq']},
])
def test_lookup_filters_have_a_closed_input_schema(extra):
    with pytest.raises(ValueError, match='invalid_input'):
        _validate_dictionary_input({'term': 'write', **extra})
