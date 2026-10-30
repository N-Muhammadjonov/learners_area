"""Controlled admission, cancellation and shutdown; no production traffic/data."""
import asyncio
import gc
import threading
import weakref
from unittest.mock import AsyncMock

import httpx
import pytest
from starlette.responses import JSONResponse

from app.request_lifecycle import RequestBudget, WorkerControl, WorkBusy


async def request(app, path='/api/view', method='GET', receive=None):
    scope = {'type':'http','asgi':{'version':'3.0','spec_version':'2.4'},'http_version':'1.1',
             'path':path,'raw_path':path.encode(),'query_string':b'','method':method,
             'headers':[],'scheme':'http','server':('testserver',80),'client':('127.0.0.1',1)}
    sent=[]
    async def body():return {'type':'http.request','body':b'','more_body':False}
    async def send(message):sent.append(message)
    await app(scope,receive or body,send)
    return sent


async def ok(scope,receive,send):
    await JSONResponse({'ok':True})(scope,receive,send)


def status(messages):return messages[0]['status']


def test_admission_is_immediate_bounded_and_health_has_reserved_capacity():
    async def run():
        control=WorkerControl();release=asyncio.Event();started=asyncio.Event()
        async def slow(scope,receive,send):
            if scope['path']=='/api/view':
                started.set();await release.wait()
            await ok(scope,receive,send)
        app=RequestBudget(slow,controller=control,ordinary=1)
        state=control.state();pending=asyncio.create_task(request(app));await started.wait()
        try:
            rejected=await request(app)
            assert status(rejected)==503
            headers=dict(rejected[0]['headers'])
            assert headers[b'retry-after']==b'1' and b'no-store' in headers[b'cache-control']
            assert state.active==1
            assert status(await request(app,'/healthz'))==200
            assert status(await request(app,'/readyz'))==503
        finally:release.set();await pending
        assert state.active==0
        assert status(await request(app,'/readyz'))==200
    asyncio.run(run())


def test_streams_and_large_work_do_not_consume_every_navigation_slot():
    async def run():
        control=WorkerControl();release=asyncio.Event()
        async def slow(scope,receive,send):
            if scope['path'] in ('/api/auth/changes','/api/uploads'):
                await release.wait()
            await ok(scope,receive,send)
        app=RequestBudget(slow,controller=control,ordinary=2,bulk=1,streams=1)
        state=control.state()
        stream=asyncio.create_task(request(app,'/api/auth/changes'))
        upload=asyncio.create_task(request(app,'/api/uploads','POST'));await asyncio.sleep(0)
        try:
            assert state.active==1 and state.bulk==1 and state.streams==1
            assert status(await request(app,'/api/auth/changes'))==503
            assert status(await request(app,'/api/uploads','POST'))==503
            assert status(await request(app))==200
        finally:release.set();await asyncio.gather(stream,upload)
        assert (state.active,state.bulk,state.streams)==(0,0,0)
    asyncio.run(run())


def test_cancelled_request_releases_admission_without_replaying_work():
    async def run():
        control=WorkerControl();state=control.state();cancelled=[]
        async def slow(scope,receive,send):
            try:await asyncio.Event().wait()
            finally:cancelled.append(True)
        app=RequestBudget(slow,controller=control,ordinary=1)
        pending=asyncio.create_task(request(app));await asyncio.sleep(0)
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):await pending
        assert state.active==0 and cancelled==[True]
        assert status(await request(RequestBudget(ok,controller=control,ordinary=1)))==200
    asyncio.run(run())


def test_slow_view_response_start_times_out_and_recovers():
    async def run():
        control=WorkerControl();state=control.state()
        async def slow(scope,receive,send):await asyncio.Event().wait()
        assert status(await request(RequestBudget(slow,controller=control,read_timeout=.01)))==503
        assert state.active==0
        assert status(await request(RequestBudget(ok,controller=control)))==200
    asyncio.run(run())


def test_started_stream_is_not_cut_at_the_view_deadline():
    async def run():
        async def stream(scope,receive,send):
            await send({'type':'http.response.start','status':200,'headers':[]})
            await asyncio.sleep(.03)
            await send({'type':'http.response.body','body':b'complete'})
        messages=await request(RequestBudget(stream,read_timeout=.01))
        assert status(messages)==200 and messages[-1]['body']==b'complete'
        assert sum(m['type']=='http.response.start' for m in messages)==1
    asyncio.run(run())


