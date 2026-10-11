#!/usr/bin/env python3
"""Disposable native low-level physical-backup/PITR rehearsal. Not provider acceptance.

Creates two NEW loopback clusters under one random private temporary directory.
No existing directory/database is deleted. Every failed invariant exits nonzero;
both clusters and the development application are stopped in finally.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
import urllib.error
import signal


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, type=Path)
    parser.add_argument('--pg-bin', required=True, type=Path)
    parser.add_argument('--source-manifest', required=True, type=Path)
    args = parser.parse_args()
    repo, pg = args.repo.resolve(), args.pg_bin.resolve()
    manifest = json.loads(args.source_manifest.read_text())
    canonical = [{'path':row['path'],'sha256':row['sha256']} for row in manifest['files']]
    assert hashlib.sha256(json.dumps(canonical,separators=(',',':')).encode()).hexdigest() == manifest['sha256'], 'invalid source manifest'
    def source_check():
        for row in manifest['files']:
            path = repo / row['path']
            assert path.resolve().is_relative_to(repo), 'source path escaped repository'
            assert hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256'], 'source changed: '+row['path']
    source_check()
    assert (repo/'node_modules/next/dist/bin/next').is_file()
    for name in ['initdb', 'pg_ctl', 'postgres']:
        assert (pg/name).is_file(), 'trusted PostgreSQL binary missing: '+name
    root = Path(tempfile.mkdtemp(prefix='riwi-r07-pitr-', dir='/tmp')).resolve()
    root.chmod(0o700)
    print('Private PITR logs: '+str(root),flush=True)
    assert re.fullmatch(r'riwi-r07-pitr-[A-Za-z0-9_]+', root.name)
    data, restored, wal = root/'source', root/'restored', root/'wal'
    wal.mkdir(mode=0o700)
    password = secrets.token_hex(24)
    owner_password = 'Qa-'+secrets.token_hex(18)
    canary_title = 'R07_RESTORED_'+secrets.token_hex(8)
    environment = {k:os.environ[k] for k in ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'LANG', 'LC_ALL'] if k in os.environ}
    environment.update(PGUSER='postgres', PGPASSWORD=password, PGHOST='127.0.0.1',
                       DYLD_LIBRARY_PATH=str(pg.parent/'lib'), LD_LIBRARY_PATH=str(pg.parent/'lib'),
                       NEXT_TELEMETRY_DISABLED='1')
    support = [Path(__file__).resolve(), Path(__file__).with_name('RIWI_R07_NATIVE_SQL.mjs'), Path(__file__).with_name('RIWI_R07_NATIVE_BASE_BACKUP.mjs'), Path(__file__).with_name('RIWI_R07_ARCHIVE_WAL.py')]
    tool_hashes = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in support}
    receipt = {'kind':'LOCAL_NATIVE_PITR_REHEARSAL', 'status':'RUNNING', 'source_sha256':manifest['sha256'], 'qa_tool_sha256':tool_hashes,
               'provider_verified':False, 'production_touched':False, 'contractual_rpo_rto_selected':False,
               'private_root':str(root), 'checks':{}, 'cleanup':{}}
    app = None
    def free_port():
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            return sock.getsockname()[1]
    src_port, dst_port = free_port(), free_port()
    while dst_port == src_port:
        dst_port = free_port()
    def run(name, command, env=None, timeout=120):
        path = root/(name+'.log')
        with path.open('xb') as log:
            result = subprocess.run(command, cwd=repo, env=env or environment, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
        receipt['checks'][name] = {'exit_code':result.returncode, 'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        assert result.returncode == 0, name+' failed; inspect '+str(path)
        print(name+' passed',flush=True)
    def query(port, sql, database='learners_qa2'):
        expected_data = data if port == src_port else restored if port == dst_port else None
        assert expected_data is not None, 'unknown owned cluster port'
        node_env = dict(environment, PGPORT=str(port), PGDATABASE=database)
        request = json.dumps({'sql':sql,'expectedDataDir':str(expected_data)})
        result = subprocess.run(['node',str(Path(__file__).with_name('RIWI_R07_NATIVE_SQL.mjs'))],
                                cwd=repo, env=node_env, input=request, capture_output=True, text=True, timeout=40)
        assert result.returncode == 0, 'local SQL failed (diagnostics withheld)'
        return result.stdout.strip()
    def utc():
        return dt.datetime.now(dt.timezone.utc).isoformat()
    def fingerprints(port):
        tables = query(port, "select table_schema||'.'||table_name from information_schema.tables where table_schema in ('public','drizzle','rehearsal') and table_type='BASE TABLE' order by 1").splitlines()
        hashes = {}
        for table in tables:
            assert re.fullmatch(r'[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*', table)
            schema, name = table.split('.')
            rows = query(port, f'SELECT to_jsonb(t)::text FROM "{schema}"."{name}" t ORDER BY to_jsonb(t)::text')
            hashes[table] = hashlib.sha256(rows.encode()).hexdigest()
        return hashes
    def http(base, path, payload=None, cookie=None):
        headers = {'origin':base}
        if cookie:
            headers['cookie'] = cookie
        if payload is not None:
            headers['content-type'] = 'application/json'
        request = urllib.request.Request(base+path, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=180)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read().decode(), response.headers.get_all('Set-Cookie', [])
    try:
        pwfile = root/'password'
        pwfile.write_text(password+'\n'); pwfile.chmod(0o600)
        run('initdb', [str(pg/'initdb'),'-D',str(data),'-U','postgres','--auth=scram-sha-256','--pwfile='+str(pwfile),'-E','UTF8','--locale=C'])
        pwfile.unlink()
        with (data/'postgresql.conf').open('a') as conf:
            archiver = Path(__file__).with_name('RIWI_R07_ARCHIVE_WAL.py').resolve()
            assert re.fullmatch(r'/[A-Za-z0-9_./-]+', str(archiver))
            conf.write(f"\nwal_level=replica\narchive_mode=on\narchive_command='/usr/bin/python3 {archiver} {root} %p %f'\nmax_wal_senders=3\n")
        with (data/'pg_hba.conf').open('a') as conf:
            conf.write('\nhost replication postgres 127.0.0.1/32 scram-sha-256\n')
        run('start-source', [str(pg/'pg_ctl'),'-D',str(data),'-l',str(root/'source-server.log'),'-w','-o',f'-p {src_port} -k {root} -c listen_addresses=127.0.0.1 -c unix_socket_permissions=0700','start'])
        receipt['postgres_version'] = query(src_port, 'show server_version', 'postgres')
        query(src_port, 'create database learners_qa2', 'postgres')
        source_env = dict(environment, DATABASE_URL=f'postgres://postgres:{password}@127.0.0.1:{src_port}/learners_qa2')
        run('migrations', ['node','scripts/migrate-chain.mjs'], source_env)
        run('fixtures', ['node','scripts/qa2-seed-fixtures.mjs'], source_env)
        # Synthetic owner + knowledge exist only in the new source cluster.
        seed = """import pg from 'pg'; import bcrypt from 'bcryptjs';
