"""Two isolated student accounts; no live users or persistent database writes."""
import asyncio
import copy
import json
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from app import browser, browser_reading, browser_speaking, browser_video, browser_activity
from app import speaking_workflow_port, step21_meaning_access
from app.browser_summary import summary_snapshot, SUMMARY_SQL

A, B = uuid.UUID(int=101), uuid.UUID(int=202)
ATTEMPT = uuid.UUID(int=303)


def snapshot(count):
    return {'reading': {'attempts': count, 'submitted': count, 'score': count*3, 'total': count*4},
        'listening': {'attempts': 0, 'submitted': 0, 'score': 0, 'total': 0},
        'speaking': {'attempts': 0, 'submitted': 0, 'transcribed': 0},
        'writing': {'submissions': 0, 'lastSubmittedAt': None}, 'evaluation': None,
        'vocabulary': [{'state': 'learning', 'n': count, 'due': 1}],
        'lessons': {'total': 10, 'open': 8}, 'lessonState': {'completed': count, 'inProgress': 0},
        'assignments': {'total': 0, 'open': 0, 'completed': 0}, 'mocks': []}


class Connection:
    def __init__(self): self.calls=[]
    async def __aenter__(self): return self
    async def __aexit__(self,*args): pass
    async def fetchval(self, sql, *args):
        self.calls.append((sql,args))
        assert sql == SUMMARY_SQL
        assert args[0] in (A,B)
        return json.dumps(snapshot(2 if args[0]==A else 7))


class Pool:
    def __init__(self,con): self.con=con
    def acquire(self): return self.con


def request(query='',path='/api/frontend/view'):
    return Request({'type':'http','method':'GET','path':path,'query_string':query.encode(),
        'headers':[],'scheme':'https','server':('fixture.invalid',443)})


def test_personal_summary_uses_authenticated_account_and_one_query():
    async def run():
        con=Connection()
        for actor,other,expected in [(A,B,2),(B,A,7)]:
            current={'user':{'id':actor,'role':'student','account_status':'active'}}
            req=request('route=%2Fapp%2Fprogress&region=progressSummary&userId='+str(other))
            with patch.object(browser.core,'current_authority',AsyncMock(return_value=current)),patch.object(browser.core,'pool',AsyncMock(return_value=Pool(con))):
                response=await browser.view(req)
            body=json.loads(response.body)['data']['progressSummary']
            assert body['reading']['attempts']==expected
            assert body['reading']['accuracy']==75
            assert body['vocabulary']['total']==expected
            assert con.calls[-1][1]==(actor,)
            assert response.headers['cache-control']=='private, no-store'
            assert 'answers' not in json.dumps(body)
        assert len(con.calls)==2
    asyncio.run(run())


def test_student_cannot_enter_staff_projection_even_with_forged_role_parameter():
    async def run():
        for actor in (A,B):
            with patch.object(browser.core,'current_authority',AsyncMock(return_value={'user':{'id':actor,'role':'student','account_status':'active'}})):
                with pytest.raises(HTTPException) as error:
                    await browser.staff_view(request('role=owner'), 'people')
                assert error.value.status_code==403
    asyncio.run(run())


def test_peer_reading_attempt_and_retention_text_are_rejected_before_answers_or_notes():
    async def run():
        for actor in (A,B):
            con=AsyncMock()
            con.fetchrow.return_value=None
            with pytest.raises(HTTPException) as error:
                await browser_reading.attempt(con,actor,ATTEMPT)
            assert error.value.status_code==404
            assert con.fetchrow.call_args.args[1:]==(ATTEMPT,actor)
            assert 'user_id=$2' in con.fetchrow.call_args.args[0]
            assert not con.fetch.called
            assert await step21_meaning_access.text_access(con,{'id':actor},'retention',ATTEMPT)=='not_found'
            assert con.fetchrow.call_args.args[1:]==(ATTEMPT,actor)
    asyncio.run(run())


def test_peer_speaking_recording_metadata_is_forbidden_to_another_student():
    async def run():
        for actor,owner in [(A,B),(B,A)]:
            con=AsyncMock();con.fetchrow.return_value={'id':ATTEMPT,'userId':owner,'recordingKey':'private-peer-recording'}
            pool=Pool(con)
            # AsyncMock's context-manager return is explicit for the actual route.
            con.__aenter__.return_value=con
            with patch.object(speaking_workflow_port,'actor',AsyncMock(return_value={'id':actor,'role':'student'})),patch.object(browser.core,'pool',AsyncMock(return_value=pool)):
                response=await speaking_workflow_port.attempt_detail(request(),str(ATTEMPT))
            assert response.status_code==403
            assert 'private-peer-recording' not in response.body.decode()
    asyncio.run(run())


