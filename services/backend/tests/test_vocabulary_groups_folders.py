"""Source completeness, sequential group gates and non-destructive owned folders."""
import asyncio
import json
from uuid import UUID
from unittest.mock import AsyncMock
from starlette.requests import Request
from app import main as core
from app import vocabulary_folders as folders
from app import vocabulary_flashcard_batches as cards
from app import step19_vocab_games_port as games

USER,FOLDER=UUID(int=900),UUID(int=901)
IDS=[UUID(int=i) for i in range(1,145)]

class Pool:
    def __init__(self,con):self.con=con
    def acquire(self):return self.con

class Context:
    async def __aenter__(self):return self
    async def __aexit__(self,*exc):pass
    def transaction(self):return self

class FolderConnection(Context):
    def __init__(self,owned=True,duplicate=False):self.owned=owned;self.duplicate=duplicate;self.calls=[]
    async def fetchrow(self,sql,*args):
        self.calls.append((sql,args))
        if 'FROM users' in sql:return {'id':USER}
        if 'FROM vocab_folders' in sql:
            assert args==(FOLDER,USER)
            return {'id':FOLDER,'name':'Food'} if self.owned else None
        if 'UPDATE vocab_folders' in sql:
            assert args==(FOLDER,USER,'Meals');return {'id':FOLDER,'name':'Meals'}
        raise AssertionError(sql)
    async def fetchval(self,sql,*args):
        self.calls.append((sql,args));assert args==(USER,'Meals',FOLDER)
        return UUID(int=902) if self.duplicate else None
    async def execute(self,sql,*args):self.calls.append((sql,args));return 'UPDATE 144'

def run_folder(monkeypatch,body,owned=True,duplicate=False):
    con=FolderConnection(owned,duplicate)
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=Pool(con)))
    response=asyncio.run(folders.manage_folder({'id':USER},body))
    return response,con

def test_rename_is_owned_trimmed_and_keeps_folder_identity(monkeypatch):
    r,c=run_folder(monkeypatch,{'action':'rename','folderId':str(FOLDER),'name':' Meals '})
    assert r.status_code==200 and json.loads(r.body)['folder']=={'id':str(FOLDER),'name':'Meals'}
    assert not any('user_vocabulary' in sql for sql,_ in c.calls)

def test_foreign_folder_is_denied_before_any_mutation(monkeypatch):
    r,c=run_folder(monkeypatch,{'action':'delete','folderId':str(FOLDER)},owned=False)
    assert r.status_code==404
    assert not any(sql.startswith(('UPDATE','DELETE')) for sql,_ in c.calls)

def test_duplicate_name_returns_conflict_without_overwriting_either_folder(monkeypatch):
    r,c=run_folder(monkeypatch,{'action':'rename','folderId':str(FOLDER),'name':'Meals'},duplicate=True)
    assert r.status_code==409
    assert not any(sql.startswith(('UPDATE','DELETE')) for sql,_ in c.calls)

def test_delete_only_unfiles_owned_words_and_never_deletes_words_senses_or_srs(monkeypatch):
    r,c=run_folder(monkeypatch,{'action':'delete','folderId':str(FOLDER)})
    assert r.status_code==200 and json.loads(r.body)['wordsPreserved'] is True
    writes=[(sql,args) for sql,args in c.calls if sql.startswith(('UPDATE','DELETE'))]
    assert writes==[
        ('UPDATE user_vocabulary SET folder_id=NULL WHERE user_id=$1 AND folder_id=$2',(USER,FOLDER)),
        ('DELETE FROM vocab_folders WHERE id=$1 AND user_id=$2',(FOLDER,USER))]

def test_invalid_folder_mutation_never_opens_database(monkeypatch):
    pool=AsyncMock(side_effect=AssertionError('no database'))
    monkeypatch.setattr(core,'pool',pool)
    for body in [{'action':'delete','folderId':'bad'},{'action':'rename','folderId':str(FOLDER),'name':' '},
                 {'action':'delete','folderId':str(FOLDER),'userId':str(USER)}]:
        assert asyncio.run(folders.manage_folder({'id':USER},body)).status_code==400
    pool.assert_not_awaited()

