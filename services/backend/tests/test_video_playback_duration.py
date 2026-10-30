"""Provider duration is display-only, owned telemetry and cannot decide completion."""
import asyncio
import json
from uuid import UUID
from unittest.mock import AsyncMock
import pytest
from starlette.requests import Request
from app import main as core
from app import video_progress_port as port

USER,VIDEO,PROGRESS=[UUID(int=n) for n in (1,2,3)]

class Connection:
    def __init__(self,authored=None):
        self.authored=authored;self.calls=[]
        self.p={'id':PROGRESS,'state':'not_started','watched_seconds':0,'answers':{},'response_text':None,
                'summary_text':None,'completed_at':None,'playback_duration_seconds':None}
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    async def fetchrow(self,sql,*args):
        self.calls.append((sql,args))
        if 'FROM video_lessons' in sql:
            return {'id':VIDEO,'lesson_id':None,'duration_seconds':self.authored,'publication_state':'published','publish_at':None}
        if 'SELECT id,state' in sql:
            assert args==(USER,str(VIDEO));return self.p.copy()
        if 'SET state=$3' in sql:
            assert args[:2]==(USER,str(VIDEO));self.p.update(state=args[2],completed_at=args[3]);return self.p.copy()
        raise AssertionError(sql)
    async def execute(self,sql,*args):
        self.calls.append((sql,args));assert args[:2]==(USER,str(VIDEO))
        if 'SET playback_duration_seconds' in sql:self.p['playback_duration_seconds']=args[2]
        elif 'SET watched_seconds' in sql:self.p['watched_seconds']=args[2]
        else:raise AssertionError(sql)
        return 'UPDATE 1'
    async def fetch(self,sql,*args):assert 'video_lesson_questions' in sql;return []

def request(monkeypatch,body,authored=None):
    con=Connection(authored)
    class Pool:
        def acquire(self):return con
    pool=AsyncMock(return_value=Pool())
    monkeypatch.setattr(core,'pool',pool)
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':USER}))
    monkeypatch.setattr(core,'payload',AsyncMock(return_value=body))
    req=Request({'type':'http','method':'POST','path':'/','headers':[]})
    response=asyncio.run(port.watched_progress(req,str(VIDEO)))
    return response,json.loads(response.body),con,pool

def test_unknown_duration_is_saved_only_to_own_progress_and_restores_on_read(monkeypatch):
    response,body,con,_=request(monkeypatch,{'watchedSeconds':60,'durationSeconds':868.7})
    assert response.status_code==200 and body['durationSeconds']==869 and body['state']=='in_progress'
    assert con.p['playback_duration_seconds']==869
    assert not any('UPDATE video_lessons' in sql for sql,_ in con.calls)
    req=Request({'type':'http','method':'GET','path':'/','headers':[]})
    assert json.loads(asyncio.run(port.get_progress(req,str(VIDEO))).body)['durationSeconds']==869

def test_client_duration_cannot_mark_unknown_video_completed(monkeypatch):
    response,body,_,_=request(monkeypatch,{'watchedSeconds':60,'durationSeconds':1})
    assert response.status_code==200 and body['state']=='in_progress' and body['completedAt'] is None

def test_authored_duration_wins_and_old_clients_remain_supported(monkeypatch):
    _,body,con,_=request(monkeypatch,{'watchedSeconds':60,'durationSeconds':1},authored=600)
    assert body['durationSeconds']==600 and body['state']=='in_progress'
    assert con.p['playback_duration_seconds'] is None
    _,body,con,_=request(monkeypatch,{'watchedSeconds':60})
    assert body['durationSeconds'] is None and body['watchedSeconds']==60 and body['state']=='in_progress'
    assert con.p['playback_duration_seconds'] is None

@pytest.mark.parametrize('duration',[False,True,0,-1,43201,'600',float('nan'),float('inf')])
def test_invalid_duration_never_reaches_database(monkeypatch,duration):
    response,_,_,pool=request(monkeypatch,{'watchedSeconds':60,'durationSeconds':duration})
    assert response.status_code==400;pool.assert_not_called()
