"""Source-owned video folders, canonical meanings and duplicate repair."""
import asyncio
from uuid import UUID
from unittest.mock import AsyncMock, patch
from app import main as core
from app import step21_vocab_batch as batch
from app import step21_sourced_vocab as sourced
from starlette.requests import Request

USER,VIDEO,FOLDER,ENTRY,LEXEME=[UUID(int=i) for i in range(1,6)]

class Connection:
    def __init__(self,owned=True,title='How to Make Stress Your Friend'):self.owned=owned;self.title=title;self.calls=[]
    async def fetchrow(self,sql,*args):
        self.calls.append((sql,args))
        if 'FROM users' in sql:return {'id':USER}
        if 'FROM lexemes' in sql:return {'id':LEXEME,'sense_key':'authored-sense'}
        raise AssertionError(sql)
    async def fetchval(self,sql,*args):
        self.calls.append((sql,args))
        if 'SELECT id FROM vocab_folders' in sql:
            assert args==(FOLDER,USER);return FOLDER if self.owned else None
        if 'SELECT title FROM video_lessons' in sql:
            assert args==(VIDEO,) and "publication_state='published'" in sql and 'publish_at<=NOW()' in sql
            return self.title
        if 'INSERT INTO vocab_folders' in sql:
            assert args==(USER,'TED : How to Make Stress Your Friend');return FOLDER
        raise AssertionError(sql)
    async def fetch(self,sql,*args):
        self.calls.append((sql,args));assert 'FROM user_vocabulary' in sql;assert args==(USER,)
        return [{'id':ENTRY,'lexeme_id':LEXEME,'sense_key':'authored-sense'}]
    async def execute(self,sql,*args):self.calls.append((sql,args));return 'UPDATE 1'

def run(folder=None,owned=True):
    con=Connection(owned)
    item={'canonicalLexemeId':str(LEXEME),'term':'stress','definitionEn':'Keep this exact meaning','translationUz':'Keep this translation'}
    original=dict(item)
    result=asyncio.run(batch.add_batch(con,USER,[item],source_type='video',source_id=VIDEO,folder_id=folder))
    assert item==original
    return con,result

def test_default_video_folder_is_server_named_and_unfiled_duplicate_is_repaired():
    con,r=run()
    assert r['ok'] and r['added']==0 and r['ids']==[str(ENTRY)]
    writes=[(sql,args) for sql,args in con.calls if 'UPDATE user_vocabulary' in sql]
    assert len(writes)==1 and writes[0][1]==(USER,str(ENTRY),FOLDER)
    assert 'folder_id IS NULL' in writes[0][0] and 'user_id=$1' in writes[0][0]
    assert not any('UPDATE lexemes' in sql for sql,_ in con.calls)

def test_selected_owned_folder_does_not_create_default_or_move_existing_filed_words():
    con,r=run(FOLDER)
    assert r['ok'];assert not any('INSERT INTO vocab_folders' in sql for sql,_ in con.calls)
    assert all('folder_id IS NULL' in sql for sql,_ in con.calls if 'UPDATE user_vocabulary' in sql)

def test_foreign_folder_is_rejected_before_word_or_folder_writes():
    con,r=run(FOLDER,False)
    assert r=={'ok':False,'error':'folder_not_found'}
    assert not any('INSERT' in sql or 'UPDATE user_vocabulary' in sql for sql,_ in con.calls)

def test_unpublished_video_cannot_reveal_title_through_an_automatic_folder():
    con=Connection(title=None)
    result=asyncio.run(batch.add_batch(con,USER,[{'term':'word','definitionEn':'A meaning'}],source_type='video',source_id=VIDEO))
    assert result=={'ok':False,'error':'source_not_found'}
    assert not any('INSERT' in sql or 'UPDATE user_vocabulary' in sql for sql,_ in con.calls)

def test_video_save_uses_requested_occurrence_and_preserves_authoritative_meaning(monkeypatch):
    occurrence=UUID(int=20)
    class SourceConnection:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        def transaction(self):return self
        async def fetchrow(self,sql,*args):
            return {'id':VIDEO,'title':'Talk','publication_state':'published','transcript':[],
                    'transcript_text':'Exact word','notes':None}
        async def fetch(self,sql,*args):
            assert 'o.id=$2' in sql and args==(VIDEO,occurrence)
            return [{'occurrence_id':occurrence,'id':LEXEME,'segment_key':'v:'+str(LEXEME),
                     'start_char':0,'end_char':10,'surface_form':'Exact word','sentence_text':'The original sentence.',
                     'term':'word','part_of_speech':'noun','definition_en':'The original meaning.',
                     'translation_uz':'Original translation'}]
    class Pool:
        def acquire(self):return SourceConnection()
    add=AsyncMock(return_value={'ok':True,'added':1})
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=Pool()))
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':USER}))
    monkeypatch.setattr(core,'payload',AsyncMock(return_value={'occurrenceId':str(occurrence),'folderId':str(FOLDER)}))
    monkeypatch.setattr(sourced,'add_batch',add)
    req=Request({'type':'http','method':'POST','path':'/','headers':[]})
    response=asyncio.run(sourced.video_vocabulary(req,str(VIDEO)))
    assert response.status_code==200
    _,uid,items=add.call_args.args
    assert uid==USER and items[0]['canonicalLexemeId']==str(LEXEME)
    assert items[0]['definitionEn']=='The original meaning.' and items[0]['translationUz']=='Original translation'
    assert items[0]['sourceSnapshot']['occurrenceId']==str(occurrence)
    assert add.call_args.kwargs['folder_id']==FOLDER
