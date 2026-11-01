"""Real browser boundary + isolated PostgreSQL; no live database/provider calls."""
import asyncio
import json
import os
import sys
import traceback
import bcrypt
from fastapi.testclient import TestClient
from stdio_postgres import Connection,DatabaseError
from app import main as core
from app.asgi import application

con = Connection()
async def pool(): return con
core.pool = pool
os.environ['AUTH_SECRET'] = 'isolated-browser-test-signing-secret-only'
os.environ['BACKEND_SERVICE_TOKEN'] = 'isolated-private-renderer-test-token-only'
os.environ['APP_ENV'] = 'development'
os.environ['AI_EXTERNAL_ENABLED']='false'
os.environ['STT_PRIMARY_PROVIDER']='none'
UID = '11111111-1111-4111-8111-111111111111'
PASSWORD = 'BrowserTest123!'
digest = bcrypt.hashpw(PASSWORD.encode(),bcrypt.gensalt(rounds=4)).decode()
asyncio.run(con.execute("INSERT INTO users(id,name,email,password_hash,role,account_status,locale) VALUES($1,'Browser learner','browser@example.test',$2,'student','active','uz')",UID,digest))
from browser_fixtures import seed,id
asyncio.run(seed(con,UID,digest))
client = TestClient(application,base_url='http://preview.test')
checks, failures, wire = 0, [], {}
response = client.post('/api/auth/login',json={'email':'browser@example.test','password':PASSWORD},headers={'origin':'http://preview.test'})
assert response.status_code==200,response.text

def check(path, status=200):
    global checks
    try:
        r = client.get(path,follow_redirects=False)
        if r.status_code==500 and path.startswith(('/api/frontend/view','/api/frontend/staff/')):
            from urllib.parse import urlsplit,parse_qs
            from starlette.requests import Request
            from app.browser_reads import read_view
            async def diagnose():
                p=parse_qs(urlsplit(path).query)
                req=Request({'type':'http','path':'/api/frontend/view','method':'GET','scheme':'http','server':('preview.test',80),'headers':[(b'cookie',str(r.request.headers.get('cookie','')).encode())],'query_string':urlsplit(path).query.encode()})
                user=await con.fetchrow('SELECT * FROM users WHERE id=$1',UID)
                if path.startswith('/api/frontend/staff/'):
                    from app.browser_staff import read_staff
                    return await read_staff(req,user,urlsplit(path).path.rsplit('/',1)[1])
                route=urlsplit(p['route'][0])
                return await read_view(req,user,route.path,route.query,p.get('region',[None])[0])
            asyncio.run(diagnose())
        assert r.status_code==status,f'{r.status_code}: {r.text[:300]}'
        checks += 1
        if status==200:
            key=path
            sample=1
            while key in wire:
                key=path+'#sample='+str(sample);sample+=1
            wire[key] = r.json() if 'application/json' in r.headers.get('content-type','') else {'status':r.status_code}
            return r.json() if 'application/json' in r.headers.get('content-type','') else None
    except Exception as e:
        failures.append({'path':path,'error':str(e)[:500]})
        traceback.print_exc(file=sys.stderr)

check('/api/frontend/public')
check('/api/frontend/session')
check('/api/assignments')
for vocab_path in ('/api/vocabulary?limit=50&offset=0','/api/vocabulary/summary','/api/vocabulary/folders','/api/vocabulary/packs','/api/vocabulary/leaderboard','/api/vocabulary/leaderboard?view=standing','/api/vocabulary/sentences?view=words&limit=100&offset=0','/api/vocabulary/sentences?view=history','/api/vocabulary/due?limit=40','/api/vocabulary/games?set=due&limit=1'):
    check(vocab_path)
check('/api/dictionary/recent',409)  # No active dictionary release is seeded in this isolated database.
for game in ('cards','choice','match','gap','race','translation','builder'):
    check('/api/vocabulary/games?set=all&limit=24&random=1&game='+game)
check('/api/vocabulary/due')
check('/api/vocabulary/due?limit=10')
check('/api/frontend/view?route=/app/grammar%3Ftab%3Dwriting')
for path in ('/app/dashboard','/app/progress','/app/mocks','/app/coach','/app/assignments','/app/live-classes','/app/profile','/app/listening/academic','/app/listening/general','/app/listening/mcq','/app/listening/history','/app/reading/academic','/app/reading/general','/app/reading/history','/app/reading/retention','/app/grammar','/app/grammar/lessons','/app/listening/lessons','/app/reading/lessons','/app/courses/ielts','/app/video-lessons','/app/speaking/history','/app/speaking/lessons','/app/speaking/ai','/app/speaking/live-partner'):
    regions = {'/app/dashboard':['dashboard','openLessons','mock'],'/app/progress':['progressSummary','progressStreak','progressTrends','progressMocks'],'/app/mocks':['mock'],'/app/coach':['coach'],'/app/assignments':['assignmentDetails']}.get(path,[None])
    for region in regions:
        check('/api/frontend/view?route='+path+('&region='+region if region else ''))
