"""Bounded waiting and useful DB work while an external evaluation is suspended."""
import asyncio,json,time,hashlib
from contextlib import asynccontextmanager
from uuid import UUID
from unittest.mock import AsyncMock,Mock
import pytest
from starlette.requests import Request
from app import db,main as core,step23_grade as grade
from datetime import datetime,timedelta,timezone


class OneConnection:
    def __init__(self,connection,slots=1):
        self.semaphore=asyncio.Semaphore(slots);self.connection=connection;self.active=0;self.timeouts=[]

    @asynccontextmanager
    async def acquire(self,*,timeout=None):
        self.timeouts.append(timeout)
        await asyncio.wait_for(self.semaphore.acquire(),timeout)
        self.active+=1
        try:yield self.connection
        finally:self.active-=1;self.semaphore.release()


@pytest.mark.asyncio
async def test_exhausted_pool_waits_are_bounded_and_later_requests_recover():
    raw=OneConnection(object());pool=db.BoundedPool(raw,.05)
    async with pool.acquire():
        start=time.monotonic()
        with pytest.raises(TimeoutError):
            async with pool.acquire(timeout=100):pass
        assert time.monotonic()-start<.5
        assert raw.active==1
    async with pool.acquire():assert raw.active==1
    assert raw.active==0 and raw.timeouts==[.05,.05,.05]


@pytest.mark.asyncio
async def test_cancelled_pool_waiter_cannot_leak_a_connection():
    raw=OneConnection(object());pool=db.BoundedPool(raw,1)
    async def wait():
        async with pool.acquire():pass
    async with pool.acquire():
        waiter=asyncio.create_task(wait());await asyncio.sleep(0)
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):await waiter
    async with pool.acquire():assert raw.active==1
    assert raw.active==0


@pytest.mark.parametrize('value',['nan','inf','0','-1','21','invalid'])
def test_invalid_pool_wait_configuration_fails_closed(monkeypatch,value):
    monkeypatch.setenv('DATABASE_POOL_ACQUIRE_TIMEOUT',value)
    with pytest.raises(OSError):db.pool_settings()


def test_default_pool_budget_is_not_increased(monkeypatch):
    monkeypatch.delenv('DATABASE_POOL_MAX',raising=False);monkeypatch.delenv('DATABASE_POOL_ACQUIRE_TIMEOUT',raising=False)
    assert db.pool_settings()==(5,5)


@pytest.mark.asyncio
async def test_grade_route_releases_pool_before_external_wait_and_keeps_saved_request(monkeypatch):
    uid=UUID(int=101);request_id=UUID(int=102);calls=[]
    class Connection:
        async def fetchrow(self,sql,*args):
            calls.append(sql)
            if 'INSERT INTO writing_grade_requests' in sql:return {'id':request_id}
            if 'UPDATE writing_grade_requests SET claimed_at' in sql:
                return {'task_type':'task2','question_text':'An isolated question','essay_text':'word '*60,'word_count':60}
            if 'FROM evaluations' in sql:return None
            raise AssertionError(sql)
        async def execute(self,sql,*args):calls.append(sql)
    raw=OneConnection(Connection());pool=db.BoundedPool(raw,.05)
    started=asyncio.Event();finish=asyncio.Event()
    async def provider(*args,**kwargs):
        assert kwargs['user_id']==uid
        assert raw.active==0,'provider waited while holding a pool slot'
        started.set();await finish.wait();return None,'unavailable'
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=pool))
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':uid,'locale':'en'}))
    monkeypatch.setattr(core,'payload',AsyncMock(return_value={'taskType':'task2','question':'An isolated writing question','essay':'word '*60,'idempotencyKey':'isolated-retry-key'}))
    monkeypatch.setattr(grade,'evaluation_limit',AsyncMock(return_value=None))
    monkeypatch.setattr(grade.ai,'evaluate',provider)
    request=Request({'type':'http','method':'POST','path':'/api/writing/grade','headers':[]})
    task=asyncio.create_task(grade.new_grade(request))
    try:
        await asyncio.wait_for(started.wait(),1)
        async with pool.acquire() as con:assert con is raw.connection
    finally:finish.set()
    response=await task;body=json.loads(response.body)
    assert response.status_code==200 and body['id']==str(request_id) and body['status']=='failed'
    assert body['error']['code']=='external_required' and raw.active==0
    assert any('last_error=$3,claimed_at=NULL' in sql for sql in calls)


