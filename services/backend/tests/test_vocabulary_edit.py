"""An owned Vocabulary edit clones a learner sense, preserving shared content."""
import asyncio
from uuid import UUID
from unittest.mock import AsyncMock
from app import main as core,step21_vocabulary_create as vocabulary

USER,ENTRY,SHARED,PERSONAL=[UUID(int=n) for n in range(1,5)]

class DB:
    def __init__(self,owned=True):self.owned=owned;self.calls=[]
    def acquire(self):return self
    def transaction(self):return self
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    async def fetchrow(self,sql,*args):
        self.calls.append((sql,args))
        if 'FROM users' in sql:return {'id':USER}
        if 'FROM user_vocabulary' in sql:
            assert args==(ENTRY,USER)
            return {'lexeme_id':SHARED,'term':'source','definition_en':'Original definition',
                    'translation_uz':'Asl','example_sentence':'Source example.','part_of_speech':'noun'} if self.owned else None
        if 'INSERT INTO lexemes' in sql:return {'id':PERSONAL}
        raise AssertionError(sql)
    async def execute(self,sql,*args):self.calls.append((sql,args))

def request(monkeypatch,body,*,owned=True,user=True):
    db=DB(owned);pool=AsyncMock(return_value=db)
    monkeypatch.setattr(core,'pool',pool)
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':USER} if user else None))
    monkeypatch.setattr(core,'payload',AsyncMock(return_value=body))
    response=asyncio.run(vocabulary.edit_saved_vocabulary(None,str(ENTRY)))
    return response,db,pool

def test_owned_edit_creates_personal_sense_and_retains_other_fields(monkeypatch):
    response,db,_=request(monkeypatch,{'term':'  edited word  '})
    assert response.status_code==200
    inserted=next(args for sql,args in db.calls if 'INSERT INTO lexemes' in sql)
    assert inserted[:5]==('edited word','noun','Original definition','Asl','Source example.')
    assert inserted[5].startswith('edit:')
    assert db.calls[-1][1]==(ENTRY,USER,PERSONAL,inserted[5])
    assert 'UPDATE user_vocabulary' in db.calls[-1][0] and 'user_id=$2' in db.calls[-1][0]
    assert not any('UPDATE lexemes' in sql for sql,_ in db.calls)

def test_foreign_entry_is_not_edited(monkeypatch):
    response,db,_=request(monkeypatch,{'term':'edited'},owned=False)
    assert response.status_code==404 and not any('INSERT INTO lexemes' in sql for sql,_ in db.calls)

def test_unknown_fields_are_rejected_before_database_use(monkeypatch):
    response,_,pool=request(monkeypatch,{'term':'edited','userId':str(USER)})
    assert response.status_code==400;pool.assert_not_awaited()

def test_unauthenticated_edit_does_not_borrow_a_connection(monkeypatch):
    response,_,pool=request(monkeypatch,{'term':'edited'},user=False)
    assert response.status_code==401;pool.assert_not_awaited()