def test_video_notes_use_the_viewers_identity_and_never_a_requested_owner():
    async def run():
        for actor in (A,B):
            con=AsyncMock();con.fetch.return_value=[];con.fetchrow.return_value=None
            video={'id':ATTEMPT,'provider':'youtube','video_id':'fixture'}
            await browser_video.studio(con,{'id':actor},video,request('userId='+str(B)))
            sql,*args=con.fetchrow.call_args.args
            assert 'user_id=$2' in sql
            assert args==[ATTEMPT,actor]
    asyncio.run(run())


def test_speaking_history_bulk_queries_scope_evaluations_and_bound_attempts():
    async def run():
        con=AsyncMock();con.__aenter__.return_value=con
        con.fetch.return_value=[]
        with patch.object(browser.core,'pool',AsyncMock(return_value=Pool(con))):
            result=await browser_speaking.read(request(),{'id':A},'/app/speaking/history',{})
        assert result['attempts']==[]
        sql,*args=con.fetch.call_args.args
        assert 'WHERE user_id=$1' in sql and 'LIMIT 100' in sql
        assert args==[A]
        assert con.fetch.call_count==1
    asyncio.run(run())


def test_nonempty_speaking_history_uses_three_reads_instead_of_one_per_attempt():
    async def run():
        con=AsyncMock();con.__aenter__.return_value=con
        prompt=uuid.UUID(int=404)
        records=[{'id':uuid.UUID(int=500+i),'promptId':prompt,'userId':A} for i in range(20)]
        con.fetch.side_effect=[records,[{'id':prompt,'prompt_text':'Fixture','topic':'Fixture'}],[]]
        with patch.object(browser.core,'pool',AsyncMock(return_value=Pool(con))):
            result=await browser_speaking.read(request(),{'id':A},'/app/speaking/history',{})
        assert len(result['attempts'])==20
        assert all(row['prompt']['topic']=='Fixture' for row in result['attempts'])
        assert con.fetch.call_count==3 and not con.fetchrow.called
        sql,owner,ids=con.fetch.call_args.args
        assert owner==A and len(ids)==20
        assert 'user_id=$1' in sql and 'source_id=ANY($2::uuid[])' in sql
    asyncio.run(run())


def test_speaking_material_blocks_are_batched_only_for_the_authorized_catalogue():
    async def run():
        con=AsyncMock()
        rows=[{'id':uuid.UUID(int=600+i),'title':'Shared fixture','category':'part1',
            'created_by_user_id':B,'author_name':'Fixture teacher'} for i in range(20)]
        blocks=[{'id':uuid.UUID(int=700+i),'material_id':row['id'],'position':0,'object_key':None} for i,row in enumerate(rows)]
        con.fetch.side_effect=[rows,blocks]
        result=await browser_speaking.materials(con,{'id':A,'role':'student'})
        assert con.fetch.call_count==2
        assert len(result)==20 and all(len(row['blocks'])==1 for row in result)
        assert all(not row['canManage'] for row in result)
        sql,ids=con.fetch.call_args.args
        assert 'material_id=ANY($1::uuid[])' in sql
        assert ids==[row['id'] for row in rows]
    asyncio.run(run())


def test_summary_and_dashboard_reduce_database_round_trips_without_shared_private_reads():
    async def run():
        class Counted:
            def __init__(self): self.calls=[]
            async def fetchrow(self,sql,*args):
                self.calls.append((sql,args))
                if 'SELECT count(*)::int FROM reading_attempts' in sql:
                    return {'reading':0,'listening':0,'speaking':0,'writing':0}
                return None
            async def fetchval(self,sql,*args): self.calls.append((sql,args));return 0
            async def fetch(self,sql,*args): self.calls.append((sql,args));return []
        before=Counted();await browser_activity.summary_sequential(before,A)
        assert len(before.calls)==11
        after=Connection();await summary_snapshot(after,A)
        assert len(after.calls)==1
        dashboard=Counted();data=await browser_activity.dashboard(request(),dashboard,A)
        # This legacy double cannot return the JSON snapshot. Its fallback
        # retains eight isolated reads after one bounded snapshot attempt.
        assert len(dashboard.calls)==9
        assert 'jsonb_build_object' in dashboard.calls[0][0]
        assert data['skillCounts']=={'reading':0,'listening':0,'speaking':0,'writing':0}
        for sql,args in dashboard.calls:
            if 'FROM live_classes' not in sql:
                assert args[0]==A
    asyncio.run(run())
