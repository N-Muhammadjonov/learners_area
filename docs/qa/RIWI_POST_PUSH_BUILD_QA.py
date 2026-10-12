#!/usr/bin/env python3
"""Compile the exact published source, then exercise a real next-start server.

This owns a new loopback-only PostgreSQL cluster and an exclusive application
copy. It never uses external credentials, existing databases, or Git writes.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile

BASE = next(p for p in Path(__file__).resolve().parents if (p / 'work/continuation-active/repo').is_dir() and (p / 'outputs/RIWI_FINAL_PUBLICATION_bbd0186c/publication-receipt.json').is_file())
ACTIVE = BASE / 'work/continuation-active/repo'
PUBLISHED = BASE / 'work/publication-final-bbd0186c/checkout'
COMMIT = 'df0c2d17187ee7c341e3eaa88521fd9c57c90147'
TREE = '0df555879d9636007cffff37d04a5aceef2e987e'
STATE = 'bbd0186cbd749a0cbf23969ea84b102e874b110aafa01453826a3998a71255bf'
pg = BASE / 'work/native-postgres16/package/native/bin'
spec = importlib.util.spec_from_file_location('pinned', ACTIVE / 'docs/qa/RIWI_FINAL_PUBLICATION_NATIVE_QA.py')
pinned = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pinned)
source = json.loads((ACTIVE / 'docs/qa/RIWI_FINAL_PUBLICATION_SOURCE_STATE.json').read_text())
pinned.source_check(ACTIVE, source)
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=PUBLISHED, text=True).strip() == COMMIT
assert subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=PUBLISHED, text=True).strip() == TREE
assert not subprocess.check_output(['git', 'status', '--porcelain=v1'], cwd=PUBLISHED)
pinned.source_check(PUBLISHED, source)
root = Path(tempfile.mkdtemp(prefix='riwi-post-push-build-', dir='/tmp')).resolve(strict=True)
root.chmod(0o700)
repo = root / 'repo'
repo.mkdir(mode=0o700)
paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=PUBLISHED).decode().split('\0')
for name in filter(None, paths):
    rel = Path(name)
    assert not rel.is_absolute() and '..' not in rel.parts
    origin = PUBLISHED / rel
    assert origin.is_file() and not origin.is_symlink()
    dest = repo / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(origin, dest)
(repo / 'node_modules').symlink_to(ACTIVE / 'node_modules', target_is_directory=True)
pinned.source_check(repo, source)
env = {k: os.environ[k] for k in ['PATH', 'HOME', 'TMPDIR', 'LANG', 'USER', 'LOGNAME'] if k in os.environ}
env.update(DYLD_LIBRARY_PATH=str(pg.parent/'lib'), LD_LIBRARY_PATH=str(pg.parent/'lib'), NEXT_TELEMETRY_DISABLED='1',
           STORAGE_PROVIDER='local', STORAGE_LOCAL_DIR=str(root/'objects'), AUTH_SECRET=secrets.token_hex(32),
           RIWI_ENABLED='true', RIWI_STUDENT_ENABLED='true', RIWI_TEACHER_ENABLED='true', RIWI_ADMIN_ENABLED='true', RIWI_OWNER_ENABLED='true',
           RIWI_PROVIDER_LAB_ENABLED='true', RIWI_EXTERNAL_AI_ENABLED='false', AI_EXTERNAL_ENABLED='false', AI_PRIMARY_PROVIDER='riwi',
           APP_ENV='development', PUBLIC_BASE_URL='http://127.0.0.1:3000', NEXT_PUBLIC_APP_URL='http://127.0.0.1:3000')
(root/'objects').mkdir(mode=0o700)
data = root/'data'
pw = secrets.token_hex(24)
pwfile = root/'password'
pwfile.write_text(pw+'\n'); pwfile.chmod(0o600)
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0)); port = sock.getsockname()[1]
env.update(PGHOST='127.0.0.1', PGPORT=str(port), PGUSER='postgres', PGPASSWORD=pw, RIWI_QA_DATA_DIR=str(data), QA2_DATABASE_TESTS='1')
env['DATABASE_URL'] = f'postgres://postgres:{pw}@127.0.0.1:{port}/learners_qa2'
env['PORTABILITY_DATABASE_URL'] = f'postgres://postgres:{pw}@127.0.0.1:{port}/learners_portability'
result = {'status':'RUNNING', 'commit':COMMIT, 'tree':TREE, 'source_sha256':STATE, 'source_files':1258,
          'private_root':str(root), 'checks':{}, 'isolated_copy':True, 'existing_database_touched':False,
          'production_deployment':False, 'external_provider_verified':False, 'real_r2_verified':False,
          'build_is_local_compilation_not_site_redesign':True, 'full_group_closed':False}
started = False
print('Private build QA logs: '+str(root), flush=True)
def run(name, argv, timeout=180):
    pinned.source_check(repo,source)
    log = root/(name+'.log')
    print(name, flush=True)
    with log.open('xb') as stream:
        try: code = subprocess.run(argv,cwd=repo,env=env,stdout=stream,stderr=subprocess.STDOUT,timeout=timeout).returncode
        except subprocess.TimeoutExpired: code=124; stream.write(b'\nTimeout\n')
    # Fail closed before exporting a log containing private runtime credentials.
    body = log.read_bytes()
    for secret in [pw.encode(), env['AUTH_SECRET'].encode()]:
        if secret in body: raise RuntimeError('Private credential appeared in '+name+'; log stays private')
    result['checks'][name] = {'exit_code':code,'log':str(log),'sha256':hashlib.sha256(body).hexdigest()}
    assert code==0, name+' failed; inspect private log'
    pinned.source_check(repo,source)
    return log
try:
    run('initdb',[str(pg/'initdb'),'-D',str(data),'-U','postgres','--auth=scram-sha-256','--pwfile='+str(pwfile),'-E','UTF8','--locale=C'])
    pwfile.unlink()
    run('start',[str(pg/'pg_ctl'),'-D',str(data),'-l',str(root/'server.log'),'-w','-o',f'-p {port} -k {root} -c listen_addresses=127.0.0.1 -c unix_socket_permissions=0700','start'])
    started=True
    env['RIWI_CREATE_DATABASES']='1'
    run('createdb',['node','--input-type=module','-e',pinned.IDENTITY_JS]); del env['RIWI_CREATE_DATABASES']
    run('migrations',['node','scripts/migrate-chain.mjs'])
    run('production-build',['npm','run','build'], timeout=1200)
    assert (repo/'.next/BUILD_ID').is_file()
    result['build_id_sha256']=hashlib.sha256((repo/'.next/BUILD_ID').read_bytes()).hexdigest()
    # The unchanged canonical harness is derived into a separately hashed QA file.
    # Its only behavior changes are next dev -> next start and NODE_ENV -> production.
    harness = (repo/'scripts/qa-riwi-r06-runtime.ts').read_text()
    harness = harness.replace('"../src/', '"../../src/').replace('"../tests/', '"../../tests/')
    assert harness.count('"dev", "-H"')==1
    assert harness.count('NODE_ENV: "development"')==1
    harness = harness.replace('"dev", "-H"', '"start", "-H"').replace('NODE_ENV: "development"','NODE_ENV: "production"')
    harness = harness.replace('buildRun: false, http,','buildRun: true, serverCommand: "next start", http,')
    target = repo/'docs/qa/RIWI_BUILT_HTTP_RUNTIME.ts'
    target.write_text(harness)
    result['built_http_harness_sha256']=hashlib.sha256(target.read_bytes()).hexdigest()
    run('built-r06-http',['node','--conditions=react-server','--import','tsx',str(target),str(root/'built-r06-http.json')],timeout=600)
    http=json.loads((root/'built-r06-http.json').read_text())
    assert http['passed'] and len(http['http'])==53 and http['appProcessGroupStopped'] and http['privateDatabaseRemoved'] and http['serverCommand']=='next start'
    result['built_http_requests']=len(http['http'])
    run('identity-after',['node','--input-type=module','-e',pinned.IDENTITY_JS])
    result['status']='BUILD_AND_BUILT_HTTP_PASSED_SHUTDOWN_PENDING'
except Exception as exc:
    result['status']='FAILED_OR_INCOMPLETE'; result['error']=str(exc)
finally:
    if pwfile.exists(): pwfile.unlink()
    if started or (data/'postmaster.pid').exists():
        log=root/'stop.log'
        with log.open('xb') as stream:
            code=subprocess.run([str(pg/'pg_ctl'),'-D',str(data),'-w','-t','20','stop','-m','fast'],env=env,cwd=repo,stdout=stream,stderr=subprocess.STDOUT,timeout=30).returncode
        result['checks']['stop']={'exit_code':code,'log':str(log),'sha256':hashlib.sha256(log.read_bytes()).hexdigest()}
        result['cluster_stopped']=code==0 and not (data/'postmaster.pid').exists()
    else: result['cluster_stopped']=not (data/'postmaster.pid').exists()
    result['password_file_removed']=not pwfile.exists()
    if result['status']=='BUILD_AND_BUILT_HTTP_PASSED_SHUTDOWN_PENDING':
        result['status']='LOCAL_PRODUCTION_BUILD_AND_53_BUILT_HTTP_PASSED' if result['cluster_stopped'] else 'FAILED_SHUTDOWN'
    (root/'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'receipt':str(root/'receipt.json'),'cluster_stopped':result['cluster_stopped']}),flush=True)
raise SystemExit(0 if result['status']=='LOCAL_PRODUCTION_BUILD_AND_53_BUILT_HTTP_PASSED' else 1)
