"""Owned ready-pack folders and authoritative canonical senses."""
import asyncio
import json
import uuid
from unittest.mock import AsyncMock, patch
from starlette.requests import Request
from app import step21_packs_port as port

A, B, PACK, LEXEME = [uuid.UUID(int=i) for i in (101,202,303,404)]

class Transaction:
    async def __aenter__(self): return self
    async def __aexit__(self,*args): pass

class Connection:
    def __init__(self,actor):
        self.actor=actor
        self.folder=uuid.UUID(int=1000+actor.int)
        self.calls=[]
    async def __aenter__(self): return self
    async def __aexit__(self,*args): pass
    def transaction(self): return Transaction()
    async def fetchrow(self,sql,*args):
        self.calls.append((sql,args))
        if 'FROM vocabulary_topic_packs' in sql:
            assert args==('food',)
            return {'id':PACK,'slug':'food','label_en':'Food'}
        assert 'FROM users WHERE id=$1 FOR UPDATE' in sql
        assert args==(self.actor,)
        return {'id':self.actor}
    async def fetch(self,sql,*args):
        self.calls.append((sql,args))
        assert args==(PACK,)
        assert 'l.id,' in sql
        return [{'id':LEXEME,'term':'contextual term','part_of_speech':None,
            'definition_en':'The authored meaning','translation_uz':'tarjima',
            'example_sentence':'The authored example.','collocations':None}]
    async def execute(self,sql,*args):
        self.calls.append((sql,args))
        assert args==(self.actor,'food',self.folder)
        assert 'folder_id IS NULL' in sql and 'user_id=$1' in sql
        return 'UPDATE 0'
    async def fetchval(self,sql,*args):
        self.calls.append((sql,args))
        assert 'INSERT INTO vocab_folders' in sql
        assert 'ON CONFLICT(user_id,name)' in sql
        assert args==(self.actor,'Food')
        assert 'FOR UPDATE' in self.calls[-2][0]
        return self.folder

class Pool:
    def __init__(self,con): self.con=con
    def acquire(self): return self.con

def request():
    return Request({'type':'http','method':'POST','path':'/api/vocabulary/packs',
        'query_string':b'','headers':[],'scheme':'https',
        'server':('fixture.invalid',443)})

def test_ready_pack_add_uses_an_owned_named_folder_and_canonical_ids():
    async def run():
        folders={}
        for actor in (A,B):
            con=Connection(actor)
            add=AsyncMock(return_value={'ok':True,'added':1,'duplicates':0,'points':0})
            with patch.object(port.core,'current_user',AsyncMock(return_value={'id':actor})), \
                 patch.object(port.core,'payload',AsyncMock(return_value={'packId':'food'})), \
                 patch.object(port.core,'pool',AsyncMock(return_value=Pool(con))), \
                 patch.object(port,'add_batch',add):
                for _ in range(2):
                    response=await port.add_pack(request())
                    assert response.status_code==200
                    assert json.loads(response.body)=={'ok':True,'added':1,'duplicates':0,'points':0}
                    args,kwargs=add.call_args
                    assert args[1]==actor
                    assert args[2][0]['canonicalLexemeId']==str(LEXEME)
                    assert args[2][0]['definitionEn']=='The authored meaning'
                    assert kwargs=={'topic_pack':'food','source_type':'topic_pack','folder_id':con.folder}
                assert add.await_count==2
            folders[actor]=con.folder
        assert folders[A]!=folders[B]
    asyncio.run(run())

def test_unauthenticated_ready_pack_add_does_not_touch_the_database():
    async def run():
        pool=AsyncMock()
        with patch.object(port.core,'current_user',AsyncMock(return_value=None)),patch.object(port.core,'pool',pool):
            response=await port.add_pack(request())
        assert response.status_code==401
        assert pool.await_count==0
    asyncio.run(run())

def test_uploaded_ready_packs_keep_all_ten_names_and_source_counts():
    from pathlib import Path
    from app.vocabulary_packs_port import built_in_summaries
    expected={'Food':302,'Health':225,'Shopping':97,'Sports':125,
        'Technology':266,'Fashion':152,'Work':308,'Housing':181,'Media':161,'Art':175}
    summaries=built_in_summaries()
    assert {p['label']:p['wordCount'] for p in summaries}==expected
    assert all(p['labelUz']==p['label'] for p in summaries if p['id']!='art')
    assert next(p for p in summaries if p['id']=='art')['labelUz']=='San’at'
    path=Path(port.__file__).with_name('vocabulary_builtin_packs.json')
    packs=json.loads(path.read_text(encoding='utf-8'))
    assert len(packs)==10 and sum(len(p['words']) for p in packs)==1992
    assert {p['id'] for p in packs}=={name.lower() for name in expected}
    food = next(pack for pack in packs if pack['id'] == 'food')
    assert food['words'][0]['term'] == 'Staple food'
    assert food['words'][-1]['term'] == 'Have a carbon footprint'
    assert len({word['term'].casefold() for word in food['words']}) == 302
    media = next(pack for pack in packs if pack['id'] == 'media')
    assert media['words'][0]['term'] == 'mass media'
    assert media['words'][-1]['term'] == 'rethink something'
    assert len({word['term'].casefold() for word in media['words']}) == 161
    assert 'Usage:' in next(word for word in media['words'] if word['term'] == 'mass media')['definitionEn']
    art = next(pack for pack in packs if pack['id']=='art')
    assert len(art['words'])==175 and art['words'][0]['term']=='the arts'
    assert art['words'][-1]['term']=='a cult following'
    for pack in packs:
        for word in pack['words']:
            assert word['term'] and word['definitionEn'] and word['translationUz'] and word['example']