for tab in ('lessons','exam','grade','translation','topic-vocabulary','language-stealing','activation'):
    from urllib.parse import urlencode
    check('/api/frontend/view?'+urlencode({'route':'/app/writing?tab='+tab}))
for path in ('/app/management','/app/admin/content','/app/admin/materials','/app/owner/audit'):
    check('/api/frontend/view?route='+path,403)
for area in ('listening','grammar','reading'):
    check('/api/frontend/view?route=/app/'+area+'/lessons/author',403)
for route in ('//evil.test','/app/../owner','https://evil.test','/app%2fowner','/app\\owner'):
    check('/api/frontend/view?'+urlencode({'route':route}),400)
check('/_frontend/session',404)
anonymous=TestClient(application,base_url='http://preview.test')
for path in ('/api/frontend/session','/api/frontend/view?route=/app/management','/api/frontend/staff/people'):
    assert anonymous.get(path).status_code==401;checks+=1
assert anonymous.get('/app',follow_redirects=False).status_code==303;checks+=1
first=anonymous.get('/login');second=anonymous.get('/login')
assert first.status_code==200 and first.headers['content-security-policy']!=second.headers['content-security-policy']
assert 'nonce=' in first.text and 'private' in first.headers['cache-control'];checks+=1
pending=TestClient(application,base_url='http://preview.test')
assert pending.post('/api/auth/login',json={'email':'pending@browser.example.test','password':PASSWORD},headers={'origin':'http://preview.test'}).status_code==200
assert pending.get('/api/frontend/view?route=/app/management').status_code==403
assert pending.get('/api/frontend/staff/people').status_code==403
assert pending.get('/api/frontend/view?route=/pending').status_code==200;checks+=3
check('/api/frontend/view?'+urlencode({'route':'/app/reading/general?'+'&'.join('k'+str(i)+'=v' for i in range(81))}),400)
for route in ('/app/listening/lessons/'+id('listening-lesson'),'/app/reading/lessons/'+id('reading-lesson'),'/app/grammar/lessons/'+id('grammar-lesson'),'/app/grammar/'+id('topic'),'/app/video-lessons/'+id('video'),'/app/courses/ielts/lessons/'+id('listening-lesson'),'/app/reading/academic/'+id('reading-set'),'/app/reading/general/'+id('reading-set'),'/app/listening/academic/'+id('listening-academic'),'/app/listening/tests/'+id('listening-academic'),'/app/listening/tests/'+id('listening-academic')+'/2','/app/listening/tests/'+id('listening-academic')+'/study','/app/listening/tests/'+id('listening-academic')+'/mcq','/app/listening/mcq/day/1','/app/listening/general/'+id('listening-general'),'/app/writing/prompts/'+id('writing-prompt'),'/app/writing/submissions/'+id('submission'),'/app/writing/lessons/'+id('writing-lesson')):
    check('/api/frontend/view?'+urlencode({'route':route}))
for route in ('/app/listening/lessons/'+id('reading-lesson'),'/app/reading/lessons/'+id('listening-lesson'),'/app/listening/general/'+id('listening-academic')):
    check('/api/frontend/view?'+urlencode({'route':route}),404)
from browser_workflows import run
workflow_checks=run(client,check,UID,PASSWORD,con)
checks+=workflow_checks
from browser_regressions import run as regressions
checks+=regressions(con,client,check,UID,PASSWORD)
from browser_staff_monitoring import run as staff_monitoring
checks+=staff_monitoring(con,UID,PASSWORD)
class WidgetFailure(Connection):
    async def fetch(self,sql,*args):
        if 'FROM READING_ATTEMPTS' in sql.upper():
            raise DatabaseError('isolated widget failure','08006')
        return await super().fetch(sql,*args)
fault=WidgetFailure()
async def partial_pool():return fault
core.pool=partial_pool
try:
    data=check('/api/frontend/view?route=/app/dashboard&region=dashboard')['data']['dashboard']
    assert data['skillCounts']['reading'] is None and data['skillCounts']['listening']>=1
    assert data['unavailable']['readingAttempts'] is True
    data=check('/api/frontend/view?route=/app/progress&region=progressSummary')['data']['progressSummary']
    assert data['reading'] is None and data['listening']['total']==40
    assert 'progress-reading' in data['unavailableRegions']
    data=check('/api/frontend/view?route=/app/progress&region=progressTrends')['data']['progressTrends']
    assert data['reading'] is None and data['listening'] is not None and data['heatmap'] is None
    checks+=3