@pytest.mark.asyncio
async def test_storage_checks_do_not_hold_pool_and_finalization_is_conditional(monkeypatch):
    from app import step20_upload_finalize_port as uploads
    uid=UUID(int=201);upload_id=UUID(int=202);queries=[]
    intent={'id':upload_id,'user_id':uid,'status':'pending','expires_at':datetime.now(timezone.utc)+timedelta(minutes=5),
            'object_key':'pending/isolated.pdf','original_name':'isolated.pdf','mime_type':'application/pdf','size':24}
    class Connection:
        async def fetchrow(self,sql,*args):
            queries.append(sql)
            return intent if 'SELECT * FROM upload_intents' in sql else {'id':upload_id}
    raw=OneConnection(Connection());pool=db.BoundedPool(raw,.05)
    async def head(key):
        assert raw.active==0
        async with pool.acquire():pass
        return {'size':24,'contentType':'application/pdf'}
    async def read(*args):assert raw.active==0;return b'%PDF-'+b' '*19
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=pool))
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':uid}))
    monkeypatch.setattr(core,'payload',AsyncMock(return_value={'uploadId':str(upload_id)}))
    monkeypatch.setattr(uploads,'head_object',head);monkeypatch.setattr(uploads,'read_object',read)
    response=await uploads.finalize(Request({'type':'http','method':'POST','path':'/api/uploads/finalize','headers':[]}))
    assert response.status_code==200 and json.loads(response.body)['objectKey']==intent['object_key']
    assert any("status='pending' AND expires_at>NOW()" in query for query in queries)
    assert raw.active==0


@pytest.mark.asyncio
async def test_transient_storage_read_failure_does_not_abort_or_delete_upload(monkeypatch):
    from app import step20_upload_finalize_port as uploads
    uid=UUID(int=211);upload_id=UUID(int=212);queries=[]
    intent={'id':upload_id,'user_id':uid,'status':'pending','expires_at':datetime.now(timezone.utc)+timedelta(minutes=5),
            'object_key':'pending/isolated.pdf','original_name':'isolated.pdf','mime_type':'application/pdf','size':24}
    class Connection:
        async def fetchrow(self,sql,*args):queries.append(sql);return intent
    raw=OneConnection(Connection());pool=db.BoundedPool(raw,.05)
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=pool))
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':uid}))
    monkeypatch.setattr(core,'payload',AsyncMock(return_value={'uploadId':str(upload_id)}))
    monkeypatch.setattr(uploads,'head_object',AsyncMock(return_value={'size':24,'contentType':'application/pdf'}))
    monkeypatch.setattr(uploads,'read_object',AsyncMock(return_value=None))
    delete=AsyncMock();monkeypatch.setattr(uploads,'delete_object',delete)
    response=await uploads.finalize(Request({'type':'http','method':'POST','path':'/api/uploads/finalize','headers':[]}))
    assert response.status_code==503 and len(queries)==1 and raw.active==0
    delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_pooler_compatibility_and_tls_verification_are_preserved(monkeypatch):
    import ssl
    monkeypatch.setenv('DATABASE_URL','postgresql://test:isolated-fixture@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require')
    monkeypatch.delenv('DATABASE_POOL_MAX',raising=False);monkeypatch.delenv('DATABASE_POOL_ACQUIRE_TIMEOUT',raising=False)
    raw=object();create=AsyncMock(return_value=raw)
    monkeypatch.setattr(db.asyncpg,'create_pool',create)
    pool=await db._create_pool();settings=create.call_args.kwargs
    assert pool._raw is raw and pool.acquire_timeout==5
    assert settings['max_size']==5 and settings['timeout']==8 and settings['command_timeout']==20
    assert settings['statement_cache_size']==0 and settings['init'] is db.initialize_connection
    assert settings['ssl'].verify_mode==ssl.CERT_REQUIRED and settings['ssl'].check_hostname
    assert 'sslmode' not in settings['dsn']


def test_listen_uses_session_mode_without_changing_credentials_or_tls():
    import ssl
    from urllib.parse import urlsplit
    from app.access_events import listener_settings
    source='postgresql://test.ref:isolated%3Afixture@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require'
    target,tls=listener_settings(source);parts=urlsplit(target)
    assert parts.port==5432 and parts.username=='test.ref' and parts.password=='isolated%3Afixture'
    assert tls.verify_mode==ssl.CERT_REQUIRED and tls.check_hostname
    direct='postgresql://test:fixture@localhost:5432/test'
    assert listener_settings(direct)==(direct,None)


