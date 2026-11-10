"""Vercel AI Gateway transport using server-side API-key or deployment OIDC auth.

No credential creation, automatic model selection, retry, credit purchase or
rollout activation occurs here. Existing actor-aware admission remains in force.
"""
import json
import os
import re

URL="https://ai-gateway.vercel.sh/v1/chat/completions"
MODEL_RE=re.compile(r"^[a-z0-9][a-z0-9-]{0,39}/[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")

def credentials(env=None):
    source=os.environ if env is None else env
    for name in ("AI_GATEWAY_API_KEY","VERCEL_OIDC_TOKEN"):
        value=(source.get(name) or "").strip()
        if value:return value,name
    return None,None

def readiness(env=None):
    source=os.environ if env is None else env
    token,kind=credentials(source)
    model=(source.get("AI_GATEWAY_MODEL") or "").strip()
    return {"credentialsConfigured":bool(token),"authentication":kind or "missing",
            "model":model or None,"modelConfigured":bool(MODEL_RE.fullmatch(model)),
            "liveVerified":False,"parameterTrainingPerformed":False}

def missing_configuration(env=None):
    info=readiness(env)
    return ([] if info["credentialsConfigured"] else ["AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN"])+(
        [] if info["modelConfigured"] else ["AI_GATEWAY_MODEL"])

async def completion(actor_id,model,system,data,*,max_tokens=1200):
    from .ai_runtime import request_json
    token,_=credentials()
    if not token:raise ValueError("gateway_credentials_missing")
    if not isinstance(model,str) or not MODEL_RE.fullmatch(model):
        raise ValueError("gateway_model_unconfigured")
    if not isinstance(system,str) or not system.strip() or not isinstance(data,dict):
        raise ValueError("invalid_gateway_payload")
    raw=json.dumps(data,ensure_ascii=False,separators=(",",":"))
    if len(raw)>60000 or type(max_tokens) is not int or not 1<=max_tokens<=2500:
        raise ValueError("gateway_payload_too_large")
    result=await request_json(actor_id,URL,{"content-type":"application/json","authorization":"Bearer "+token},
        payload={"model":model,"messages":[{"role":"system","content":system},{"role":"user","content":raw}],
                 "response_format":{"type":"json_object"},"max_tokens":max_tokens,"temperature":0},timeout=16)
    if not isinstance(result,dict):raise ValueError("gateway_unavailable")
    try:
        choice=result["choices"][0]
        if choice.get("finish_reason")!="stop":raise ValueError()
        text=choice["message"]["content"]
        if not isinstance(text,str) or len(text)>20000:raise ValueError()
        parsed=json.loads(text)
        if not isinstance(parsed,dict):raise ValueError()
        usage=result.get("usage") or {}
        counts={key:(value if type(value) is int and 0<=value<=1000000 else None)
                for key,value in (("inputTokens",usage.get("prompt_tokens")),("outputTokens",usage.get("completion_tokens")))}
        return parsed,counts
    except (ValueError,KeyError,IndexError,TypeError):
        raise ValueError("invalid_gateway_response") from None
