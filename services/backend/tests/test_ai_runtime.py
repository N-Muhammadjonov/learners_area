"""Synthetic providers only: admission, deduplication, bounded I/O and ownership."""
import asyncio
import json
from contextlib import asynccontextmanager
from uuid import UUID
from unittest.mock import AsyncMock

import httpx
import pytest
from app import ai_runtime as runtime,rate_limit,step31_coach as coach,step23_writing_provider as writing

@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setenv('RATE_LIMIT_BACKEND','memory')
    monkeypatch.delenv('APP_ENV',raising=False);monkeypatch.delenv('RAILWAY_ENVIRONMENT_NAME',raising=False)
    monkeypatch.setattr(rate_limit,'BUCKETS',{})
    monkeypatch.setattr(runtime,'control',runtime.Controller())

def transport(monkeypatch,handler):
    original=httpx.AsyncClient
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(handler),**kw))

@pytest.mark.asyncio
async def test_duplicate_followers_share_one_call_and_cannot_cancel_the_owner(monkeypatch):
    state=runtime.control.state();started=asyncio.Event();finish=asyncio.Event();calls=[]
    async def handler(req):
        calls.append(req);started.set();await finish.wait();return httpx.Response(200,json={'score':7})
    transport(monkeypatch,handler)
    call=lambda:runtime.request_json(UUID(int=1),'https://synthetic.invalid',{},payload={'essay':'private'})
    owner=asyncio.create_task(call());await started.wait()
    cancelled=asyncio.create_task(call());follower=asyncio.create_task(call());await asyncio.sleep(0)
    cancelled.cancel()
    with pytest.raises(asyncio.CancelledError):await cancelled
    assert not owner.done()
    finish.set();a,b=await asyncio.gather(owner,follower)
    a['score']=0
    assert b==await call()=={'score':7} and len(calls)==1 and not state.flights

@pytest.mark.asyncio
async def test_four_global_calls_one_per_user_and_no_admission_queue(monkeypatch):
    state=runtime.control.state();started=asyncio.Event();finish=asyncio.Event();calls=[]
    async def handler(req):
        calls.append(req)
        if len(calls)==4:started.set()
        await finish.wait();return httpx.Response(200,json={'ok':True})
    transport(monkeypatch,handler)
    tasks=[asyncio.create_task(runtime.request_json(UUID(int=n),'https://synthetic.invalid',{},payload={'n':n})) for n in range(1,5)]
    await started.wait()
    assert await runtime.request_json(UUID(int=5),'https://synthetic.invalid',{},payload={'n':5}) is None
    assert await runtime.request_json(UUID(int=1),'https://synthetic.invalid',{},payload={'n':'different'}) is None
    assert len(calls)==4
    finish.set();assert all(await asyncio.gather(*tasks))
    assert await runtime.request_json(UUID(int=5),'https://synthetic.invalid',{},payload={'n':5})=={'ok':True}
    assert len(calls)==5 and not state.flights

@pytest.mark.asyncio
async def test_identical_payloads_of_two_users_do_not_share_results(monkeypatch):
    state=runtime.control.state();calls=[]
    async def handler(req):calls.append(req);return httpx.Response(200,json={'sequence':len(calls)})
    transport(monkeypatch,handler)
    a=await runtime.request_json(UUID(int=1),'https://synthetic.invalid',{},payload={'x':1})
    b=await runtime.request_json(UUID(int=2),'https://synthetic.invalid',{},payload={'x':1})
    assert a=={'sequence':1} and b=={'sequence':2} and len(state.cache)==2

@pytest.mark.asyncio
async def test_missing_actor_fails_closed_without_provider_call(monkeypatch):
    async def handler(req):raise AssertionError('unauthenticated provider call')
    transport(monkeypatch,handler)
    assert await runtime.request_json(None,'https://synthetic.invalid',{},payload={}) is None