@pytest.mark.asyncio
async def test_dictionary_worker_wait_does_not_hold_a_pool_slot(monkeypatch):
    from app import step17_dictionary_read_port as dictionary
    queries=[]
    class Connection:
        async def fetchrow(self,query,*args):queries.append(query);return {'directory':{'key':'isolated-index'}}
    raw=OneConnection(Connection());pool=db.BoundedPool(raw,.05)
    async def worker(payload):
        assert raw.active==0
        async with pool.acquire():pass
        return {'release_id':'rel-v1-'+'a'*24,'results':[]}
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=pool))
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':UUID(int=401)}))
    monkeypatch.setattr(dictionary,'pinned',AsyncMock(return_value='rel-v1-'+'a'*24))
    monkeypatch.setattr(dictionary,'counter',AsyncMock(return_value=None))
    monkeypatch.setattr(dictionary,'worker',worker)
    req=Request({'type':'http','method':'GET','path':'/api/dictionary/search','headers':[],'query_string':b'q=word&direction=EN'})
    response=await dictionary.dictionary_search(req)
    assert response.status_code==200 and json.loads(response.body)['results']==[]
    assert len(queries)==1 and raw.active==0


@pytest.mark.asyncio
async def test_import_verifies_storage_outside_pool_and_revalidates_locked_metadata(monkeypatch):
    from app import step39_content_import as imports
    uid=UUID(int=301);upload_id=UUID(int=302);content=b'isolated audio data'
    row={'id':upload_id,'user_id':uid,'status':'finalized','used_at':None,'purpose':'material_primary',
         'mime_type':'audio/mpeg','size':len(content),'object_key':'pending/isolated.mp3','original_name':'isolated.mp3'}
    queries=[]
    class Connection:
        async def fetch(self,query,*args):queries.append(query);return [dict(row)]
    raw=OneConnection(Connection());pool=db.BoundedPool(raw,.05)
    async def read(key):
        assert raw.active==0
        async with pool.acquire():pass
        return content
    monkeypatch.setattr(imports,'read_object',read)
    pkg={'assets':[{'key':'audio.full','required':True,'role':'audio','mimeTypes':['audio/mpeg'],'maxBytes':1024,'sha256':hashlib.sha256(content).hexdigest()}]}
    mapping={'audio.full':str(upload_id)}
    proofs=await imports.verify_assets(pool,pkg,mapping,uid)
    async with pool.acquire() as con:
        resolved,warnings=await imports.claim(con,pkg,mapping,uid,verified_assets=proofs)
    assert len(resolved)==1 and warnings==[]
    assert not queries[0].endswith('FOR UPDATE') and queries[1].endswith('FOR UPDATE')
    row['object_key']='pending/changed.mp3'
    async with pool.acquire() as con:
        with pytest.raises(imports.ImportFailure,match='changed during verification'):
            await imports.claim(con,pkg,mapping,uid,verified_assets=proofs)
    assert raw.active==0


@pytest.mark.asyncio
async def test_dictionary_writer_waiters_leave_four_regular_pool_slots_available():
    from contextlib import AsyncExitStack
    from app.dictionary_gate import dictionary_write_slot,DictionaryBusy
    raw=OneConnection(object(),slots=5);pool=db.BoundedPool(raw,.05)
    async def another_writer():
        async with dictionary_write_slot(timeout=.05),pool.acquire():pass
    async with dictionary_write_slot(),pool.acquire():
        pending=asyncio.create_task(another_writer());await asyncio.sleep(0)
        async with AsyncExitStack() as stack:
            for _ in range(4):await stack.enter_async_context(pool.acquire())
            assert raw.active==5
        with pytest.raises(DictionaryBusy):await pending
        assert raw.active==1
    async with dictionary_write_slot():pass
    assert raw.active==0 and len(raw.timeouts)==5


@pytest.mark.asyncio
async def test_cancelled_dictionary_waiter_releases_the_gate():
    from app.dictionary_gate import dictionary_write_slot
    async def writer():
        async with dictionary_write_slot():pass
    async with dictionary_write_slot():
        pending=asyncio.create_task(writer());await asyncio.sleep(0);pending.cancel()
        with pytest.raises(asyncio.CancelledError):await pending
    async with dictionary_write_slot():pass