def test_slow_upload_body_is_bounded_before_any_mutation():
    async def run():
        writes=[]
        async def slow_body():await asyncio.Event().wait()
        async def mutation(scope,receive,send):
            await receive();writes.append(True);await ok(scope,receive,send)
        result=await request(RequestBudget(mutation,body_timeout=.01),method='POST',receive=slow_body)
        assert status(result)==503 and writes==[]
    asyncio.run(run())


def test_slow_body_limit_is_total_not_reset_by_trickled_chunks():
    async def run():
        chunks=[]
        async def body():
            await asyncio.sleep(.008);chunks.append(1)
            return {'type':'http.request','body':b'x','more_body':True}
        async def mutation(scope,receive,send):
            while (await receive()).get('more_body'):pass
        result=await request(RequestBudget(mutation,body_timeout=.02),method='POST',receive=body)
        assert status(result)==503 and len(chunks)<4
    asyncio.run(run())


def test_mutating_work_is_not_arbitrarily_cancelled_after_body_arrives():
    async def run():
        committed=[]
        async def mutation(scope,receive,send):
            await receive();await asyncio.sleep(.03);committed.append(True);await ok(scope,receive,send)
        result=await request(RequestBudget(mutation,read_timeout=.01,body_timeout=.01),method='POST')
        assert status(result)==200 and committed==[True]
    asyncio.run(run())


def test_auth_callback_preserves_its_own_provider_and_database_timeouts():
    async def run():
        async def callback(scope,receive,send):
            await asyncio.sleep(.03);await ok(scope,receive,send)
        assert status(await request(RequestBudget(callback,read_timeout=.01),'/api/auth/google/callback'))==200
    asyncio.run(run())


def test_saturated_cpu_work_stays_bounded_after_http_waiter_is_cancelled():
    async def run():
        control=WorkerControl();state=control.state();release=threading.Event();started=threading.Event()
        entered=[]
        def block():
            entered.append(threading.get_ident())
            if len(entered)==2:started.set()
            assert release.wait(5)
            return 'complete'
        first=asyncio.create_task(control.run_blocking(block));second=asyncio.create_task(control.run_blocking(block))
        try:
            while not started.is_set():await asyncio.sleep(.005)
            first.cancel()
            with pytest.raises(asyncio.CancelledError):await first
            assert len(state.jobs)==2
            # The event loop remains responsive while both worker threads wait.
            ticks=0
            async def pulse():
                nonlocal ticks
                for _ in range(10):ticks+=1;await asyncio.sleep(.001)
            await pulse()
            with pytest.raises(WorkBusy):await control.run_blocking(lambda:'must not start')
            assert len(entered)==2 and ticks==10 and len(state.jobs)==2
        finally:
            release.set();await second
            if state.jobs:await asyncio.gather(*tuple(state.jobs))
        assert await control.run_blocking(lambda:'recovered')=='recovered'
    asyncio.run(run())


def test_worker_drain_rejects_new_work_and_keeps_liveness():
    async def run():
        control=WorkerControl();state=control.start();await control.drain(state=state)
        app=RequestBudget(ok,controller=control)
        assert status(await request(app))==503
        assert status(await request(app,'/readyz'))==503
        assert status(await request(app,'/healthz'))==200
        with pytest.raises(WorkBusy):await control.run_blocking(lambda:None)
        control.start();assert status(await request(app))==200
    asyncio.run(run())


def test_control_does_not_retain_closed_event_loops_after_contention():
    control=WorkerControl();references=[]
    async def run():
        state=control.start();references.append(weakref.ref(asyncio.get_running_loop()))
        await state.work_slots.acquire();await state.work_slots.acquire()
        waiting=asyncio.create_task(state.work_slots.acquire());await asyncio.sleep(0)
        state.work_slots.release();await waiting
        state.work_slots.release();state.work_slots.release()
    asyncio.run(run());gc.collect()
    assert references[0]() is None and len(control.states)==0


def test_stuck_pool_shutdown_terminates_with_a_bound(monkeypatch):
    from app import db
    class Pool:
        terminated=False
        async def close(self):await asyncio.Event().wait()
        def terminate(self):self.terminated=True
    pool=Pool();monkeypatch.setattr(db,'_pool',pool)
    asyncio.run(db.close_pool(timeout=.01))
    assert pool.terminated and db._pool is None


def test_lifespan_cleanup_runs_even_when_listener_shutdown_fails(monkeypatch):
    from app import main
    from app.access_events import bus
    close=AsyncMock();monkeypatch.setattr(main,'close_pool',close)
    monkeypatch.setattr(bus,'close',AsyncMock(side_effect=OSError('isolated')))
    async def run():
        async with main.lifespan(main.app):pass
    asyncio.run(run());close.assert_awaited_once()