finally:core.pool=pool
async def offline_pool():
    import asyncpg
    raise asyncpg.CannotConnectNowError('isolated outage marker')
core.pool=offline_pool
try:
    check('/api/frontend/session',503)
    r=client.get('/app',follow_redirects=False)
    assert r.status_code==503 and 'isolated outage marker' not in r.text
    checks+=1
finally:core.pool=pool
asyncio.run(con.execute("UPDATE users SET role='owner' WHERE id=$1",UID))
check('/api/frontend/session',401)
assert client.post('/api/auth/login',json={'email':'browser@example.test','password':PASSWORD},headers={'origin':'http://preview.test'}).status_code==200
for route in ('/app/management','/app/admin/content','/app/admin/materials','/app/owner/audit','/app/reports'):
    check('/api/frontend/view?route='+route)
for area in ('listening','grammar','reading'):
    check('/api/frontend/view?route=/app/'+area+'/lessons/author')
for kind,params in (
    ('admissions',{}),('people',{}),('roster',{}),('teacher-students',{}),('teacher-homework',{}),('teacher-actions',{}),('support-inbox',{}),('teacher-live-classes',{}),
    ('owner-overview',{}),('owner-integrations',{}),('owner-retention',{}),('owner-transfer',{}),
    ('grammar-topics',{}),('reading-passages',{}),('listening-library',{}),('listening-import',{}),('speaking-manage',{}),('video-admin',{}),
    ('writing-admin',{}),('writing-admin-new',{'kind':'pattern'}),('reading-retention',{'level':'A2'}),('retention-staged',{'level':'A2'}),('centre-statistics',{})):
    check('/api/frontend/staff/'+kind+('?' + urlencode(params) if params else ''))
check('/api/frontend/staff/teacher-students?page=1')
for kind in ('lesson','reading','listening','writing','speaking','grammar','assignment','live_class'):
    check('/api/frontend/staff/materials-kind?type='+kind)
for kind,params in (('grammar-topic',{'id':id('topic')}),('reading-passage',{'id':id('passage1')}),('listening-test',{'id':id('listening-academic')}),('teacher-live-class',{'id':id('live')}),('student-results',{'id':id('other-student')}),('teacher-student',{'id':id('other-student')}),('student-learning',{'id':id('other-student')}),('writing-admin-item',{'kind':'lesson','id':id('writing-lesson')}),('materials-owner',{'type':'listening','id':id('listening-academic')})):
    check('/api/frontend/staff/'+kind+'?'+urlencode(params))
asyncio.run(con.execute("UPDATE users SET role='teacher' WHERE id=$1",UID))
check('/api/frontend/session',401)
assert client.post('/api/auth/login',json={'email':'browser@example.test','password':PASSWORD},headers={'origin':'http://preview.test'}).status_code==200
for kind in ('people','admissions','owner-overview','owner-retention','reading-passages','centre-statistics','writing-admin','retention-staged'):
    check('/api/frontend/staff/'+kind,403)
for route in ('/app/admin/content','/app/owner/audit'):
    check('/api/frontend/view?route='+route,403)
check('/api/frontend/staff/teacher-students')
check('/api/frontend/view?route=/app/management')
for area in ('listening','grammar','reading'):
    check('/api/frontend/view?route=/app/'+area+'/lessons/author')
for route in ('/app','/app/dashboard','/app/management'):
    check(route)
for route in ('/.env','/services/backend/app/main.py','/src/db/schema.ts','/docs/README.md','/node_modules/next/package.json','/frontend/vanilla/index.html','/unknown','/asset-manifest.json'):
    check(route,404)
check('/js/main.js')
check('/campus/v2/src/campus-management.js')
check('/healthz')
check('/readyz')
for path,destination in (('/dashboard','/app/dashboard'),('/listening/history','/app/listening/history'),('/app/vocabulary/review','/app/vocabulary?tab=revision'),('/app/courses','/app/courses/ielts'),('/app/reading','/app/reading/lessons'),('/app/reading?tab=types&q=word','/app/reading/general?q=word')):
    r=client.get(path,follow_redirects=False)
    assert r.status_code==307 and r.headers['location']==destination,(path,r.status_code,r.headers)
    checks+=1
cookies=dict(client.cookies)
assert client.post('/api/auth/logout',headers={'origin':'http://preview.test'}).status_code==200
client.cookies.update(cookies)
check('/api/frontend/session',401)
check('/api/frontend/view?route=/app/management',401)
print(json.dumps({'event':'done','checks':checks,'failures':failures,'wire':wire}),flush=True)