@pytest.mark.asyncio
@pytest.mark.parametrize('failure',['writer_busy','pool_busy'])
async def test_unstarted_publish_step_never_marks_the_durable_job_failed(monkeypatch,failure):
    from starlette.background import BackgroundTasks
    from app import step39_dictionary_publish as publish
    from app.dictionary_gate import DictionaryBusy
    @asynccontextmanager
    async def unavailable():
        raise DictionaryBusy('dictionary_busy')
        yield
    @asynccontextmanager
    async def pool_unavailable():
        raise TimeoutError('pool busy')
        yield
    pool=type('Pool',(),{'acquire':Mock(side_effect=pool_unavailable)})()
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=pool))
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':UUID(int=501),'role':'owner'}))
    if failure=='writer_busy':monkeypatch.setattr(publish,'dictionary_write_slot',unavailable)
    response=await publish.dictionary_post(Request({'type':'http','path':'/','method':'POST','headers':[]}),
                                          'publish/'+str(UUID(int=502)),BackgroundTasks())
    assert response.status_code==503
    assert pool.acquire.call_count==(0 if failure=='writer_busy' else 1)


@pytest.mark.asyncio
async def test_real_membership_check_borrows_no_connection_while_calling_telegram(monkeypatch):
    import httpx
    from app import step18_telegram_auth_port as auth,step18_telegram_admission_port as admission,rate_limit
    class Connection:
        async def fetchrow(self,query,*args):
            if 'SELECT payload FROM telegram_flow_drafts' in query:return None
            return {'phone_number':'+000000000','phone_verified_at':datetime.now(timezone.utc)}
    raw=OneConnection(Connection());pool=db.BoundedPool(raw,.05);calls=[]
    async def handler(request):
        assert raw.active==0
        async with pool.acquire():pass
        calls.append(request.url.path)
        return httpx.Response(200,json={'ok':True,'result':{'status':'member'}})
    original=httpx.AsyncClient
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(handler),**kw))
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=pool))
    monkeypatch.setattr(core,'payload',AsyncMock(return_value={'telegramUserId':'12345'}))
    monkeypatch.setattr(rate_limit,'async_counter',AsyncMock(return_value=None))
    monkeypatch.setattr(admission,'list_channels',AsyncMock(return_value=[{'id':'@isolated-channel'}]))
    monkeypatch.setenv('BOT_SERVICE_SECRET','isolated-service-key');monkeypatch.setenv('TELEGRAM_BOT_TOKEN','123:isolated-fixture-token')
    monkeypatch.setenv('TELEGRAM_ACCESS_GATES_ENABLED','true')
    req=Request({'type':'http','method':'POST','path':'/api/internal/telegram/auth/preflight','headers':[(b'authorization',b'Bearer isolated-service-key')]})
    response=await auth.telegram_auth_preflight(req)
    assert response.status_code==200 and len(calls)==1 and raw.active==0


@pytest.mark.asyncio
async def test_exchange_rechecks_consumption_after_unlocked_membership_io(monkeypatch):
    from app import step19_telegram_exchange_port as exchange
    iid=UUID(int=601);consumed=False;queries=[]
    class Connection:
        @asynccontextmanager
        async def transaction(self):yield self
        async def fetchrow(self,query,*args):
            queries.append(query)
            assert 'FROM telegram_login_intents' in query
            return {'id':iid,'status':'consumed' if consumed else 'confirmed','telegram_user_id':'12345',
                    'purpose':'login','user_id':None,'expires_at':datetime.now(timezone.utc)+timedelta(minutes=1)}
    raw=OneConnection(Connection());pool=db.BoundedPool(raw,.05)
    async def gates(*args):
        nonlocal consumed
        assert raw.active==0
        async with pool.acquire():pass
        consumed=True
        return None
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=pool))
    monkeypatch.setattr(core,'payload',AsyncMock(return_value={'intentId':str(iid),'browserNonce':'isolated-browser-nonce'}))
    monkeypatch.setattr(core,'current_authority',AsyncMock(return_value=None))
    token=Mock(side_effect=AssertionError('consumed intent issued a session'));monkeypatch.setattr(core,'issue_token',token)
    monkeypatch.setattr(exchange,'counter',AsyncMock(return_value=None));monkeypatch.setattr(exchange,'gates',gates)
    req=Request({'type':'http','method':'POST','path':'/api/auth/telegram/intent/exchange','headers':[]})
    response=await exchange.intent_exchange(req)
    assert response.status_code==409 and json.loads(response.body)['error']=='already_consumed'
    assert len(queries)==2 and queries[1].rstrip().endswith('FOR UPDATE')
    token.assert_not_called();assert 'set-cookie' not in response.headers and raw.active==0
