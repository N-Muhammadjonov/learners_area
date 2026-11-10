import json
from unittest.mock import AsyncMock,patch
import pytest
from app.riwi_provider_transport import create_riwi_transport
from app.riwi_provider_router import RiwiProviderRouterError


@pytest.mark.asyncio
@pytest.mark.parametrize('provider,model',[('openai','model-a'),('anthropic','model-b'),('gemini','model-c')])
async def test_transport_uses_shared_actor_admission_and_server_contract(provider,model):
    answer={'answer':'Use a plural verb.','uncertainty':None,'citations':[]}
    response={
        'openai':{'status':'completed','output':[{'content':[{'type':'output_text','text':json.dumps(answer)}]}]},
        'anthropic':{'stop_reason':'end_turn','content':[{'type':'text','text':json.dumps(answer)}]},
        'gemini':{'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps(answer)}]}}]},
    }[provider]
    request=AsyncMock(return_value=response)
    with patch.dict('os.environ',{'OPENAI_API_KEY':'fixture','ANTHROPIC_API_KEY':'fixture','GEMINI_API_KEY':'fixture'}),patch('app.riwi_provider_transport.request_json',request):
        result=await create_riwi_transport('actor-id')(provider,model,{'instructions':'server contract','message':'help','language':'en'})
    assert result['answer']==answer
    assert request.await_args.args[0]=='actor-id'
    payload=request.await_args.kwargs['payload']
    assert 'server contract' in json.dumps(payload)
    assert 'actor-id' not in json.dumps(payload)


@pytest.mark.asyncio
async def test_transport_rejects_model_path_injection_before_any_request():
    request=AsyncMock(side_effect=AssertionError('network attempted'))
    with patch('app.riwi_provider_transport.request_json',request),pytest.raises(RiwiProviderRouterError):
        await create_riwi_transport('actor')('gemini','model/../../admin',{'instructions':'server'})
    request.assert_not_awaited()


@pytest.mark.asyncio
async def test_audit_failure_releases_deduplicated_callers_and_allows_retry():
    import asyncio
    from app.riwi_capabilities import RiwiActor
    from app.riwi_provider_router import dispatch_external_riwi_provider,_get_inflight_map
    entered=asyncio.Event();release=asyncio.Event()
    calls=0
    async def transport(*args):
        nonlocal calls
        calls+=1;entered.set();await release.wait()
        return {'answer':{'answer':'Plan a clear argument.','uncertainty':None,'citations':[]}}
    async def audit(*args,**kwargs):
        if kwargs['action']=='riwi.external.succeeded':raise RuntimeError('isolated audit outage')
    options={'conn':None,'actor':RiwiActor(id='11111111-1111-4111-8111-111111111111',role='owner'),
        'provider_id':'openai','task_profile':'general_tutoring','payload':{'language':'en','message':'Help me plan.'},
        'correlation_id':'fixture','transport':transport,
        'env':{'RIWI_ENABLED':'true','RIWI_EXTERNAL_AI_ENABLED':'true','AI_EXTERNAL_ENABLED':'true','OPENAI_API_KEY':'fixture'}}
    first=asyncio.create_task(dispatch_external_riwi_provider(**options,audit_writer=audit))
    await entered.wait()
    second=asyncio.create_task(dispatch_external_riwi_provider(**options,audit_writer=audit))
    await asyncio.sleep(0)
    release.set()
    results=await asyncio.wait_for(asyncio.gather(first,second,return_exceptions=True),1)
    assert isinstance(results[0],RuntimeError) and isinstance(results[1],asyncio.CancelledError)
    assert calls==1 and not _get_inflight_map()
    result=await dispatch_external_riwi_provider(**options)
    assert result['answer']=='Plan a clear argument.' and calls==2
