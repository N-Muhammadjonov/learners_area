"""Published Listening sense membership and canonical content survive saving."""
import asyncio
import json
from uuid import UUID
from unittest.mock import AsyncMock

from starlette.requests import Request
from app import main as core
from app import step21_vocabulary_create as create
from app.step21_vocab_batch import sense_key

USER,TEST,SENSE,FOLDER,FOREIGN=[UUID(int=i) for i in range(1,6)]
AUTHORED={'word':'desiccation','pos':'noun','def':'the process of becoming completely dry or losing water',
          'uz':'qurib qolish; suvsizlanish','ex':'One danger is starvation; another is desiccation.'}
LEX={'id':SENSE,'term':AUTHORED['word'],'part_of_speech':'noun','definition_en':AUTHORED['def'],
     'translation_uz':AUTHORED['uz'],'example_sentence':AUTHORED['ex'],
     'sense_key':sense_key({'term':AUTHORED['word'],'partOfSpeech':'noun','definitionEn':AUTHORED['def']}),
     'unit_type':'word','unit_ipa':None,'occurrence_id':None}

def execute(monkeypatch,*,sense=SENSE,access='allowed',legacy=False):
    class Connection:
        def __init__(self):self.reads=[]
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        def transaction(self):return self
        async def fetchrow(self,sql,*args):
            self.reads.append(sql)
            if 'FROM listening_packages' in sql:
                return {'payload':{'vocabulary':[{'senseId':str(SENSE)}] if legacy else [dict(AUTHORED)]}}
            if 'FROM lexemes' in sql:
                assert args==(SENSE,);return dict(LEX)
            raise AssertionError(sql)
        async def fetch(self,sql,*args):
            self.reads.append(sql)
            assert 'FROM lexemes l' in sql and args[2]==TEST
            return [dict(LEX)]
    con=Connection()
    class Pool:
        def acquire(self):return con
    add=AsyncMock(return_value={'ok':True,'added':1})
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=Pool()))
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':USER}))
    monkeypatch.setattr(core,'payload',AsyncMock(return_value={'sourceType':'listening','sourceId':str(TEST),
        'sessionSenseId':str(sense),'folderId':str(FOLDER),
        'items':[{'term':'forged term','definitionEn':'forged definition','translationUz':'forged translation'}]}))
    monkeypatch.setattr(create,'text_access',AsyncMock(return_value=access))
    monkeypatch.setattr(create,'add_batch',add)
    response=asyncio.run(create.create_vocabulary(Request({'type':'http','method':'POST','path':'/','headers':[]})))
    return response,add,con

def test_curated_session_save_keeps_exact_canonical_meaning_translation_example_and_folder(monkeypatch):
    response,add,_=execute(monkeypatch)
    assert response.status_code==200
    con,user,items=add.call_args.args
    assert user==USER
    assert items==[{'term':LEX['term'],'definitionEn':LEX['definition_en'],
        'translationUz':LEX['translation_uz'],'partOfSpeech':'noun',
        'exampleSentence':AUTHORED['ex'],'canonicalLexemeId':SENSE}]
    assert add.call_args.kwargs['folder_id']==FOLDER
    assert add.call_args.kwargs['source_type']=='listening'
    assert add.call_args.kwargs['source_id']==TEST

def test_existing_unrelated_uuid_cannot_be_saved_as_a_member_of_this_test(monkeypatch):
    response,add,_=execute(monkeypatch,sense=FOREIGN)
    assert response.status_code==404
    assert json.loads(response.body)=={'error':'source_not_found'}
    add.assert_not_awaited()

def test_active_exam_cannot_read_session_or_write_vocabulary(monkeypatch):
    response,add,con=execute(monkeypatch,access='locked')
    assert response.status_code==403
    assert not con.reads
    add.assert_not_awaited()

def test_existing_explicit_sense_package_contract_retains_canonical_translations(monkeypatch):
    response,add,_=execute(monkeypatch,legacy=True)
    assert response.status_code==200
    item=add.call_args.args[2][0]
    assert item['canonicalLexemeId']==SENSE
    assert item['translationUz']==LEX['translation_uz']
    assert item['exampleSentence']==LEX['example_sentence']
