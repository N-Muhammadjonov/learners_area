from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from app.riwi_capabilities import RiwiActor
from app.riwi_grammar_examples import reply

ACTOR = RiwiActor('11111111-1111-4111-8111-111111111111', 'student')


@pytest.mark.asyncio
async def test_dictionary_verified_sense_generates_supported_tense_examples():
    broker = SimpleNamespace(execute=AsyncMock(return_value={'resolved': True, 'partOfSpeech': 'verb', 'summary': 'write: yozmoq', 'senseId': 'verified'}))
    result = await reply(None, ACTOR, '“write” sozi bilan past simple uchun 3 ta gap tuz', 'uz', broker)
    assert all(x in result['answer'] for x in ('I wrote a letter.', 'She wrote a letter.', 'They wrote a letter.'))
    assert result['provider']['senseId'] == 'verified'
    assert broker.execute.call_args.kwargs['raw_input']['term'] == 'write'
    assert broker.execute.call_args.kwargs['raw_input']['partOfSpeech'] == 'verb'
    assert broker.execute.call_args.kwargs['raw_input']['meaningUz'] == 'yozmoq'


@pytest.mark.asyncio
async def test_missing_or_wrong_sense_does_not_get_invented_inflection():
    broker = SimpleNamespace(execute=AsyncMock(return_value={'resolved': True, 'partOfSpeech': 'noun'}))
    result = await reply(None, ACTOR, '“read” word bilan present perfect 3 ta gap ber', 'uz', broker)
    assert result['provenance'] == 'unavailable'
    broker.execute.reset_mock()
    assert await reply(None, ACTOR, '“inventedverb” bilan past simple gap tuz', 'uz', broker) is None
    broker.execute.assert_not_awaited()
