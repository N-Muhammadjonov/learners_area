#!/usr/bin/env python3
"""Pinned full native QA in two fresh private clusters. No downloads or Git writes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import zipfile

STATE = '065159408345cd274734a3b878cdb1bde4602164e9ec3eea871b9a0347ad504c'
MANIFEST_SHA = "a6b187d4a4b32be1eb0a67b0bd9d8e154d1068d547cc1e986b51a01d08746137"
INPUTS = {}
SOURCE_HASHES = {
    'LISTENING_SOURCE_ZIP': '5c3cdfffe029b3a7c948f34b2be2d17201c760eae1678f6d83e2853073a90c77',
    'SPEAKING_BANK_SOURCE': '209e1161dd71ef3553ee3e3fe189cdc092b71d8d7f1a5e48c6dbb53ba9dc9f16',
}

def require(ok, message):
    if not ok:
        raise RuntimeError(message)

def source_check(repo, source):
    for name, path in INPUTS.items():
        require(hashlib.sha256(Path(path).read_bytes()).hexdigest() == SOURCE_HASHES[name], 'Original source changed: ' + name)
    require(source['sha256'] == STATE and len(source['files']) == 1255, 'Source manifest mismatch')
    expected = {item['path'] for item in source['files']}
    actual = set()
    for folder in ['src', 'tests', 'scripts', 'drizzle']:
        for p in (repo / folder).rglob('*'):
            require(not p.is_symlink(), 'Source symlink refused')
            if p.is_file():
                actual.add(p.relative_to(repo).as_posix())
    for name in ['package.json', 'package-lock.json', 'tsconfig.json', 'next.config.mjs', 'vercel.json']:
        if (repo / name).is_file():
            actual.add(name)
    require(actual == expected, 'Source inventory mismatch')
    for item in source['files']:
        p = repo / item['path']
        require(p.resolve().is_relative_to(repo), 'Source path escape refused')
        require(hashlib.sha256(p.read_bytes()).hexdigest() == item['sha256'], 'Source changed: ' + item['path'])

def counts_from_tap(body):
    out = {}
    for name in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']:
        values = re.findall(r'^# ' + name + r' (\d+)$', body, re.M)
        require(len(values) == 1, 'Missing or ambiguous test summary: ' + name)
        out[name] = int(values[0])
    return out

IDENTITY_JS = '''import pg from "pg"; import fs from "node:fs";
if(process.env.PGHOST!=="127.0.0.1")throw new Error("isolated_host_required");
const c=new pg.Client({host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER,password:process.env.PGPASSWORD,database:"postgres"});
try{await c.connect();const r=(await c.query("select current_setting('server_version_num')::int version,current_setting('data_directory') data_dir")).rows[0];
if(r.version<150000||fs.realpathSync(r.data_dir)!==fs.realpathSync(process.env.RIWI_QA_DATA_DIR))throw new Error("isolated_cluster_identity_mismatch");
if(process.env.RIWI_CREATE_DATABASES==="1"){await c.query("create database learners_qa2");await c.query("create database learners_portability");}
console.log(JSON.stringify({native_version:r.version,new_private_cluster:true}));}finally{await c.end();}'''

def run_round(repo, source, pg_bin, parent, round_no, base_env, version):
    root = Path(tempfile.mkdtemp(prefix=f'round-{round_no}-', dir=parent))
    root.chmod(0o700)
    data = root / 'data'
    password_file = root / 'password'
    password = secrets.token_hex(24)
    password_file.write_text(password + '\n')
    password_file.chmod(0o600)
    storage = root / 'objects'
    storage.mkdir(mode=0o700)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    env = dict(base_env, PGPASSWORD=password, PGHOST='127.0.0.1', PGPORT=str(port), PGUSER='postgres', PGDATABASE='learners_qa2', RIWI_QA_DATA_DIR=str(data), STORAGE_PROVIDER='local', STORAGE_LOCAL_DIR=str(storage), AUTH_SECRET=secrets.token_hex(32))
    result = {'round': round_no, 'status': 'RUNNING', 'source_sha256': STATE, 'postgres_version': version.strip(), 'private_root': str(root), 'checks': {}, 'cluster_stopped': False}
    started = False

    def run(name, argv, timeout=180):
        path = root / (name + '.log')
        source_check(repo, source)
        print(f'Round {round_no}: {name}', flush=True)
        with path.open('xb') as stream:
            try:
                proc = subprocess.run(argv, cwd=repo, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=timeout)
                code = proc.returncode
            except subprocess.TimeoutExpired:
                code = 124
                stream.write(b'\nQA runner timeout\n')
        result['checks'][name] = {'exit_code': code, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'log': str(path)}
        require(code == 0, name + ' failed. Inspect private log: ' + str(path))
        source_check(repo, source)
        return path

    try:
        run('initdb', [str(pg_bin / 'initdb'), '-D', str(data), '-U', 'postgres', '--auth=scram-sha-256', '--pwfile=' + str(password_file), '-E', 'UTF8', '--locale=C'])
        password_file.unlink()
        run('start', [str(pg_bin / 'pg_ctl'), '-D', str(data), '-l', str(root / 'server.log'), '-w', '-o', f'-p {port} -k {root} -c listen_addresses=127.0.0.1 -c unix_socket_permissions=0700', 'start'])
        started = True
        env['RIWI_CREATE_DATABASES'] = '1'
        run('createdb', ['node', '--input-type=module', '-e', IDENTITY_JS])
        del env['RIWI_CREATE_DATABASES']
        env['DATABASE_URL'] = f'postgres://postgres:{password}@127.0.0.1:{port}/learners_qa2'
        portability = f'postgres://postgres:{password}@127.0.0.1:{port}/learners_portability'
        run('migrations-qa', ['node', 'scripts/migrate-chain.mjs'])
        env['DATABASE_URL'] = portability
        run('migrations-portability', ['node', 'scripts/migrate-chain.mjs'])
        env['DATABASE_URL'] = f'postgres://postgres:{password}@127.0.0.1:{port}/learners_qa2'
        env.update(PORTABILITY_DATABASE_URL=portability, QA2_DATABASE_TESTS='1')
        run('fixtures', ['node', 'scripts/qa2-seed-fixtures.mjs'])
        run('identity-before-tests', ['node', '--input-type=module', '-e', IDENTITY_JS])
        tests = [p.relative_to(repo).as_posix() for p in sorted((repo / 'tests').glob('*.test.ts'))]
        require(tests, 'Backend test inventory empty')
        result['backend_files'] = tests
        log = run('backend', ['node', '--conditions=react-server', '--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', *tests], timeout=1800)
        body = log.read_text()
        counts = counts_from_tap(body)
        result['checks']['backend']['counts'] = counts
        skipped = re.findall(r'^ok \d+ - (.*?) # SKIP(?: .*)?$', body, re.M)
        result['checks']['backend']['declared_skips'] = skipped
        require(counts['tests'] >= 1484 and counts['pass'] == counts['tests'] and all(counts[k] == 0 for k in ['fail','cancelled','skipped','todo']), 'Native backend counts mismatch')
        require(not skipped, 'Skipped cases cannot count as PASS')
        ui = [p.relative_to(repo).as_posix() for p in sorted((repo / 'tests/ui').glob('*.test.tsx'))]
        env['TSX_TSCONFIG_PATH'] = 'tests/ui/tsconfig.json'
        ui_log = run('ui', ['node', '--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', *ui], timeout=900)
        del env['TSX_TSCONFIG_PATH']
        ui_counts = counts_from_tap(ui_log.read_text())
        result['checks']['ui']['counts'] = ui_counts
        require(ui_counts == {'tests': 262, 'pass': 262, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}, 'UI counts mismatch')
        run('typecheck', ['npm', 'run', 'typecheck'], timeout=600)
        run('lint', ['npm', 'run', 'lint'], timeout=600)
        run('app-boot', ['node', '--conditions=react-server', '--import', 'tsx', 'scripts/qa-riwi-retention-runtime.ts', str(root / 'r04-http.json')], timeout=1800)
        r06_args = ['node', '--conditions=react-server', '--import', 'tsx', 'scripts/qa-riwi-r06-runtime.ts', str(root / 'r06-http.json')]
        run('r06-http', r06_args, timeout=1800)
        run('identity-after-tests', ['node', '--input-type=module', '-e', IDENTITY_JS])
        result['status'] = 'GATES_PASSED_SHUTDOWN_PENDING'
    except Exception as exc:
        result['status'] = 'FAILED'
        result['error'] = str(exc)
    finally:
        if password_file.exists():
            password_file.unlink()
        if started or (data / 'postmaster.pid').exists():
            # Shutdown is essential even if source bytes changed during a gate.
            path = root / 'stop.log'
            with path.open('xb') as stream:
                try:
                    code = subprocess.run([str(pg_bin / 'pg_ctl'), '-D', str(data), '-w', 'stop', '-m', 'fast'], env=env, cwd=repo, stdout=stream, stderr=subprocess.STDOUT, timeout=90).returncode
                except subprocess.TimeoutExpired:
                    code = 124
            result['checks']['stop'] = {'exit_code': code, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'log': str(path)}
            result['cluster_stopped'] = code == 0 and not (data / 'postmaster.pid').exists()
            if not result['cluster_stopped']:
                result['status'] = 'FAILED_SHUTDOWN'
        result['password_file_removed'] = not password_file.exists()
        if result['status'] == 'GATES_PASSED_SHUTDOWN_PENDING':
            result['status'] = 'PASSED' if result['cluster_stopped'] else 'FAILED_SHUTDOWN'
        (root / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n')
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only', action='store_true', help='Verify pinned source, original inputs and installed tools; create no cluster')
    parser.add_argument('--repo', required=True, type=Path)
    parser.add_argument('--source-manifest', required=True, type=Path)
    parser.add_argument('--pg-bin', required=True, type=Path)
    parser.add_argument('--listening-source', required=True, type=Path)
    parser.add_argument('--speaking-bank-source', required=True, type=Path)
    args = parser.parse_args()
    repo = args.repo.resolve(strict=True)
    INPUTS.update(LISTENING_SOURCE_ZIP=str(args.listening_source.resolve(strict=True)), SPEAKING_BANK_SOURCE=str(args.speaking_bank_source.resolve(strict=True)))
    raw = args.source_manifest.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == MANIFEST_SHA, 'Source manifest bytes mismatch')
    source = json.loads(raw)
    source_check(repo, source)
    pg_bin = args.pg_bin.resolve(strict=True)
    require(all((pg_bin / n).is_file() and os.access(pg_bin / n, os.X_OK) for n in ['initdb', 'pg_ctl', 'postgres']), 'Trusted installed native PostgreSQL binaries missing')
    env = {k: os.environ[k] for k in ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'LANG', 'LC_ALL'] if k in os.environ}
    env.update(INPUTS)
    libs = pg_bin.parent / 'lib'
    if libs.is_dir():
        env.update(DYLD_LIBRARY_PATH=str(libs), LD_LIBRARY_PATH=str(libs))
    version = subprocess.check_output([str(pg_bin / 'postgres'), '--version'], env=env, text=True)
    match = re.search(r'PostgreSQL\) (\d+)', version)
    require(match and int(match[1]) >= 15, 'Native PostgreSQL 15+ required')
    require(subprocess.check_output(['node', '--version'], env=env, text=True).startswith('v24.'), 'Node 24 required')
    if args.check_only:
        print(json.dumps({'status':'PREFLIGHT_PASSED_NOT_QA','source_sha256':STATE,'source_files':1255,'rounds_executed':0,'database_created':False,'build_rerun':False}),flush=True)
        return 0
    root = Path(tempfile.mkdtemp(prefix='riwi-final-native-', dir='/tmp'))
    root.chmod(0o700)
    print('Private QA logs: ' + str(root), flush=True)
    rounds = []
    for number in [1, 2]:
        result = run_round(repo, source, pg_bin, root, number, env, version)
        rounds.append(result)
        if result['status'] != 'PASSED':
            break
    passed = len(rounds) == 2 and all(r['status'] == 'PASSED' for r in rounds)
    receipt = {'status': 'PASSED_TWO_FULL_NATIVE_ROUNDS_NO_SKIPS' if passed else 'FAILED_OR_INCOMPLETE', 'source_sha256': STATE, 'source_files': 1255, 'original_inputs': {name: {'path': path, 'sha256': SOURCE_HASHES[name]} for name, path in INPUTS.items()}, 'rounds': rounds, 'existing_databases_reset': False, 'each_round_new_private_cluster': True, 'storage': 'fresh private local directory only', 'build_rerun': False, 'commit_performed': False, 'push_performed': False, 'source_skips_count_as_pass': False, 'original_group_acceptance_automatic': False, 'campaigns': 1, 'live_provider_verified': False, 'actual_browser_verified': False, 'real_private_object_store_verified': False, 'provider_pitr_verified': False}
    (root / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    output = root / 'RIWI_FINAL_NATIVE_QA_EVIDENCE.zip'
    with zipfile.ZipFile(output, 'x', zipfile.ZIP_DEFLATED) as archive:
        archive.write(root / 'receipt.json', 'receipt.json')
        for r in rounds:
            private = Path(r['private_root'])
            archive.write(private / 'receipt.json', f'round-{r["round"]}/receipt.json')
            if (private / 'r06-http.json').exists(): archive.write(private / 'r06-http.json', f'round-{r["round"]}/r06-http.json')
            if (private / 'r04-http.json').exists(): archive.write(private / 'r04-http.json', f'round-{r["round"]}/r04-http.json')
            for check in r['checks'].values():
                p = Path(check['log'])
                archive.write(p, f'round-{r["round"]}/' + p.name)
    print('Receipt: ' + str(root / 'receipt.json'), flush=True)
    print('Evidence ZIP: ' + str(output), flush=True)
    print('Finder: open -R ' + json.dumps(str(output)), flush=True)
    print('Two full native rounds passed without skips. Review and publication remain separate.' if passed else 'QA incomplete. Preserve and provide the evidence ZIP.', flush=True)
    return 0 if passed else 1

if __name__ == '__main__':
    sys.exit(main())