def test_deadline_wraps_real_fastapi_middleware_without_leaking_exception(monkeypatch):
    from fastapi import FastAPI
    from app.main import secure_transport
    app=FastAPI();app.middleware('http')(secure_transport)
    @app.get('/api/view')
    async def view():await asyncio.Event().wait()
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=RequestBudget(app,read_timeout=.01)),base_url='http://testserver') as c:
            response=await c.get('/api/view')
            assert response.status_code==503
            assert response.json()=={'error':'service_unavailable','reason':'request_timeout'}
    asyncio.run(run())


def test_storage_work_has_its_own_bound_and_does_not_starve_crypto():
    async def run():
        control=WorkerControl();state=control.start();release=threading.Event();entered=[]
        def storage():
            entered.append(True);assert release.wait(5);return 'stored'
        pending=[asyncio.create_task(control.run_io(storage)) for _ in range(4)]
        try:
            while len(entered)<4:await asyncio.sleep(.005)
            assert await control.run_blocking(lambda:'password work')=='password work'
            with pytest.raises(WorkBusy):await control.run_io(lambda:'must not start')
            assert len(entered)==4
        finally:release.set();assert await asyncio.gather(*pending)==['stored']*4
        assert not state.jobs
    asyncio.run(run())


def test_storage_client_construction_is_off_loop_and_has_bounded_socket_retries(monkeypatch):
    from app import step19_storage as storage
    import boto3
    main_thread=threading.get_ident();calls=[]
    class Client:
        def head_object(self,**kwargs):return {'ContentLength':12,'ContentType':'audio/mpeg'}
    def client(*args,**kwargs):
        assert threading.get_ident()!=main_thread
        config=kwargs['config']
        assert config.connect_timeout==5 and config.read_timeout==10
        assert config.retries['total_max_attempts']==2
        calls.append(True);return Client()
    monkeypatch.setattr(boto3,'client',client)
    monkeypatch.setenv('STORAGE_PROVIDER','r2')
    for key in ('R2_BUCKET_NAME','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY'):monkeypatch.setenv(key,'isolated')
    assert asyncio.run(storage.head_object('pending/test/audio.mp3'))['size']==12
    assert calls==[True]


def test_storage_overload_is_not_misreported_as_a_missing_file(monkeypatch):
    from app import step19_storage as storage
    monkeypatch.setenv('STORAGE_PROVIDER','local')
    monkeypatch.setattr(storage,'run_io',AsyncMock(side_effect=WorkBusy('busy')))
    with pytest.raises(WorkBusy):asyncio.run(storage.head_object('pending/test/audio.mp3'))


def test_report_render_is_off_loop_and_keeps_both_required_audit_records(monkeypatch):
    from starlette.requests import Request
    from app import main,step37_reports as reports
    thread=threading.get_ident();rendered=[]
    class Connection:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        def acquire(self):return self
    monkeypatch.setattr(main,'current_user',AsyncMock(return_value={'id':'test','role':'student','name':'Isolated'}))
    monkeypatch.setattr(main,'pool',AsyncMock(return_value=Connection()))
    monkeypatch.setattr(reports,'authorize',AsyncMock(return_value={'kind':'student','subjectId':'test'}))
    monkeypatch.setattr(reports,'snapshot',AsyncMock(return_value={'reportId':'isolated','schemaVersion':'test','timezone':'Asia/Tashkent','metrics':[]}))
    audit=AsyncMock();monkeypatch.setattr(reports,'audit',audit)
    def render(*args):
        assert threading.get_ident()!=thread;rendered.append(True);return b'isolated-pdf'
    monkeypatch.setattr(reports,'render',render)
    req=Request({'type':'http','method':'GET','path':'/api/reports','headers':[],
                 'query_string':b'scope=student&period=on_demand&format=pdf'})
    response=asyncio.run(reports.reports(req))
    assert response.status_code==200 and response.body==b'isolated-pdf' and rendered==[True]
    assert [call.args[2] for call in audit.await_args_list]==['report.generated','report.downloaded']


def test_cancelling_pool_shutdown_terminates_and_propagates(monkeypatch):
    from app import db
    class Pool:
        terminated=False
        async def close(self):await asyncio.Event().wait()
        def terminate(self):self.terminated=True
    pool=Pool();monkeypatch.setattr(db,'_pool',pool)
    async def run():
        pending=asyncio.create_task(db.close_pool());await asyncio.sleep(0);pending.cancel()
        with pytest.raises(asyncio.CancelledError):await pending
    asyncio.run(run())
    assert pool.terminated and db._pool is None
