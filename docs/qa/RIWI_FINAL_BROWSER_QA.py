#!/usr/bin/env python3
"""Fresh private native cluster for remaining R06 HTTP and manual Safari QA.
Previously passed full-suite evidence is preserved, not rerun or relabelled.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repo',required=True,type=Path)
parser.add_argument('--source-manifest',required=True,type=Path)
parser.add_argument('--pg-bin',required=True,type=Path)
parser.add_argument('--listening-source',required=True,type=Path)
parser.add_argument('--speaking-bank-source',required=True,type=Path)
parser.add_argument('--ready-file',required=True,type=Path)
args=parser.parse_args()
work=Path(__file__).resolve().parent
repo=args.repo.resolve(strict=True)
spec=importlib.util.spec_from_file_location('final_pinned',work/'RIWI_FINAL_NATIVE_QA.py')
pinned=importlib.util.module_from_spec(spec);spec.loader.exec_module(pinned)
pinned.INPUTS.update(LISTENING_SOURCE_ZIP=str(args.listening_source.resolve(strict=True)),SPEAKING_BANK_SOURCE=str(args.speaking_bank_source.resolve(strict=True)))
raw=args.source_manifest.read_bytes()
assert hashlib.sha256(raw).hexdigest()==pinned.MANIFEST_SHA
source=json.loads(raw)
pinned.source_check(repo,source)
pg=args.pg_bin.resolve(strict=True)
for name in ['initdb','pg_ctl','postgres']:
    assert (pg/name).is_file() and os.access(pg/name,os.X_OK)
env = {k:os.environ[k] for k in ['PATH','HOME','TMPDIR','USER','LOGNAME','LANG','LC_ALL'] if k in os.environ}
env.update(pinned.INPUTS)
env.update(DYLD_LIBRARY_PATH=str(pg.parent/'lib'), LD_LIBRARY_PATH=str(pg.parent/'lib'))
root = Path(tempfile.mkdtemp(prefix='riwi-final-browser-', dir='/tmp'))
root.chmod(0o700)
data = root/'data'; storage=root/'objects'; storage.mkdir(mode=0o700)
pw=secrets.token_hex(24); pwfile=root/'password'; pwfile.write_text(pw+'\n'); pwfile.chmod(0o600)
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
env.update(PGHOST='127.0.0.1',PGPORT=str(port),PGUSER='postgres',PGPASSWORD=pw,RIWI_QA_DATA_DIR=str(data),STORAGE_LOCAL_DIR=str(storage),STORAGE_PROVIDER='local',QA2_DATABASE_TESTS='1')
private_config=root/'browser-db-private.json'
private_config.write_text(json.dumps({'host':'127.0.0.1','port':port,'user':'postgres','password':pw,'data_dir':str(data)}))
private_config.chmod(0o600)
result={'status':'RUNNING','source_sha256':source['sha256'],'source_files':len(source['files']),'private_root':str(root),'new_private_cluster':True,'production_touched':False,'full_suite_rerun':False,'actual_browser_verified':False,'checks':{},'cluster_stopped':False}
started=False
ready=args.ready_file.resolve()
assert not ready.exists() and not Path(str(ready)+'.done').exists()
print('Private QA logs: '+str(root),flush=True)
def run(name,args,timeout=180):
    pinned.source_check(repo.resolve(),source)
    path=root/(name+'.log')
    print(name,flush=True)
    with path.open('xb') as log:
        try: code=subprocess.run(args,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=timeout).returncode
        except subprocess.TimeoutExpired: code=124;log.write(b'\nQA timeout\n')
    result['checks'][name]={'exit_code':code,'log':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    assert code==0, name+' failed: '+str(path)
    return path
try:
    run('initdb',[str(pg/'initdb'),'-D',str(data),'-U','postgres','--auth=scram-sha-256','--pwfile='+str(pwfile),'-E','UTF8','--locale=C'])
    pwfile.unlink()
    run('start',[str(pg/'pg_ctl'),'-D',str(data),'-l',str(root/'server.log'),'-w','-o',f'-p {port} -k {root} -c listen_addresses=127.0.0.1 -c unix_socket_permissions=0700','start'])
    started=True
    env['RIWI_CREATE_DATABASES']='1'
    run('identity-create',['node','--input-type=module','-e',pinned.IDENTITY_JS]); del env['RIWI_CREATE_DATABASES']
    env['PORTABILITY_DATABASE_URL']=f'postgres://postgres:{pw}@127.0.0.1:{port}/learners_portability'
    run('r06-http',['node','--conditions=react-server','--import','tsx','scripts/qa-riwi-r06-runtime.ts',str(root/'r06-http.json'),str(ready)],timeout=1500)
    http=json.loads((root/'r06-http.json').read_text())
    assert http['passed'] and len(http['http'])==53 and http['appProcessGroupStopped'] and http['privateDatabaseRemoved']
    pinned.source_check(repo.resolve(),source)
    result['status']='HTTP_PASSED_MANUAL_BROWSER_HOLD_RELEASED'
except Exception as exc:
    result['status']='FAILED_OR_INCOMPLETE';result['error']=str(exc)
finally:
    if pwfile.exists():pwfile.unlink()
    if private_config.exists():private_config.unlink()
    if started or (data/'postmaster.pid').exists():
        path=root/'stop.log'
        with path.open('xb') as log:
            code=subprocess.run([str(pg/'pg_ctl'),'-D',str(data),'-w','-t','20','stop','-m','fast'],cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=30).returncode
        result['checks']['stop']={'exit_code':code,'log':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        result['cluster_stopped']=code==0 and not (data/'postmaster.pid').exists()
        if not result['cluster_stopped']:result['status']='FAILED_SHUTDOWN'
    (root/'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'receipt':str(root/'receipt.json'),'cluster_stopped':result['cluster_stopped']}),flush=True)
raise SystemExit(0 if result['status']=='HTTP_PASSED_MANUAL_BROWSER_HOLD_RELEASED' else 1)