@pytest.mark.asyncio
async def test_total_deadline_cancels_a_dripping_response_and_does_not_retry(monkeypatch):
    state=runtime.control.state();calls=[]
    class Slow(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'{'  # A network read timeout alone would restart after each byte.
            await asyncio.sleep(2);yield b'}'
    async def handler(req):calls.append(req);return httpx.Response(200,stream=Slow())
    transport(monkeypatch,handler)
    call=lambda:runtime.request_json(UUID(int=1),'https://synthetic.invalid',{},payload={},timeout=1)
    assert await asyncio.wait_for(call(),1.5) is None
    assert await call() is None and len(calls)==1 and not state.flights
    assert not any(k[0] in ('ai_provider_active','ai_provider_user_active') for k in rate_limit.BUCKETS)

@pytest.mark.asyncio
async def test_oversized_stream_stops_reading_at_the_byte_cap(monkeypatch):
    state=runtime.control.state();chunks=[]
    class Large(httpx.AsyncByteStream):
        async def __aiter__(self):
            for n in range(10):chunks.append(n);yield b'x'*20
    async def handler(req):return httpx.Response(200,stream=Large())
    transport(monkeypatch,handler)
    assert await runtime.request_json(UUID(int=1),'https://synthetic.invalid',{},payload={},max_bytes=32) is None
    assert chunks==[0,1] and not state.flights

@pytest.mark.asyncio
async def test_hour_budget_rejection_does_not_spend_another_provider_call(monkeypatch):
    state=runtime.control.state();calls=[];monkeypatch.setenv('RATE_LIMIT_AI_PROVIDER_USER_HOUR','1')
    async def handler(req):calls.append(req);return httpx.Response(200,json={'ok':True})
    transport(monkeypatch,handler)
    assert await runtime.request_json(UUID(int=1),'https://synthetic.invalid',{},payload={'x':1})
    assert await runtime.request_json(UUID(int=1),'https://synthetic.invalid',{},payload={'x':2}) is None
    assert len(calls)==1 and len(state.cache)==1

@pytest.mark.asyncio
async def test_provider_failure_has_one_attempt_even_with_legacy_retry_override(monkeypatch):
    monkeypatch.setenv('AI_PROVIDER_MAX_ATTEMPTS','5')
    provider={'id':'synthetic','displayName':'Synthetic','type':'external','secretsPresent':True}
    conf={'effective':{'providerId':'synthetic','externalEnabled':True,'model':'test','fallback':'none'},'owner':{},'providers':[provider]}
    monkeypatch.setattr(coach,'status',AsyncMock(return_value=conf));vendor=AsyncMock(return_value=None)
    monkeypatch.setattr(coach,'vendor',vendor)
    assert await coach.resolve('grammar',{},'en',user_id=UUID(int=1))==(None,'evaluation_unavailable')
    vendor.assert_awaited_once()

@pytest.mark.asyncio
async def test_private_cache_has_a_fixed_entry_and_byte_bound():
    state=runtime.control.state()
    for n in range(140):
        async def work():return {'value':'x'*20000}
        await runtime.control.call(str(n),work)
    assert len(state.cache)<=128 and state.cache_bytes<=2*1024*1024

@pytest.mark.asyncio
async def test_existing_evaluation_of_another_owner_is_not_reused(monkeypatch):
    class DB:
        def acquire(self):return self
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
    from app import main as core
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=DB()))
    monkeypatch.setattr(coach,'existing',AsyncMock(return_value={'userId':str(UUID(int=2))}))
    resolve=AsyncMock();monkeypatch.setattr(coach,'resolve',resolve)
    assert await coach.evaluate(UUID(int=1),'writing','writing_submission',UUID(int=3),{})=={'ok':False,'error':'not_found'}
    resolve.assert_not_awaited()

@pytest.mark.asyncio
async def test_operational_connection_is_single_reused_tls_verified_and_closed(monkeypatch):
    import ssl
    state=runtime.control.state()
    con=type('Connection',(),{'is_closed':lambda self:False,'execute':AsyncMock(return_value='OK'),'close':AsyncMock(),'terminate':lambda self:None})()
    connect=AsyncMock(return_value=con);monkeypatch.setattr(runtime.asyncpg,'connect',connect)
    monkeypatch.setenv('DATABASE_URL','postgresql://isolated:synthetic@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require')
    await runtime.control.store('SELECT 1');await runtime.control.store('SELECT 1')
    connect.assert_awaited_once();args=connect.await_args.kwargs
    assert args['ssl'].check_hostname and args['ssl'].verify_mode==ssl.CERT_REQUIRED
    assert args['statement_cache_size']==0 and not state.store_lock.locked()
    await runtime.control.close(state)
    con.close.assert_awaited_once();assert state.store_connection is None

