"""Regression coverage for production catalogue ordering, completion and image access."""
import asyncio
from uuid import UUID
from unittest.mock import AsyncMock, patch
from starlette.requests import Request
from app import browser_reading, browser_listening, step20_media_port as media


def test_general_reading_shuffle_mixes_passages_independently_and_prioritizes_progress():
    rows = [dict(id=f'{n}-{slot}', test_no=n, passage_no=slot, external_id=f't{n:02}-p{slot}', title=f'Title {n}/{slot}')
            for n in range(1,34) for slot in (1,2,3)]
    tail = [dict(id=str(n), test_no=None, passage_no=slot, external_id=f'learnersarea-reading-{n}-title')
            for n, slot in zip(range(100,106), (2,3,1,3,1,3))]
    original = rows + tail
    ordered = browser_reading.general_library_order(original)
    assert ordered == browser_reading.general_library_order(original)
    assert sorted(r['id'] for r in ordered) == sorted(r['id'] for r in original)
    assert [r['test_no'] for r in ordered[:99:3]] != list(range(1,34))
    for i in range(0,102,3):
        assert [r['passage_no'] for r in ordered[i:i+3]] == [1,2,3]
    assert any(len({r['test_no'] for r in ordered[i:i+3]})>1 for i in range(0,99,3))
    for n in (1,2,3):
        unfinished=next(r for r in original if r['passage_no']==n and r['test_no']==33)
        unfinished['status']='in_progress'
    priority=browser_reading.general_library_order(original)
    assert [r['status'] for r in priority[:3]]==['in_progress']*3
    assert [r['passage_no'] for r in priority[:3]]==[1,2,3]
    subset = [r for r in original if r['passage_no'] == 2]
    assert browser_reading.general_library_order(subset) == [r for r in priority if r['passage_no'] == 2]


def test_writing_resource_tombstone_parameter_is_text_and_guards_still_apply():
    owner = UUID(int=42)
    class Con:
        async def fetchrow(self, sql, *args):
            assert args == (owner,)
            return {'id':owner, 'publication_state':'published'}
        async def fetchval(self, sql, *args):
            assert '$1::text' in sql
            assert args == (str(owner),)  # asyncpg's text codec rejects UUID objects.
            return False
    assert asyncio.run(media.owner_access(Con(), {'role':'student'}, 'writing', owner)) == 'allowed'
    class Deleted(Con):
        async def fetchval(self, *args):return True
    assert asyncio.run(media.owner_access(Deleted(), {'role':'student'}, 'writing', owner)) is None
    class Draft(Con):
        async def fetchrow(self, *args):return {'publication_state':'draft'}
    assert asyncio.run(media.owner_access(Draft(), {'role':'student'}, 'writing', owner)) == 'forbidden'


def test_listening_visit_or_completed_exam_cannot_complete_unfinished_course():
    test_id = UUID(int=12)
    row = {'id':test_id, 'title':'Listening Test 12', 'source_id':'custom', 'source_ref':None,
           'program_ref':None, 'payload':{'sections':[{}]*4, 'questions':[{}]*40}}
    class Con:
        async def fetch(self, sql, *args):
            if 'answered_count' in sql:
                return [{'test_id':test_id, 'status':'completed', 'total_questions':40, 'answered_count':0}]
            return [row] if 'FROM listening_tests t' in sql else []
        async def fetchrow(self, *args):return {'score':0,'total_questions':40}
        async def fetchval(self, sql, *args):return 1
    async def run(done):
        activities=[{'complete':i<done} for i in range(3)]
        with patch.object(browser_listening,'facts',AsyncMock(return_value=(activities,{'score':0,'total_questions':40}))), patch.object(browser_listening,'sequence',AsyncMock(return_value=True)):
            return await browser_listening.catalogue(Con(),{'id':UUID(int=1),'role':'student'},'academic_full_test',{})
    for done in (0,1,2):
        card=asyncio.run(run(done))['cards'][0]
        assert card['answerProgress']['state']=='in_progress'
        assert card['answerProgress']['answeredCount']==0
    assert asyncio.run(run(3))['cards'][0]['answerProgress']['state']=='completed'


def test_original_writing_graph_get_and_head_keep_private_authorization():
    import hashlib
    owner=UUID(int=42)
    # Storage fixture is independent of retired bundled exam images.
    key='writing/source-materials/fixture/graph.png'
    graph=b'\x89PNG\r\n\x1a\nprivate fixture graph bytes'
    class Con:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def fetchrow(self, sql, *args):
            if 'FROM resource_blocks' in sql:return {'owner_type':'writing','owner_id':owner}
            if 'FROM writing_prompts' in sql:return {'id':owner,'publication_state':'published'}
            return None
        async def fetchval(self, sql, *args):
            assert isinstance(args[0],str)
            return False
    class Pool:
        def acquire(self):return Con()
    req=Request({'type':'http','method':'GET','path':'/api/resources/'+key,'query_string':b'','headers':[], 'scheme':'https','server':('learnersarea.uz',443)})
    authority={'user':{'id':UUID(int=1),'role':'student','account_status':'active'}}
    with patch.object(media.core,'current_authority',AsyncMock(return_value=authority)), patch.object(media.core,'pool',AsyncMock(return_value=Pool())), patch.object(media,'graph_bytes',return_value=graph), patch.dict(media.GRAPHS,{key:{'sha256':hashlib.sha256(graph).hexdigest(),'originalName':'graph.png'}}):
        response=asyncio.run(media.deliver(req,key,False))
        assert response.status_code==200
        assert response.body==graph and response.body.startswith(b'\x89PNG')
        assert response.headers['content-type']=='image/png'
        assert response.headers['cache-control']=='private, no-store'
        head=asyncio.run(media.deliver(req,key,True))
        assert head.status_code==200 and head.body==b''
        assert head.headers['content-length']==str(len(graph))
    with patch.object(media.core,'current_authority',AsyncMock(return_value=None)):
        assert asyncio.run(media.deliver(req,key,False)).status_code==401
