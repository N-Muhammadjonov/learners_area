"""Wire existing RIWI routing through the site's actor-aware AI admission.
No provider is contacted until rollout, privacy, audit and budget gates allow it.
"""
from __future__ import annotations
import json
import os
from .ai_runtime import request_json
from .riwi_provider_router import PROVIDER_MAP,validate_provider_endpoint,RiwiProviderRouterError,valid_provider_model


def create_riwi_transport(actor_id):
    async def transport(provider_id,model,payload):
        spec=PROVIDER_MAP.get(provider_id)
        if spec is None or spec.type!='external' or not valid_provider_model(provider_id,model):
            raise RiwiProviderRouterError('invalid_provider')
        if provider_id=='vercel':
            from .riwi_ai_gateway import completion,URL
            system=payload.get('instructions')
            if not isinstance(system,str) or not system:
                raise RiwiProviderRouterError('missing_server_contract')
            validate_provider_endpoint(provider_id,URL)
            try:
                answer,usage=await completion(actor_id,model,system,
                    {k:v for k,v in payload.items() if k!='instructions'},max_tokens=900)
            except ValueError as exc:
                raise RiwiProviderRouterError(str(exc)) from None
            return {'answer':answer,'usage':usage}
        key=os.getenv(spec.required_secrets[0])
        if not key:raise RiwiProviderRouterError('credentials_missing')
        system=payload.get('instructions')
        if not isinstance(system,str) or not system:
            raise RiwiProviderRouterError('missing_server_contract')
        data={k:v for k,v in payload.items() if k!='instructions'}
        raw=json.dumps(data,ensure_ascii=False,separators=(',',':'))
        if len(raw)>30000:raise RiwiProviderRouterError('payload_too_large')
        if provider_id=='openai':
            url='https://api.openai.com/v1/responses'
            headers={'Authorization':'Bearer '+key}
            body={'model':model,'store':False,'instructions':system,'input':raw,
                  'text':{'format':{'type':'json_object'}},'max_output_tokens':900}
        elif provider_id=='anthropic':
            url='https://api.anthropic.com/v1/messages'
            headers={'x-api-key':key,'anthropic-version':'2023-06-01'}
            body={'model':model,'system':system,'messages':[{'role':'user','content':raw}],'max_tokens':900}
        elif provider_id=='gemini':
            url=f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
            headers={'x-goog-api-key':key}
            body={'systemInstruction':{'parts':[{'text':system}]},
                  'contents':[{'role':'user','parts':[{'text':raw}]}],
                  'generationConfig':{'maxOutputTokens':900,'responseMimeType':'application/json'}}
        else:raise RiwiProviderRouterError('invalid_provider')
        validate_provider_endpoint(provider_id,url)
        result=await request_json(actor_id,url,{'content-type':'application/json',**headers},payload=body,timeout=16)
        if not isinstance(result,dict):raise RiwiProviderRouterError('provider_unavailable')
        try:
            if provider_id=='openai':
                if result.get('status')!='completed':raise ValueError()
                text=''.join(c['text'] for item in result['output'] for c in item.get('content',[]) if c.get('type')=='output_text')
                usage=result.get('usage',{});counts={'inputTokens':usage.get('input_tokens'),'outputTokens':usage.get('output_tokens')}
            elif provider_id=='anthropic':
                if result.get('stop_reason')!='end_turn':raise ValueError()
                text=''.join(c['text'] for c in result['content'] if c.get('type')=='text')
                usage=result.get('usage',{});counts={'inputTokens':usage.get('input_tokens'),'outputTokens':usage.get('output_tokens')}
            else:
                candidate=result['candidates'][0]
                if candidate.get('finishReason')!='STOP':raise ValueError()
                text=''.join(p['text'] for p in candidate['content']['parts'] if 'text' in p)
                usage=result.get('usageMetadata',{});counts={'inputTokens':usage.get('promptTokenCount'),'outputTokens':usage.get('candidatesTokenCount')}
            if len(text)>20000:raise ValueError()
            return {'answer':json.loads(text),'usage':counts}
        except (ValueError,KeyError,TypeError,IndexError) as exc:
            raise RiwiProviderRouterError('invalid_response') from exc
    return transport