const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();
try { await c.query("update users set password_hash=$1,onboarding_completed_at=now(),last_active_at=now() where email='qa2-owner@learners-qa.invalid'",[await bcrypt.hash(process.env.R07_QA_PASSWORD,10)]);
await c.query("insert into riwi_knowledge_sources(source_type,title,checksum,provenance,rights_class,created_by_user_id) select 'owner_instruction',$1,repeat('a',64),'synthetic local PITR','owned',id from users where email='qa2-owner@learners-qa.invalid'",[process.env.R07_QA_TITLE]);
} finally {await c.end();}"""
        run('seed-restored-app-canary', ['node','--input-type=module','-e',seed], dict(source_env,R07_QA_PASSWORD=owner_password,R07_QA_TITLE=canary_title))
        query(src_port, "create schema rehearsal;create table rehearsal.canary(id serial primary key,label text not null,written_at timestamptz not null default clock_timestamp())")
        run('basebackup', ['node',str(Path(__file__).with_name('RIWI_R07_NATIVE_BASE_BACKUP.mjs'))],
            dict(environment, PGPORT=str(src_port), PGDATABASE='learners_qa2', R07_SOURCE_DATA_DIR=str(data), R07_BACKUP_DIR=str(root/'base')), timeout=180)
        backup_receipt = json.loads((root/'basebackup.log').read_text())
        assert backup_receipt['same_connection_start_stop'] and backup_receipt['wait_for_archive'] and not backup_receipt['logical_dump_used']
        receipt['base_backup'] = backup_receipt
        receipt['backup_method_documentation'] = 'https://www.postgresql.org/docs/16/continuous-archiving.html#BACKUP-LOWLEVEL-BASE-BACKUP'
        receipt['archive_fsync_and_no_overwrite'] = True
        acknowledgements = []
        for n in range(1,6):
            query(src_port, f"insert into rehearsal.canary(label)values('pre-{n}')")
            acknowledgements.append({'label':f'pre-{n}','client_acknowledged_at_utc':utc()})
        expected = fingerprints(src_port)
        target = query(src_port, 'select clock_timestamp()::text')
        # A committed transaction after the target guarantees recovery can reach it.
        for n in range(1,4):
            query(src_port, f"insert into rehearsal.canary(label)values('post-{n}')")
            acknowledgements.append({'label':f'post-{n}','client_acknowledged_at_utc':utc()})
        segment = query(src_port, 'select pg_walfile_name(pg_switch_wal())')
        deadline = time.monotonic()+30
        while not (wal/segment).is_file() and time.monotonic() < deadline:
            time.sleep(0.1)
        assert (wal/segment).is_file(), 'WAL archive incomplete'
        failure = utc()
        fk_sql = "select conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid)||'|'||convalidated from pg_constraint where contype='f' order by 1"
        expected_fk = query(src_port, fk_sql)
        request_at, request_clock = utc(), time.monotonic()
        shutil.copytree(root/'base', restored)
        with (restored/'postgresql.conf').open('a') as conf:
            conf.write(f"\narchive_mode=off\nrestore_command='cp {wal}/%f %p'\nrecovery_target_time='{target}'\nrecovery_target_action='promote'\nrecovery_target_inclusive=true\n")
        (restored/'recovery.signal').touch()
        start_clock = time.monotonic()
        run('start-restored', [str(pg/'pg_ctl'),'-D',str(restored),'-l',str(root/'restored-server.log'),'-w','-t','60','-o',f'-p {dst_port} -k {root} -c listen_addresses=127.0.0.1 -c unix_socket_permissions=0700','start'], timeout=90)
        promotion_deadline = time.monotonic()+60
        while query(dst_port,'select pg_is_in_recovery()') != 'f':
            assert time.monotonic() < promotion_deadline, 'restore did not reach promoted target'
            time.sleep(0.1)
        ready_at, ready_clock = utc(), time.monotonic()
        actual = fingerprints(dst_port)
        (root/'integrity.json').write_text(json.dumps({'source_sha256':manifest['sha256'],'source_table_sha256':expected,'restored_table_sha256':actual,'source_fk_sha256':hashlib.sha256(expected_fk.encode()).hexdigest(),'restored_fk_sha256':hashlib.sha256(query(dst_port,fk_sql).encode()).hexdigest()},indent=2)+'\n')
        assert expected == actual, 'table content or migration-journal hashes differ'
        assert query(dst_port,fk_sql) == expected_fk, 'FK definitions differ'
        assert query(dst_port,'select count(*) from pg_constraint where not convalidated') == '0'
        canaries = query(dst_port,'select label from rehearsal.canary order by id').splitlines()
        assert canaries == [f'pre-{n}' for n in range(1,6)], 'PITR canary boundary mismatch'
        restored_acks = [a for a in acknowledgements if a['label'] in canaries]
        missing_acks = [a for a in acknowledgements if a['label'] not in canaries]
        latest_restored_ack = max(a['client_acknowledged_at_utc'] for a in restored_acks)
        observed_rpo = (dt.datetime.fromisoformat(failure)-dt.datetime.fromisoformat(latest_restored_ack)).total_seconds()
        assert observed_rpo >= 0, 'RPO clock order invalid'
        verified_at, verified_clock = utc(), time.monotonic()
        # Boot the actual application against the RESTORED database, with no build/provider.
        app_port = free_port(); base = f'http://127.0.0.1:{app_port}'
        app_env = dict(environment, DATABASE_URL=f'postgres://postgres:{password}@127.0.0.1:{dst_port}/learners_qa2',
                       AUTH_SECRET=secrets.token_hex(32), PUBLIC_BASE_URL=base,NEXT_PUBLIC_APP_URL=base,
                       APP_ENV='development',NODE_ENV='development',STORAGE_PROVIDER='local',STORAGE_LOCAL_DIR=str(root/'objects'),
                       RIWI_ENABLED='true',RIWI_OWNER_ENABLED='true',RIWI_EXTERNAL_AI_ENABLED='false',AI_PRIMARY_PROVIDER='riwi')
        (root/'objects').mkdir(mode=0o700)
        app_log = (root/'app.log').open('xb')
        app = subprocess.Popen(['node','node_modules/next/dist/bin/next','dev','-H','127.0.0.1','-p',str(app_port)],cwd=repo,env=app_env,stdout=app_log,stderr=subprocess.STDOUT,start_new_session=True)
        deadline = time.monotonic()+300
        while time.monotonic() < deadline:
            assert app.poll() is None, 'restored application exited'
            try:
                if http(base,'/api/version')[0] == 200:
                    break
            except (OSError,TimeoutError):
                pass
            time.sleep(0.2)
        else:
            raise AssertionError('restored application readiness timeout')
        status, _, cookies = http(base,'/api/auth/login',{'email':'qa2-owner@learners-qa.invalid','password':owner_password})
        assert status == 200 and cookies, 'restored owner password login failed'
        cookie = '; '.join(value.split(';',1)[0] for value in cookies)
        status, body, _ = http(base,'/api/riwi/owner/knowledge',cookie=cookie)
        assert status == 200 and canary_title in body, 'restored knowledge canary absent from actual application'
        knowledge_body_sha256 = hashlib.sha256(body.encode()).hexdigest()
        denied, body, _ = http(base,'/api/riwi/owner/knowledge')
        assert denied in [401,403] and canary_title not in body, 'anonymous restored knowledge disclosure'
        source_check()
        assert all(hashlib.sha256(p.read_bytes()).hexdigest()==tool_hashes[p.name] for p in support), 'QA tools changed during run'
        (root/'app-verification.json').write_text(json.dumps({'owner_login_status':200,'owner_knowledge_status':200,'expected_synthetic_title_found':True,'knowledge_body_sha256':knowledge_body_sha256,'anonymous_status':denied,'anonymous_canary_disclosed':False,'source_sha256':manifest['sha256'],'production_build':False})+'\n')
        receipt.update(status='LOCAL_REHEARSAL_PASSED_NOT_PROVIDER_ACCEPTANCE',table_hashes_equal=True,tables_compared=len(expected),
                       table_sha256=expected,restored_table_sha256=actual,integrity_evidence_sha256=hashlib.sha256((root/'integrity.json').read_bytes()).hexdigest(),app_verification_sha256=hashlib.sha256((root/'app-verification.json').read_bytes()).hexdigest(),fk_definitions_equal=True,fk_count=len(expected_fk.splitlines()),unvalidated_constraints=0,
                       canaries_restored=canaries,client_acknowledgements=acknowledgements,
                       recovery_target_utc=target,simulated_failure_utc=failure,restore_requested_utc=request_at,
                       restore_ready_utc=ready_at,hash_verified_utc=verified_at,
                       rto_request_to_ready_seconds=ready_clock-request_clock,rto_start_to_ready_seconds=ready_clock-start_clock,
                       rto_request_to_hash_verified_seconds=verified_clock-request_clock,
                       rto_request_to_app_verified_seconds=time.monotonic()-request_clock,
                       deliberately_selected_target_loss_seconds=observed_rpo,
                       observed_rpo_failure_to_latest_restored_ack_seconds=observed_rpo,
                       latest_restored_client_ack_utc=latest_restored_ack,missing_acknowledged_canaries=missing_acks,
                       app_boot={'mode':'next dev','restored_database_verified':True,'owner_password_login_status':200,
                                 'restored_owner_knowledge_status':200,'anonymous_denial_status':denied,'production_build':False},
                       private_object_store_verified=False,live_provider_verified=False,actual_browser_verified=False)
    except Exception as error:
        receipt.update(status='FAILED',error=str(error))
    finally:
        if app is not None:
            try:
                os.killpg(app.pid,signal.SIGTERM);app.wait(timeout=10)
            except ProcessLookupError:
                pass
            except subprocess.TimeoutExpired:
                os.killpg(app.pid,signal.SIGKILL);app.wait(timeout=10)
            # Reap development-server descendants even if the launcher exited first.
            try:
                os.killpg(app.pid,signal.SIGKILL)
            except ProcessLookupError:
                pass
            receipt['cleanup']['app_stopped'] = app.poll() is not None
        for name, cluster in [('restored',restored),('source',data)]:
            pidfile = cluster/'postmaster.pid'
            if pidfile.exists():
                try:
                    run('stop-'+name,[str(pg/'pg_ctl'),'-D',str(cluster),'-w','-t','20','stop','-m','fast'],timeout=30)
                except Exception:
                    receipt['cleanup'][name+'_stop_failed'] = True
            receipt['cleanup'][name+'_stopped'] = not pidfile.exists()
        if (root/'password').exists():
            (root/'password').unlink()
        if any(not value for key,value in receipt['cleanup'].items() if key.endswith('_stopped')) or any(key.endswith('_failed') for key in receipt['cleanup']):
            receipt['status'] = 'FAILED_CLEANUP'
        (root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
        print(json.dumps({'status':receipt['status'],'receipt':str(root/'receipt.json'),'cleanup':receipt['cleanup']}),flush=True)
    return 0 if receipt['status'] == 'LOCAL_REHEARSAL_PASSED_NOT_PROVIDER_ACCEPTANCE' else 1


if __name__ == '__main__':
    raise SystemExit(main())
