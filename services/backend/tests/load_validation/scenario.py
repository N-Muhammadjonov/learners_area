"""Paced authenticated learners over real HTTP. Synthetic data and provider only."""
import argparse
import asyncio
from collections import Counter, defaultdict
import json
import os
from pathlib import Path
import re
import time
from uuid import UUID

import asyncpg
import httpx
from safety import guard


def pct(values,p):
    v=sorted(values)
    return round(v[min(len(v)-1,int((len(v)-1)*p))],3) if v else None


def incomplete_regions(value):
    if isinstance(value,dict):
        return bool(value.get('unavailableRegions')) or any(incomplete_regions(x) for x in value.values())
    if isinstance(value,list):return any(incomplete_regions(x) for x in value)
    return False


async def main():
    guard();parser=argparse.ArgumentParser();parser.add_argument('--users',type=int,required=True);parser.add_argument('--seconds',type=float,default=60);parser.add_argument('--warmup',type=float,default=15);parser.add_argument('--ramp',type=float,default=15);parser.add_argument('--think',type=float,default=10);parser.add_argument('--label',required=True);args=parser.parse_args()
    assert 1<=args.users<=1000 and args.seconds>=5 and args.think>=.1
    fixture=json.loads(Path('/results/fixture.json').read_text());users=fixture['users'][:args.users]
    samples=defaultdict(list);statuses=Counter();errors=Counter();ack={};grades=[];reading=[];metrics=[];database=[];failures=[];stop=asyncio.Event()
    con=await asyncpg.connect(os.environ['DATABASE_URL'],server_settings={'application_name':'load-observer'})
    origin={'Origin':'http://web:8000','X-LA-Origin-Verify':os.environ['CLOUDFLARE_ORIGIN_SECRET']}
    limits=httpx.Limits(max_connections=1200,max_keepalive_connections=1100,keepalive_expiry=30)
    async with httpx.AsyncClient(base_url='http://web:8000',headers=origin,limits=limits,timeout=20,follow_redirects=False) as api:
        for _ in range(80):
            try:
                r=await api.get('/readyz')
                if r.status_code==200:break
            except httpx.HTTPError:pass
            await asyncio.sleep(.5)
        else:raise RuntimeError('isolated application not ready')
        async def observe():
            while not stop.is_set():
                try:
                    r=await api.get('/__load_metrics',headers={'X-Load-Secret':os.environ['LOAD_METRICS_SECRET']});r.raise_for_status();metrics.append({'at':time.monotonic(),**r.json()})
                    d=await con.fetchrow("SELECT count(*)::int sessions,count(*) FILTER(WHERE state='active')::int active FROM pg_stat_activity WHERE application_name='learners-load-backend'");database.append(dict(d))
                except (httpx.HTTPError,asyncpg.PostgresError) as e:failures.append('observer:'+type(e).__name__)
                try:await asyncio.wait_for(stop.wait(),.5)
                except TimeoutError:pass
        observer=asyncio.create_task(observe());start=time.monotonic();measure_at=start+args.ramp+args.warmup;end=measure_at+args.seconds
        async def request(user,step,action,phase='steady'):
            n=user['n'];headers={'Cookie':user['cookie'],'CF-Connecting-IP':f'198.18.{n//250}.{n%250+1}'};body=None;method='GET'
            if action<20:kind='dashboard';path='/api/frontend/view?route=/app/dashboard&region=dashboard'
            elif action<35:kind='reading';path='/api/frontend/view?route=/app/reading/academic'
            elif action<50:kind='listening';path='/api/frontend/view?route=/app/listening/academic'
            elif action<68:kind='vocabulary';path='/api/vocabulary?limit=50&offset=0'
            elif action<78:kind='progress';path='/api/frontend/view?route=/app/progress&region=progressSummary'
            elif action<88:
                kind='writing_save';path='/api/writing/submissions/'+user['writing'];method='PATCH';body={'content':f'LAPRIVATE_{n}_v{step} '+'synthetic word '*60}
            elif action<96:kind='presence';path='/api/presence';method='POST';body={}
            elif action==96:kind='media';path='/api/resources/listening/fixture.mp3';headers['Range']='bytes=0-65535'
            elif action<99:
                kind='ai';path='/api/writing/grade';method='POST';body={'taskType':'task2','question':'Discuss the benefits of careful study in education.','essay':f'LAPRIVATE_{n}_v{step} '+'synthetic word '*60,'idempotencyKey':f'load-{args.label}-{n}-{step}'}
            elif not user.get('graded'):
                kind='objective_grade';path='/api/reading/attempts/'+user['reading']+'/submit';method='POST';body={'answers':[{'questionId':q,'answer':'fixture'} for q in fixture['reading_questions']]}
            else:kind='reading';path='/api/frontend/view?route=/app/reading/academic'
            began=time.monotonic();status=0
            try:
                options={'headers':headers,'timeout':3 if phase=='recovery' else 20}
                if body is not None:options['json']=body
                r=await api.request(method,path,**options)
                status=r.status_code
                if status<400:
                    if any(int(x)!=n for x in re.findall(r'LAPRIVATE_(\d+)_',r.text)):failures.append('cross-user-private-essay')
                    if 'application/json' in r.headers.get('content-type','') and incomplete_regions(r.json()):failures.append('partial-unavailable-response:'+kind)
                    if kind=='writing_save':ack[n]=(step,body['content'],user['writing'])
                    if kind=='ai':
                        value=r.json()
                        if value.get('status')!='evaluated':failures.append('AI-not-evaluated')
                        else:grades.append((value['id'],user['id']))
                    if kind=='objective_grade':
                        value=r.json();user['graded']=True;reading.append(user['reading'])
                        if value.get('score')!=14 or value.get('totalQuestions')!=14:failures.append('incorrect-objective-grade')
                    if kind=='media' and (status!=206 or len(r.content)!=65536):failures.append('incorrect-media-range')
                elif phase=='steady' and began>=measure_at:
                    try:reason=r.json().get('reason') or r.json().get('error') or str(status)
                    except ValueError:reason=str(status)
                    errors[kind+':'+str(status)+':'+str(reason)]+=1
            except httpx.HTTPError as e:
                if began>=measure_at:errors[kind+':'+type(e).__name__]+=1
            elapsed=(time.monotonic()-began)*1000
            if phase=='steady' and measure_at<=began<end:samples[kind].append(elapsed);statuses[str(status)]+=1
            return status,elapsed
        async def learner(user,index):
            await asyncio.sleep(args.ramp*index/args.users)
            step=0
            while time.monotonic()<end:
                began=time.monotonic();await request(user,step,(user['n']*37+step*17)%100);step+=1
                period=args.think*(.7+((user['n']*13+step*7)%61)/100)
                await asyncio.sleep(max(0,period-(time.monotonic()-began)))
        try:await asyncio.gather(*(learner(u,i) for i,u in enumerate(users)))
        finally:stop.set();await observer
        # A real simultaneous navigation burst, then normal requests again. These
        # are reported separately from the paced sustainable-traffic error rate.
        burst=await asyncio.gather(*(request(u,10000,0,'burst') for u in users))
        await asyncio.sleep(2)
        recovery=[]
        for n in range(40):recovery.append(await request(users[n%len(users)],20000+n,0 if n%2 else 80,'recovery'))
        # A distinct authenticated actor must not read another learner's draft.
        foreign=await api.get('/api/frontend/view?route=/app/writing/submissions/'+users[-1]['writing'],headers={'Cookie':users[0]['cookie']}) if len(users)>1 else None
        if foreign is not None and foreign.status_code not in (403,404):failures.append('foreign-writing-access')
    lost=[]
    for n,(version,content,ident) in ack.items():
        row=await con.fetchrow('SELECT user_id,content FROM writing_submissions WHERE id=$1',UUID(ident))
        match=re.match(r'LAPRIVATE_(\d+)_v(\d+) ',row['content'] or '') if row else None
        if not row or str(row['user_id'])!=fixture['users'][n-1]['id'] or not match or int(match[1])!=n or int(match[2])<version:lost.append(n)
    incorrect=0
    for ident,owner in grades:
        row=await con.fetchrow("SELECT user_id,overall_estimate FROM evaluations WHERE source_type='writing_grade' AND source_id=$1",UUID(ident))
        if not row or str(row['user_id'])!=owner or float(row['overall_estimate'])!=7:incorrect+=1
    duplicates=await con.fetchval("SELECT count(*) FROM (SELECT user_id,idempotency_key FROM writing_grade_requests GROUP BY 1,2 HAVING count(*)>1) repeated")
    all_samples=[x for v in samples.values() for x in v];total=sum(statuses.values());bad=sum(n for code,n in statuses.items() if code not in ('200','204','206'))
    measured=[m for m in metrics if measure_at<=m['at']<end] or metrics
    memory=[m['rss_bytes'] for m in measured];last_metrics=metrics[-1] if metrics else {}
    per_api={kind:{'requests':len(v),'p50_ms':pct(v,.5),'p95_ms':pct(v,.95)} for kind,v in samples.items()}
    result={'label':args.label,'users':args.users,'steady_seconds':args.seconds,'think_seconds':args.think,'ramp_seconds':args.ramp,'warmup_seconds':args.warmup,'requests':total,'achieved_rps':round(total/args.seconds,3),'p50_ms':pct(all_samples,.5),'p95_ms':pct(all_samples,.95),'statuses':dict(statuses),'error_percent':round(100*bad/max(1,total),3),'errors':dict(errors),'per_api':per_api,'confirmed_draft_owners':len(ack),'lost_confirmed_writes':len(lost),'completed_ai_submissions':len(grades),'incorrect_ai_scores':incorrect,'duplicate_ai_requests':duplicates,'completed_objective_submissions':len(reading),'failures':failures,'pool_wait_p95_ms':last_metrics.get('pool_wait_p95_ms'),'pool_waiters_peak':last_metrics.get('pool_waiters_peak'),'http_inflight_peak':last_metrics.get('http_peak'),'provider_peak':last_metrics.get('provider_peak'),'peak_backend_connections':max((x['sessions'] for x in database),default=0),'peak_active_backend_connections':max((x['active'] for x in database),default=0),'rss_start_bytes':memory[0] if memory else None,'rss_end_bytes':memory[-1] if memory else None,'rss_peak_bytes':max(memory,default=0),'cgroup_memory_peak_bytes':max((x['cgroup_memory_bytes'] for x in metrics),default=0),'cpu_average_cores':round((measured[-1]['cpu_usage_usec']-measured[0]['cpu_usage_usec'])/(1e6*(measured[-1]['at']-measured[0]['at'])),3) if len(measured)>1 else None,'burst_statuses':dict(Counter(str(x[0]) for x in burst)),'burst_p95_ms':pct([x[1] for x in burst],.95),'recovery_statuses':dict(Counter(str(x[0]) for x in recovery)),'recovery_p95_ms':pct([x[1] for x in recovery],.95),'synthetic_only':True,'paid_provider_calls':0,'database_volume':fixture['volume']}
    budget_ok=not args.label.startswith('current-') or ((last_metrics.get('provider_peak') or 0)<=4 and result['peak_backend_connections']<=6)
    result['functional_pass']=not failures and not lost and not incorrect and not duplicates and budget_ok and all(x[0]==200 for x in recovery)
    result['sustainable_pass']=result['functional_pass'] and result['error_percent']<=1 and (result['p95_ms'] or 1e9)<=1000
    Path('/results/'+args.label+'.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
    await con.close()


if __name__=='__main__':asyncio.run(main())
