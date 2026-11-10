import asyncio
import json
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from starlette.requests import Request
from app import main as core, step21_vocabulary_create as vocabulary, step21_vocab_batch as batch
from test_migration_phase2 import FakePool
from test_video_vocabulary_folders import Connection, USER, FOLDER, ENTRY

WORD = {'term':'decompose', 'definitionEn':'to break down naturally', 'translationUz':'parchalanmoq'}
TITLE = 'How we can stop people from buying plastic bags and advantages and disadvantages of them'

class FolderConnection:
    def __init__(self): self.calls=[]
    async def __aenter__(self): return self
    async def __aexit__(self,*args): return False
    def transaction(self): return self
    async def fetchrow(self,sql,*args):
        self.calls.append((sql,args))
        assert 'FROM users' in sql
        return {'id':USER}
    async def fetchval(self,sql,*args):
        self.calls.append((sql,args))
        assert 'INSERT INTO vocab_folders' in sql
        return FOLDER

def invoke(monkeypatch,body):
    db=FolderConnection()
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=FakePool(db)))
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':USER}))
    monkeypatch.setattr(core,'payload',AsyncMock(return_value=body))
    add=AsyncMock(return_value={'ok':True,'added':1,'duplicates':0,'ids':[str(ENTRY)]})
    monkeypatch.setattr(vocabulary,'add_batch',add)
    response=asyncio.run(vocabulary.create_vocabulary(Request({'type':'http','method':'POST','path':'/','headers':[]})))
    return response,add,db

@pytest.mark.parametrize('items',[[WORD],[WORD,dict(WORD,term='sustainable')]])
def test_article_default_folder_uses_exact_title_in_same_transaction(monkeypatch,items):
    response,add,db=invoke(monkeypatch,{'sourceType':'article','folderName':TITLE,'items':items})
    assert response.status_code==200
    assert next(args for sql,args in db.calls if 'INSERT INTO vocab_folders' in sql)==(USER,TITLE)
    assert add.call_args.kwargs['folder_id']==FOLDER
    assert add.call_args.kwargs['move_existing'] is True
    assert add.call_args.args[2]==items

def test_chosen_folder_does_not_create_default_folder(monkeypatch):
    response,add,db=invoke(monkeypatch,{'sourceType':'article','folderId':str(FOLDER),'items':[WORD]})
    assert response.status_code==200 and not db.calls
    assert add.call_args.kwargs['folder_id']==FOLDER

@pytest.mark.parametrize('destination',[{'folderName':''},{'folderName':'x'*201},{'folderName':TITLE,'folderId':str(FOLDER)}])
def test_invalid_destination_is_rejected_before_writes(monkeypatch,destination):
    response,add,db=invoke(monkeypatch,{'sourceType':'article','items':[WORD],**destination})
    assert response.status_code==400 and not db.calls
    add.assert_not_awaited()

def test_existing_word_moves_without_resetting_progress():
    db=Connection()
    result=asyncio.run(batch.add_batch(db,USER,[WORD],source_type='article',folder_id=FOLDER,move_existing=True))
    assert result['added']==0 and result['duplicates']==1 and result['moved']==1
    sql,args=next((sql,args) for sql,args in db.calls if 'UPDATE user_vocabulary' in sql)
    assert args==(USER,str(ENTRY),FOLDER)
    assert all(field not in sql for field in ['srs_stage=','mastery=','next_review_at='])
