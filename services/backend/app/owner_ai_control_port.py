"""Owner AI switch GET/POST. No client-defined provider URLs or secrets.

Source: src/app/api/owner/ai-control/route.ts and src/lib/services/coach/owner-control.ts.
Registered compatible providers are deployment-defined; invalid config entries are
not promoted to active providers.
"""
from __future__ import annotations
import os,re,json,ipaddress
from datetime import datetime,timezone
from urllib.parse import urlsplit
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict
router=APIRouter()
CAPS=['text-evaluation','writing-evaluation','speaking-evaluation','grammar-evaluation','vocabulary-evaluation','assignment-evaluation','structured-output']

def registry():
    items=[{'id':'riwi','displayName':os.getenv('AI_DISPLAY_NAME','RIWI'),'type':'internal','model':None,
            'capabilities':CAPS[:-1],'requiredSecrets':[]},
           {'id':'openai','displayName':'OpenAI','type':'external','model':os.getenv('OPENAI_EVALUATION_MODEL') or None,
            'capabilities':CAPS,'requiredSecrets':['OPENAI_API_KEY','OPENAI_EVALUATION_MODEL']},
           {'id':'anthropic','displayName':'Anthropic','type':'external','model':os.getenv('ANTHROPIC_EVALUATION_MODEL') or None,
            'capabilities':CAPS,'requiredSecrets':['ANTHROPIC_API_KEY','ANTHROPIC_EVALUATION_MODEL']}]
    issues=[]
    raw=os.getenv('AI_COMPATIBLE_PROVIDERS','')
    if raw.strip():
        try:
            entries=json.loads(raw)
            if not isinstance(entries,list):raise ValueError('AI_COMPATIBLE_PROVIDERS must be an array')
        except Exception:
            entries=[];issues.append({'index':-1,'reason':'AI_COMPATIBLE_PROVIDERS is not valid JSON'})
        for i,e in enumerate(entries[:10]):
            if (not isinstance(e,dict) or set(e)-{'id','displayName','baseURL','model','secretRef','capabilities'}
                or not isinstance(e.get('id'),str) or not re.fullmatch(r'[a-z][a-z0-9-]{1,31}',e['id'])
                or e['id'] in ('riwi','none') or any(p['id']==e['id'] for p in items)
                or not isinstance(e.get('secretRef'),str) or not re.fullmatch(r'AI_[A-Z0-9_]{2,60}',e['secretRef'])
                or not isinstance(e.get('displayName'),str) or not 1<=len(e['displayName'].strip())<=60
                or not isinstance(e.get('model'),str) or not 1<=len(e['model'].strip())<=120
                or not isinstance(e.get('baseURL'),str)
                or not isinstance(e.get('capabilities',CAPS),list)
                or any(not isinstance(c,str) for c in e.get('capabilities',CAPS))):
                issues.append({'index':i,'reason':'invalid entry (entry)'});continue
            try:u=urlsplit(e['baseURL'])
            except ValueError:
                issues.append({'index':i,'reason':'baseURL refused: invalid_url'});continue
            allowed=os.getenv('AI_COMPATIBLE_ALLOWED_HOSTS','')
            hosts={x.strip().lower() for x in allowed.split(',') if x.strip()}
            host=(u.hostname or '').lower()
            try:literal=ipaddress.ip_address(host) is not None
            except ValueError:literal=bool(re.fullmatch(r'[0-9.]+',host))
            try:port_ok=u.port in (None,443)
            except ValueError:port_ok=False
            if (u.scheme!='https' or not host or u.username or u.password or u.query or u.fragment or not port_ok
                or (hosts and host not in hosts) or literal or '.' not in host
                or host.endswith(('.local','.localhost','.internal','.lan'))):
                issues.append({'index':i,'reason':'baseURL refused: invalid_url'});continue
            items.append({'id':e['id'],'displayName':e['displayName'].strip(),'type':'external','model':e['model'].strip(),
                          'capabilities':[x for x in e.get('capabilities',CAPS) if x in CAPS], 'requiredSecrets':[e['secretRef']],
                          '_endpoint':e['baseURL'].rstrip('/')+'/chat/completions','_secret_ref':e['secretRef']})
    return items,issues

