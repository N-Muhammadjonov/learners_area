"""Focused regressions for source vocabulary saving and mandatory Telegram gates."""
import asyncio,json
from unittest.mock import AsyncMock,ANY
from uuid import UUID
import pytest
from starlette.requests import Request
from fastapi.testclient import TestClient
from app import main as core
from app import step21_sourced_vocab as source
from app import step21_vocab_batch as batch
from app import step18_telegram_admission_port as admission
from test_migration_phase2 import FakePool
from test_telegram_batch_80 import DB
from test_video_vocabulary_folders import Connection,USER,FOLDER,ENTRY

PROMPT=UUID(int=60)
WORD={'term':'free time','definitionEn':'free time','translationUz':'bo‘sh vaqt','exampleSentence':'I enjoy my free time.'}

def test_source_save_preserves_meaning_and_uses_an_owned_topic_folder(monkeypatch):
    class SpeakingDB(DB):
        async def fetchrow(self,sql,*args):
            self.calls.append(('fetchrow',sql,args))
            if 'FROM speaking_prompts' in sql:
                assert 'CONTENT_DELETED' in sql
                return {'id':PROMPT,'publication_state':'published','publish_at':None,'available_in':['practice_alone'],
                        'prompt_text':'Describe a place.','study_support':{'vocabulary':[WORD]}}
            if 'INSERT INTO vocab_folders' in sql:
                assert args==(USER,'Describe a place.')
                return {'id':FOLDER,'name':'Describe a place.'}
            return {'id':USER}
    con=SpeakingDB()
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':USER}))
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=FakePool(con)))
    monkeypatch.setattr(core,'payload',AsyncMock(return_value={'promptId':str(PROMPT),'indices':[0]}))
    save=AsyncMock(return_value={'ok':True,'added':1,'duplicates':0,'ids':[str(ENTRY)]})
    monkeypatch.setattr(source,'add_batch',save)
    response=asyncio.run(source.prompt_vocabulary(Request({'type':'http','method':'POST','path':'/','headers':[]})))
    assert response.status_code==200 and 'no-store' in response.headers['cache-control']
    assert save.call_args.args[2]==[dict(WORD,authored=True)]
    assert save.call_args.kwargs=={'folder_id':FOLDER,'source_type':'speaking','source_id':PROMPT,'move_existing':True}
    assert json.loads(response.body)['folder']['id']==str(FOLDER)

def test_resaving_existing_speaking_word_files_only_unassigned_owned_words():
    con=Connection()
    result=asyncio.run(batch.add_batch(con,USER,[WORD],source_type='speaking',source_id=PROMPT,folder_id=FOLDER))
    assert result['ok'] and result['added']==0
    updates=[(q,a) for q,a in con.calls if 'UPDATE user_vocabulary' in q]
    assert len(updates)==1 and updates[0][1]==(USER,str(ENTRY),FOLDER)
    assert 'user_id=$1' in updates[0][0] and 'folder_id IS NULL' in updates[0][0]

@pytest.mark.parametrize('purpose',['login','register','link','replace',None])
def test_preflight_checks_membership_for_every_purpose_and_direct_start(monkeypatch,purpose):
    con=DB();con.rows['SELECT purpose']={'purpose':purpose}
    con.fetchval=AsyncMock(return_value=PROMPT)
    monkeypatch.setenv('BOT_SERVICE_SECRET','demo_bot_token')
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=FakePool(con)))
    gate=AsyncMock(return_value={'error':'not_subscribed','requiredChannels':[{'url':'https://t.me/learners_area'}]})
    monkeypatch.setattr(admission,'gates',gate)
    with TestClient(core.app) as client:
        response=client.post('/api/internal/telegram/auth/preflight',headers={'Authorization':'Bearer demo_bot_token'},
                             json={'token':'valid-token' if purpose else '', 'telegramUserId':'12345'})
    assert response.status_code==403 and response.json()['error']=='not_subscribed'
    assert response.json()['requiredChannels'][0]['url']=='https://t.me/learners_area'
    gate.assert_awaited_once_with(ANY,'12345')
    from app.db import PooledReads
    assert isinstance(gate.await_args.args[0],PooledReads)

def test_confirm_does_not_consume_intent_before_membership_passes(monkeypatch):
    con=DB();con.rows['SELECT id,user_id']={'id':PROMPT,'user_id':None}
    monkeypatch.setenv('BOT_SERVICE_SECRET','demo_bot_token')
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=FakePool(con)))
    monkeypatch.setattr(admission,'gates',AsyncMock(return_value={'error':'not_subscribed','requiredChannels':[]}))
    with TestClient(core.app) as client:
        r=client.post('/api/internal/telegram/auth/confirm',headers={'Authorization':'Bearer demo_bot_token'},json={'token':'valid-token','telegramUserId':'12345'})
    assert r.status_code==403 and r.json()['error']=='not_subscribed'
    assert not any('UPDATE telegram_login_intents' in q for _,q,_ in con.calls)


def test_legacy_signed_callback_also_refuses_membership_bypass(monkeypatch):
    from app import step18_telegram_auth_port as auth
    con=DB()
    monkeypatch.setattr(auth,'telegram_verified',lambda p:True)
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=FakePool(con)))
    monkeypatch.setattr(admission,'gates',AsyncMock(return_value={'error':'not_subscribed'}))
    issue=AsyncMock();monkeypatch.setattr(core,'issue_token',issue)
    response=TestClient(core.app).get('/api/auth/telegram/callback?id=12345',follow_redirects=False)
    assert response.status_code==307
    assert response.headers['location'].endswith('/login?error=telegram_not_subscribed')
    issue.assert_not_called()