class CardConnection(Context):
    def __init__(self,known=()):self.known=set(map(str,known));self.calls=[]
    async def fetch(self,sql,*args):
        self.calls.append((sql,args));assert args[0]==USER
        if 'SELECT uv.id,(uv.next_review_at' in sql:
            assert 'uv.user_id=$1' in sql and 'ORDER BY uv.created_at,uv.id' in sql
            assert 'LIMIT' not in sql and 'random()' not in sql
            return [{'id':i,'due':True} for i in IDS]
        if 'FROM activity_events' in sql:
            assert args[1]==list(map(str,IDS))
            assert 'DISTINCT ON' in sql and 'created_at DESC' in sql
            return [{'eid':i,'known':True} for i in self.known]
        if 'l.definition_en' in sql:
            assert 'uv.user_id=$1 AND uv.id=ANY($2::uuid[])' in sql
            return [{'id':i,'term':'word '+str(i.int),'definitionEn':'unchanged meaning',
                     'translationUz':'Asl tarjima','exampleSentence':'Original example.'} for i in args[1]]
        raise AssertionError(sql)
    async def fetchrow(self,sql,*args):
        self.calls.append((sql,args))
        if 'FROM user_vocabulary' in sql:
            assert args==(str(IDS[10]),USER)
            return {'id':IDS[10],'lexeme_id':UUID(int=999)}
        raise AssertionError(sql)

def test_144_words_make_15_stable_groups_with_four_in_the_last():
    plan=cards.batch_plan(IDS,{})
    assert len(plan)==15 and sum(g['count'] for g in plan)==144
    assert plan[-1]['count']==4
    assert [g['unlocked'] for g in plan]==[True]+[False]*14
    plan=cards.batch_plan(IDS,{str(i):'known' for i in IDS[:10]})
    assert plan[0]['complete'] and plan[1]['unlocked'] and not plan[2]['unlocked']

def test_last_group_and_original_content_are_reachable_after_prior_groups_complete():
    con=CardConnection(IDS[:140])
    r=asyncio.run(cards.read_batch(con,USER,'all',None,None,None))
    data=json.loads(r.body)
    assert data['batchIndex']==14 and data['total']==144 and data['count']==4
    assert [w['id'] for w in data['words']]==list(map(str,IDS[140:]))
    assert all(w['translationUz']=='Asl tarjima' and w['exampleSentence']=='Original example.' for w in data['words'])

def test_locked_group_cannot_read_its_words_or_examples():
    con=CardConnection()
    r=asyncio.run(cards.read_batch(con,USER,'all',None,None,1))
    assert r.status_code==403 and json.loads(r.body)['error']=='batch_locked'
    assert not any('l.definition_en' in sql for sql,_ in con.calls)

def test_folder_batches_are_scoped_to_user_and_folder_in_every_membership_read():
    con=CardConnection()
    asyncio.run(cards.read_batch(con,USER,'folder',str(FOLDER),None,0))
    sql,args=con.calls[0]
    assert 'uv.folder_id=$2' in sql and args==(USER,str(FOLDER))

def test_forged_next_group_assessment_is_rejected_before_events_or_lexeme_reads(monkeypatch):
    con=CardConnection()
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=Pool(con)))
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':USER}))
    monkeypatch.setattr(core,'payload',AsyncMock(return_value={'entryId':str(IDS[10]),'set':'all',
        'gameId':'cards','batchIndex':1,'submission':{'kind':'self','known':True}}))
    req=Request({'type':'http','method':'POST','path':'/api/vocabulary/games','headers':[]})
    r=asyncio.run(games.answer_game(req))
    assert r.status_code==403 and json.loads(r.body)['error']=='batch_locked'
    assert not any('FROM lexemes WHERE' in sql for sql,_ in con.calls)

def test_batch_input_preserves_legacy_contract_and_rejects_invalid_new_index():
    body={'entryId':str(IDS[0]),'set':'all','gameId':'cards','submission':{'kind':'self','known':True}}
    assert games.input_valid(body)
    assert games.input_valid({**body,'batchIndex':0})
    for i in [-1,True,'1',1000001]:assert not games.input_valid({**body,'batchIndex':i})


def test_existing_folder_http_endpoint_routes_new_action_with_active_auth(monkeypatch):
    from fastapi.testclient import TestClient
    con=FolderConnection()
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=Pool(con)))
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':USER}))
    r=TestClient(core.app).post('/api/vocabulary/folders',json={'action':'rename','folderId':str(FOLDER),'name':'Meals'})
    assert r.status_code==200 and r.json()['folder']['name']=='Meals'
    assert r.headers['cache-control']=='private, no-store'


def test_folder_management_denies_anonymous_before_any_database_access(monkeypatch):
    from fastapi.testclient import TestClient
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value=None))
    pool=AsyncMock(side_effect=AssertionError('anonymous database access'))
    monkeypatch.setattr(core,'pool',pool)
    r=TestClient(core.app).post('/api/vocabulary/folders',json={'action':'delete','folderId':str(FOLDER)})
    assert r.status_code==401
    pool.assert_not_awaited()