async def control():
    fallback={'externalEnabled':False,'providerId':None,'model':None,'fallback':'none','updatedAt':None,'updatedBy':None,'source':'unavailable'}
    try:
        db=await core.pool()
        async with db.acquire() as conn:
            r=await conn.fetchrow('''SELECT metadata,created_at AS "createdAt",actor_user_id AS "actorUserId"
                FROM audit_log WHERE action='ai.control.set' ORDER BY created_at DESC LIMIT 1''')
        if r is None:return {**fallback,'externalEnabled':True,'fallback':'riwi','source':'default'}
        meta=r['metadata'];at=row_to_dict({'value':r['createdAt']})['value']
        if (not isinstance(meta,dict) or type(meta.get('externalEnabled')) is not bool or
            (meta.get('providerId') is not None and not isinstance(meta.get('providerId'),str)) or
            (meta.get('model') is not None and not isinstance(meta.get('model'),str)) or
            meta.get('fallback','riwi') not in ('riwi','none')):
            return {**fallback,'updatedAt':at,'updatedBy':str(r['actorUserId']) if r['actorUserId'] else None}
        return {'externalEnabled':meta['externalEnabled'],'providerId':meta.get('providerId'),'model':meta.get('model'),
                'fallback':meta.get('fallback','riwi'),'updatedAt':at,
                'updatedBy':str(r['actorUserId']) if r['actorUserId'] else None,'source':'owner'}
    except Exception:return fallback

async def status():
    providers,issues=registry()
    own=await control()
    base=os.getenv('AI_EXTERNAL_ENABLED','true').strip() in ('true','1')
    env_primary=os.getenv('AI_PRIMARY_PROVIDER','riwi').strip().lower() or 'riwi'
    chosen=own['providerId'] if any(x['id']==own['providerId'] for x in providers) else None
    primary=chosen or env_primary
    provider=next((p for p in providers if p['id']==primary),None)
    res=[]
    for p in providers:
        missing=[x for x in p['requiredSecrets'] if not os.getenv(x,'').strip()]
        res.append({'id':p['id'],'displayName':p['displayName'],'type':p['type'],'model':p['model'],
                    'capabilities':p['capabilities'],'secretsPresent':not bool(missing),'missingSecretNames':missing})
    return {'deploymentCeiling':base,'owner':own,
            'effective':{'externalEnabled':bool(base and own['externalEnabled']),
                         'providerId':primary,'providerIsExternal':bool(provider and provider['type']=='external'),
                         'ready':bool(base and own['externalEnabled'] and provider and provider['type']=='external' and
                                      all(os.getenv(x,'').strip() for x in provider['requiredSecrets'])),
                         'model':own['model'] if chosen and own['model'] else provider['model'] if provider else None,
                         'fallback':own['fallback']},'providers':res,'configIssues':issues}

@router.get('/api/owner/ai-control')
async def owner_get(req:Request):
    user=await core.current_user(req,active=True)
    if not user or user['role']!='owner':return core.j({'error':{'code':'forbidden'}},403)
    return core.j(await status(),headers={'Cache-Control':'no-store'})

@router.post('/api/owner/ai-control')
async def owner_post(req:Request):
    user=await core.current_user(req,active=True)
    if not user or user['role']!='owner':return core.j({'error':{'code':'forbidden'}},403)
    b=await core.payload(req)
    if (not isinstance(b,dict) or set(b)-{'externalEnabled','providerId','model','fallback'}
        or not {'externalEnabled','providerId'}<=set(b) or type(b['externalEnabled']) is not bool
        or (b['providerId'] is not None and (not isinstance(b['providerId'],str) or not re.fullmatch(r'[a-z][a-z0-9-]{1,31}',b['providerId'].strip().lower())))
        or (b.get('model') is not None and (not isinstance(b['model'],str) or len(b['model'].strip())>100))
        or b.get('fallback','riwi') not in ('riwi','none')):
        return core.j({'error':{'code':'invalid_input'}},400)
    provider=b['providerId'].strip().lower() if b['providerId'] else None
    providers,_=registry()
    if provider and not any(x['id']==provider for x in providers):return core.j({'error':{'code':'unknown_provider'}},400)
    model=b.get('model','') or ''
    model=model.strip()
    if model and (not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}',model) or not provider or provider=='riwi'):
        return core.j({'error':{'code':'invalid_model'}},400)
    metadata={'externalEnabled':b['externalEnabled'],'providerId':provider,'model':model or None,'fallback':b.get('fallback','riwi')}
    try:
        db=await core.pool()
        async with db.acquire() as conn:
            await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
               VALUES($1,'ai.control.set','ai_control','global',$2::jsonb)''',user['id'],json.dumps(metadata))
    except Exception:return core.j({'error':{'code':'save_failed','retryable':True}},503)
    return core.j(await status(),headers={'Cache-Control':'no-store'})

def install():core.app.include_router(router)