@pytest.mark.parametrize('bad',[['not an issue'],[{'category':'GRAMMAR_TENSE','message':'Review','severity':'low','suggestion':{'tool':'read_database'}}]])
def test_writing_output_rejects_invalid_issue_objects(bad):
    value={'overallEstimate':7,'confidence':.8,'verdict':None,'criteria':[],
           'strengths':[],'weaknesses':[],'issues':bad,'nextActions':[],'recommendedExercises':[]}
    assert not writing.valid_evaluation(value)

@pytest.mark.asyncio
async def test_rejected_raw_provider_cannot_shadow_the_validated_provider(monkeypatch):
    from app import owner_ai_control_port as owner
    valid={'id':'synthetic','displayName':'Synthetic','baseURL':'https://provider.example/v1','model':'test','secretRef':'AI_SYNTHETIC_KEY'}
    rejected={**valid,'baseURL':'https://169.254.169.254/private'}
    monkeypatch.setenv('AI_COMPATIBLE_PROVIDERS',json.dumps([rejected,valid]))
    monkeypatch.setenv('AI_COMPATIBLE_ALLOWED_HOSTS','provider.example')
    monkeypatch.setenv('AI_SYNTHETIC_KEY','isolated-test-only')
    conf={'effective':{'ready':True,'providerIsExternal':True,'providerId':'synthetic','model':'test'}}
    monkeypatch.setattr(writing,'status',AsyncMock(return_value=conf))
    spec=await writing.provider_spec()
    assert spec['url']=='https://provider.example/v1/chat/completions'
    request=AsyncMock(return_value=None);monkeypatch.setattr(coach,'request_json',request)
    await coach.vendor('grammar',{},'en',{'id':'synthetic'},'test',user_id=UUID(int=1))
    assert request.await_args.args[1]==spec['url']
    assert len(owner.registry()[1])==1

@pytest.mark.parametrize('url',['http://provider.example','https://127.1/','https://[::1]/','https://user:pass@provider.example/',
                                'https://provider.example:444/','https://provider.example/?q=private','https://['])
def test_compatible_provider_rejects_unsafe_endpoints(monkeypatch,url):
    from app import owner_ai_control_port as owner
    config={'id':'synthetic','displayName':'Synthetic','baseURL':url,'model':'test','secretRef':'AI_SYNTHETIC_KEY'}
    monkeypatch.setenv('AI_COMPATIBLE_PROVIDERS',json.dumps([config]))
    providers,issues=owner.registry()
    assert all(p['id']!='synthetic' for p in providers) and len(issues)==1

@pytest.mark.asyncio
@pytest.mark.parametrize('status,reason',[(401,'auth_failed'),(429,'rate_limited'),(503,'provider_error')])
async def test_transcription_preserves_failure_reasons_and_private_recording(monkeypatch,status,reason):
    from app import step32_speaking_submit as speaking
    monkeypatch.setenv('STT_PRIMARY_PROVIDER','openai');monkeypatch.setenv('OPENAI_API_KEY','synthetic');monkeypatch.setenv('OPENAI_STT_MODEL','test')
    monkeypatch.setattr(speaking,'head_object',AsyncMock(return_value={'size':5}))
    monkeypatch.setattr(speaking,'read_object',AsyncMock(return_value=b'audio'))
    monkeypatch.setattr(speaking,'request_json',AsyncMock(return_value=(status,None)))
    result=await speaking.transcribe('speaking/private.webm','audio/webm',1000,'en',user_id=UUID(int=1))
    assert result['ok'] is False and result['failure']['reason']==reason
    assert speaking.request_json.await_args.args[0]==UUID(int=1)
