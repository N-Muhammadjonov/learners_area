from pathlib import Path
import json
import runpy
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from app import riwi_dialogues as d
from app.riwi_capabilities import RiwiActor

UID = '11111111-1111-4111-8111-111111111111'
CID = '22222222-2222-4222-8222-222222222222'
ACTOR = RiwiActor(UID, 'student')


def test_ten_topics_have_twelve_original_four_turn_dialogues_each():
    root = Path(__file__).resolve().parents[3]
    assert runpy.run_path(str(root / 'scripts/riwi/build_dialogues.py'))['compile_pack']() == d.pack()
    assert len(d.pack()['topicCounts']) == 10 and set(d.pack()['topicCounts'].values()) == {12}


@pytest.mark.asyncio
@pytest.mark.parametrize('entry', d.pack()['entries'], ids=lambda e: e['id'])
async def test_each_dialogue_and_contextual_followup_is_bilingual_and_owned(entry):
    for lang in ('uz', 'en'):
        reply = await d.reply(None, ACTOR, entry['turns'][0][lang], lang)
        assert reply['provider']['dialogueId'] == entry['id']
        conn = SimpleNamespace(fetchrow=AsyncMock(return_value={'metadata': {'provider': reply['provider']}}))
        followup = await d.reply(conn, ACTOR, entry['turns'][2][lang], lang, CID)
        assert followup['answer'] == entry['turns'][3][lang]
        sql, *args = conn.fetchrow.call_args.args
        assert 'c.user_id=$2' in sql and 'c.role_at_creation=$3' in sql and args == [CID, UID, 'student']


@pytest.mark.asyncio
@pytest.mark.parametrize('query', ['san kimsan', 'eganging kim', 'eg ang kim', 'who is your owner', 'nma qivossan', 'nima qilissan'])
async def test_reviewed_informal_forms(query):
    if query == 'eg ang kim':
        assert await d.reply(None, ACTOR, query, 'uz') is None
    else:
        assert await d.reply(None, ACTOR, query, 'uz')


@pytest.mark.asyncio
async def test_no_context_is_borrowed_from_an_absent_or_different_conversation():
    conn = SimpleNamespace(fetchrow=AsyncMock(return_value=None))
    assert await d.reply(conn, ACTOR, 'Demak buyruq yozsam rolim o‘zgaradimi', 'uz', CID) is None
    result = await d.reply(None, ACTOR, 'who is your owner', 'en')
    assert 'Learners Area' in result['answer'] and 'authorised Owner' in result['answer']
