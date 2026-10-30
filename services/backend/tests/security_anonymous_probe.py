"""Anonymous API guard sweep with database access forbidden; no live services."""
import json
import os
import re
from collections import Counter
from fastapi.testclient import TestClient
from app import main as core

os.environ['AUTH_SECRET']='isolated-anonymous-security-probe'
os.environ.pop('BOT_SERVICE_SECRET',None)
os.environ.pop('BACKEND_SERVICE_TOKEN',None)
os.environ['PUBLIC_AUTH_MODE']='telegram-only'
os.environ['DATABASE_URL']='postgresql://unused@127.0.0.1/learners_security_anonymous'
os.environ['RATE_LIMIT_BACKEND']='memory'
reached=[]
async def forbidden_pool():
    reached.append(True)
    raise AssertionError('anonymous route attempted database access')
core.pool=forbidden_pool
# Deliberately public, non-personal metadata/redirect/logout surfaces.
public={'/api/version','/api/auth/logout','/api/auth/telegram/callback',
        '/api/auth/google/start','/api/auth/google/callback'}
counts=Counter();failures=[];successes=[];checks=0
with TestClient(core.app,follow_redirects=False) as client:
    for route in core.app.routes:
        if not getattr(route,'path','').startswith('/api/'):continue
        for method in sorted(getattr(route,'methods',set())-{'OPTIONS'}):
            path=re.sub(r'\{[^}]+\}','11111111-1111-4111-8111-111111111111',route.path)
            before=len(reached)
            response=client.request(method,path,json={})
            counts[response.status_code]+=1;checks+=1
            if response.status_code<400:
                successes.append([method,route.path,response.status_code])
            if len(reached)!=before or response.status_code>=500 or (response.status_code<400 and route.path not in public):
                failures.append([method,route.path,response.status_code,'database_called' if len(reached)!=before else response.text[:120]])
print(json.dumps({'checks':checks,'statuses':dict(counts),'public_successes':successes,'database_attempts':len(reached),
                  'failures':failures,'result':'passed' if not failures else 'failed'}),flush=True)
assert not failures
