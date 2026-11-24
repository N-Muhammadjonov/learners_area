from unittest.mock import AsyncMock
import pytest
from app import browser_listening as listening

@pytest.mark.asyncio
async def test_mcq_cards_only_expose_audio_after_sequential_unlock(monkeypatch):
 rows=[{'id':str(n),'program_ordinal':n,'title':f'Day {n}','audio_url':f'/api/resources/audio/{n}.mp3','publication_state':'published',
        'status':{'state':'not_started','total':2,'completed':0}} for n in (1,2)]
 monkeypatch.setattr(listening,'programme_snapshot',AsyncMock(return_value=rows))
 result=await listening.days(None,{'role':'student'},{})
 assert result['days'][0]['audioUrl']=='/api/resources/audio/1.mp3'
 assert result['days'][0]['locked'] is False
 assert result['days'][1]['locked'] is True and result['days'][1]['audioUrl'] is None
 rows[0]['status']={'state':'completed','total':2,'completed':2}
 result=await listening.days(None,{'role':'student'},{})
 assert result['days'][1]['locked'] is False and result['days'][1]['audioUrl']=='/api/resources/audio/2.mp3'


@pytest.mark.asyncio
async def test_programme_audio_is_bound_to_each_question_and_missing_clips_stay_missing():
    prefix = 'listening/mcq/day-01/question-'
    questions = [{'order': 2, 'id': 'second'}, {'order': 1, 'id': 'first'}, {'order': 3, 'id': 'third'}]

    class Connection:
        fetch = AsyncMock(return_value=[{'object_key': prefix + '01.mp3'}, {'object_key': prefix + '02.mp3'}])

    connection = Connection()
    test = {'id': 'day-one', 'audio_url': '/api/resources/' + prefix + '01.mp3'}
    result = await listening.attach_programme_clips(connection, 1, test, questions)
    assert [row['audioUrl'] for row in result] == [
        '/api/resources/' + prefix + '02.mp3',
        '/api/resources/' + prefix + '01.mp3',
        None,
    ]
    query, test_id, keys = connection.fetch.await_args.args
    assert "owner_type='listening'" in query and test_id == 'day-one'
    assert keys == [prefix + '02.mp3', prefix + '01.mp3', prefix + '03.mp3']
    custom = {'id': 'custom-day', 'audio_url': '/api/resources/listening/custom/recording.mp3'}
    assert await listening.attach_programme_clips(connection, 1, custom, questions) == questions
    assert connection.fetch.await_count == 1
