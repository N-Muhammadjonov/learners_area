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
