"""Preserve the newly added main-branch Speaking removal ownership boundary."""
import asyncio
import json
from uuid import UUID
from unittest.mock import AsyncMock

from app import main as core,step21_vocabulary_create as vocabulary

USER,OWN,FOREIGN=[UUID(int=i) for i in range(1,4)]

class Connection:
    def __init__(self,owned):self.owned=owned;self.calls=[]
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    def transaction(self):return self
    async def fetchrow(self,sql,*args):return {'id':USER}
    async def fetch(self,sql,*args):
        self.calls.append((sql,args))
        assert args[0]==USER and 'user_id=$1' in sql
        return [{'id':i} for i in self.owned]

class Pool:
    def __init__(self,con):self.con=con
    def acquire(self):return self.con

def request(monkeypatch,ids,owned,user=True):
    con=Connection(owned);pool=AsyncMock(return_value=Pool(con))
    monkeypatch.setattr(core,'pool',pool)
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':USER} if user else None))
    monkeypatch.setattr(core,'payload',AsyncMock(return_value={'ids':ids}))
    result=asyncio.run(vocabulary.remove_saved_vocabulary(None))
    return result,con,pool

def test_unauthenticated_removal_does_not_borrow_a_connection(monkeypatch):
    result,_,pool=request(monkeypatch,[str(OWN)],[OWN],user=False)
    assert result.status_code==401;pool.assert_not_awaited()

def test_mixed_owned_and_foreign_entries_delete_nothing(monkeypatch):
    result,con,_=request(monkeypatch,[str(OWN),str(FOREIGN)],[OWN])
    assert result.status_code==404
    assert len(con.calls)==1 and 'DELETE' not in con.calls[0][0]

def test_owned_removal_returns_only_confirmed_ids(monkeypatch):
    result,con,_=request(monkeypatch,[str(OWN)],[OWN])
    assert result.status_code==200
    assert json.loads(result.body)=={'ok':True,'deleted':1,'deletedIds':[str(OWN)]}
    assert con.calls[1][1]==(USER,[OWN]) and 'DELETE FROM user_vocabulary' in con.calls[1][0]

def test_duplicate_entry_ids_are_rejected_before_database_use(monkeypatch):
    result,_,pool=request(monkeypatch,[str(OWN),str(OWN)],[OWN])
    assert result.status_code==400;pool.assert_not_awaited()
