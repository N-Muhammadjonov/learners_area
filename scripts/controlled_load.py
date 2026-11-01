"""Synthetic local Docker load. No production credentials, domains or published ports.

The application, PostgreSQL and client share one internal network. Only this
run's explicitly named containers are cleaned up. Current main is never edited.
"""
import argparse
import io
import json
import os
from pathlib import Path
import secrets
import subprocess
import tarfile
import tempfile
import time

ROOT=Path(__file__).resolve().parents[1]
BASELINE='7e916a02ef7be3192f42bfd054fcf432318fbb47'


def command(args,*,timeout=600,check=True):
    r=subprocess.run(args,capture_output=True,text=True,timeout=timeout,cwd=ROOT)
    if check and r.returncode:raise RuntimeError(r.stderr[-1800:] or r.stdout[-1800:])
    return r


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--image',default='learners-area-load:455e568');p.add_argument('--output',required=True)
    p.add_argument('--levels',nargs='+',type=int,default=[20,200,500,1000]);p.add_argument('--versions',nargs='+',choices=['baseline','current'],default=['baseline','current'])
    p.add_argument('--seconds',type=float,default=60);p.add_argument('--smoke',action='store_true');p.add_argument('--db-latency-ms',type=float,default=5)
    args=p.parse_args();assert args.db_latency_ms>=0 and all(1<=n<=1000 for n in args.levels)
    output=Path(args.output).resolve();output.mkdir(parents=True,exist_ok=True)
    version=command(['git','rev-parse','HEAD']).stdout.strip()
    assert command(['git','diff','--quiet','--','services/backend/app','services/backend/requirements.txt','services/backend/assets'],check=False).returncode==0,'commit runtime changes before measurement'
    image=command(['docker','image','inspect',args.image,'--format','{{.Id}}']).stdout.strip()
    actual=command(['docker','run','--rm','--network','none',args.image,'cat','services/backend/requirements.txt']).stdout
    assert actual==(ROOT/'services/backend/requirements.txt').read_text(),'rebuild image: current dependencies changed'
    runid=secrets.token_hex(4);network='la-load-'+runid;created=[];reports=[]
    command(['docker','network','create','--internal','--label','learners-area-purpose=isolated-load',network])
    try:
        with tempfile.TemporaryDirectory(prefix='learners-load-') as temporary:
            temp=Path(temporary);baseline=temp/'baseline';baseline.mkdir()
            raw=subprocess.check_output(['git','archive',BASELINE,'services/backend/app'],cwd=ROOT)
            with tarfile.open(fileobj=io.BytesIO(raw)) as archive:archive.extractall(baseline,filter='data')
            for level in args.levels:
                pair={}
                for target in args.versions:
                    label=f'{target}-{level}';case=temp/label;case.mkdir();db='la-load-db-'+runid;web='la-load-web-'+runid
                    seed_name='la-load-seed-'+runid;client_name='la-load-client-'+runid
                    password=secrets.token_urlsafe(24);auth=secrets.token_urlsafe(36);origin=secrets.token_urlsafe(36);metrics=secrets.token_urlsafe(24)
                    env=case/'load.env';env.write_text('\n'.join([
                        'LOAD_TEST_ONLY=1','APP_ENV=production','PUBLIC_BASE_URL=http://web:8000',
                        'DATABASE_URL=postgresql://postgres:'+password+'@db:5432/learners_load',
                        'DATABASE_POOL_MAX=5','DATABASE_POOL_ACQUIRE_TIMEOUT=5','RATE_LIMIT_BACKEND=postgres',
                        'AUTH_SECRET='+auth,'CLOUDFLARE_ORIGIN_SECRET='+origin,'LOAD_METRICS_SECRET='+metrics,
                        'LOAD_DB_LATENCY_MS='+str(args.db_latency_ms),'STORAGE_PROVIDER=local','STORAGE_LOCAL_DIR=/tmp/load-media',
                        'AI_EXTERNAL_ENABLED=true','PYTHONPATH=/srv/app/services/backend:/load:/fixtures',
                        'BACKEND_PYTHON=/usr/local/bin/python','PYTHONUNBUFFERED=1'])+'\n');env.chmod(0o600)
                    mounts=['--mount',f'type=bind,src={ROOT}/services/backend/tests/load_validation,dst=/load,readonly',
                            '--mount',f'type=bind,src={ROOT}/services/backend/tests,dst=/fixtures,readonly',
                            '--mount',f'type=bind,src={ROOT}/services/backend/migrations,dst=/migrations,readonly',
                            '--mount',f'type=bind,src={ROOT}/supabase/migrations,dst=/platform-migrations,readonly',
                            '--mount',f'type=bind,src={case},dst=/results']
                    print(json.dumps({'case':label,'state':'seed','synthetic_only':True}),flush=True)
                    try:
                        command(['docker','run','-d','--rm','--name',db,'--network',network,'--network-alias','db','--cpus','1','--memory','1g','--shm-size','256m','--tmpfs','/var/lib/postgresql/data:rw,size=1g,mode=0700','-e','POSTGRES_PASSWORD='+password,'-e','POSTGRES_DB=learners_load','postgres:17.6','-c','max_connections=60','-c','shared_buffers=128MB'])
                        created.append(db)
                        for _ in range(80):
                            if command(['docker','exec',db,'pg_isready','-U','postgres','-d','learners_load'],check=False).returncode==0:break
                            time.sleep(.25)
                        else:raise RuntimeError('isolated PostgreSQL not ready')
                        created.append(seed_name)
                        seeded=command(['docker','run','--rm','--name',seed_name,'--cpus','1','--memory','512m','--network',network,'--env-file',str(env),*mounts,args.image,'python','/load/seed.py'])
                        created.remove(seed_name)
                        (output/(label+'-seed.log')).write_text(seeded.stdout)
                        source=baseline/'services/backend/app' if target=='baseline' else ROOT/'services/backend/app'
                        runtime_mounts=['--mount',f'type=bind,src={source},dst=/srv/app/services/backend/app,readonly',
                            '--mount',f'type=bind,src={ROOT}/services/backend/assets,dst=/srv/app/services/backend/assets,readonly',
                            '--mount',f'type=bind,src={ROOT}/frontend/vanilla/build,dst=/srv/app/frontend/vanilla/build,readonly']
                        command(['docker','run','-d','--rm','--name',web,'--network',network,'--network-alias','web','--cpus','1','--memory','512m','--env-file',str(env),*mounts,*runtime_mounts,args.image,'python','-m','uvicorn','runtime:application','--host','0.0.0.0','--port','8000','--workers','1','--backlog','128','--timeout-keep-alive','5','--timeout-graceful-shutdown','30','--no-access-log','--no-proxy-headers','--no-server-header'])
                        created.append(web)
                        print(json.dumps({'case':label,'state':'HTTP workload','users':level,'version':BASELINE if target=='baseline' else version}),flush=True)
                        duration=5 if args.smoke else args.seconds;ramp=1 if args.smoke else 15;warmup=1 if args.smoke else 15;think=.2 if args.smoke else 2 if level<=20 else 10
                        created.append(client_name)
                        scenario=command(['docker','run','--rm','--name',client_name,'--cpus','2','--memory','1g','--network',network,'--env-file',str(env),*mounts,args.image,'python','/load/scenario.py','--users',str(level),'--seconds',str(duration),'--warmup',str(warmup),'--ramp',str(ramp),'--think',str(think),'--label',label],timeout=int(duration+600))
                        created.remove(client_name)
                        (output/(label+'-client.log')).write_text(scenario.stdout)
                        report=json.loads((case/(label+'.json')).read_text());report.update(source_commit=BASELINE if target=='baseline' else version,image_id=image,resources={'app_cpus':1,'app_memory_bytes':536870912,'postgres_cpus':1,'postgres_memory_bytes':1073741824,'replicas':1,'workers':1,'pool_max':5,'database_max_connections':60},injected_query_delay_ms=args.db_latency_ms,network='Docker internal; no published ports; no outbound provider calls')
                        (output/(label+'.json')).write_text(json.dumps(report,indent=2)+'\n');reports.append(report);pair[target]=report
                        print(json.dumps({'case':label,'state':'done','requests':report['requests'],'p95_ms':report['p95_ms'],'errors_percent':report['error_percent'],'functional_pass':report['functional_pass'],'sustainable_pass':report['sustainable_pass']}),flush=True)
                        if target=='current' and not report['sustainable_pass']:raise RuntimeError('current workload failed acceptance; stop before next concurrency stage')
                    finally:
                        for name in (client_name,seed_name,web,db):
                            if name in created:
                                if name==web:
                                    log=command(['docker','logs',name],check=False);(output/(label+'-server.log')).write_text(log.stdout+log.stderr)
                                command(['docker','stop','--time','30',name],check=False);created.remove(name)
                if 'baseline' in pair and 'current' in pair:
                    comparison={}
                    for kind in ('dashboard','reading','listening','vocabulary','progress','writing_save','presence'):
                        before=pair['baseline']['per_api'].get(kind);after=pair['current']['per_api'].get(kind)
                        if before and after:comparison[kind]={'before_p95_ms':before['p95_ms'],'after_p95_ms':after['p95_ms'],'change_percent':round((after['p95_ms']/before['p95_ms']-1)*100,2),'before_samples':before['requests'],'after_samples':after['requests']}
                    (output/f'comparison-{level}.json').write_text(json.dumps(comparison,indent=2)+'\n')
            (output/'summary.json').write_text(json.dumps({'result':'completed','reports':reports,'baseline':BASELINE,'current':version,'scope':'controlled backend HTTP capacity; local resource caps and simulated query delay, not a production/Cloudflare capacity certification'},indent=2)+'\n')
    finally:
        for name in reversed(created):command(['docker','stop','--time','30',name],check=False)
        command(['docker','network','rm',network],check=False)


if __name__=='__main__':main()
