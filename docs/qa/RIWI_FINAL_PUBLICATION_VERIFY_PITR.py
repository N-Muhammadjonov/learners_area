#!/usr/bin/env python3
"""Read-only independent verification of a scoped native PITR evidence packet."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import re

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--repo', required=True, type=Path)
p.add_argument('--evidence', required=True, type=Path)
p.add_argument('--private-root', type=Path)
args = p.parse_args()
repo = args.repo.resolve(strict=True)
evidence = args.evidence.resolve(strict=True)
r = json.loads((evidence / 'receipt.json').read_text())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
manifest = json.loads((repo / 'docs/qa/RIWI_FINAL_PUBLICATION_SOURCE_STATE.json').read_text())
assert hashlib.sha256(json.dumps(manifest['files'], separators=(',', ':')).encode()).hexdigest() == manifest['sha256'] == r['source_sha256']
for item in manifest['files']:
    assert sha(repo / item['path']) == item['sha256'], item['path']
assert r['status'] == 'LOCAL_REHEARSAL_PASSED_NOT_PROVIDER_ACCEPTANCE'
assert r['postgres_version'].startswith('16.')
assert not r['provider_verified'] and not r['production_touched'] and not r['contractual_rpo_rto_selected']
assert not r['live_provider_verified'] and not r['private_object_store_verified'] and not r['actual_browser_verified']
assert all(r['cleanup'][key] for key in ['app_stopped', 'source_stopped', 'restored_stopped'])
for name, check in r['checks'].items():
    assert check['exit_code'] == 0 and sha(evidence / (name + '.log')) == check['sha256'], name
for name, expected in r['qa_tool_sha256'].items():
    assert sha(repo / 'docs/qa' / name) == expected, name
integrity = json.loads((evidence / 'integrity.json').read_text())
assert sha(evidence / 'integrity.json') == r['integrity_evidence_sha256']
assert integrity['source_sha256'] == r['source_sha256']
assert integrity['source_table_sha256'] == integrity['restored_table_sha256'] == r['table_sha256'] == r['restored_table_sha256']
assert len(integrity['source_table_sha256']) == r['tables_compared'] >= 100
assert integrity['source_fk_sha256'] == integrity['restored_fk_sha256']
assert r['fk_count'] >= 100 and r['unvalidated_constraints'] == 0 and r['fk_definitions_equal']
assert r['canaries_restored'] == ['pre-' + str(i) for i in range(1, 6)]
acks = r['client_acknowledgements']
assert len(acks) == 8 and {x['label'] for x in acks} == set(r['canaries_restored']) | {'post-1', 'post-2', 'post-3'}
assert [x['label'] for x in r['missing_acknowledged_canaries']] == ['post-1', 'post-2', 'post-3']
latest = max(x['client_acknowledged_at_utc'] for x in acks if x['label'] in r['canaries_restored'])
assert latest == r['latest_restored_client_ack_utc']
target = dt.datetime.fromisoformat(r['recovery_target_utc'])
assert dt.datetime.fromisoformat(latest) < target
assert all(dt.datetime.fromisoformat(x['client_acknowledged_at_utc']) > target for x in r['missing_acknowledged_canaries'])
rpo = (dt.datetime.fromisoformat(r['simulated_failure_utc']) - dt.datetime.fromisoformat(latest)).total_seconds()
assert abs(rpo - r['observed_rpo_failure_to_latest_restored_ack_seconds']) < 0.000001
assert 0 <= r['rto_request_to_ready_seconds'] <= r['rto_request_to_hash_verified_seconds'] <= r['rto_request_to_app_verified_seconds']
backup = r['base_backup']
assert backup['same_connection_start_stop'] and backup['wait_for_archive'] and not backup['logical_dump_used']
assert not backup['external_tablespaces'] and r['archive_fsync_and_no_overwrite']
assert sha(evidence / 'backup-label.txt') == backup['backup_label_sha256']
recovery = (evidence / 'restored-server.log').read_text()
assert r['recovery_target_utc'] in recovery
assert 'recovery stopping before commit of transaction' in recovery and 'archive recovery complete' in recovery
assert 'selected new timeline ID: 2' in recovery and 'database system is shut down' in recovery
app = json.loads((evidence / 'app-verification.json').read_text())
assert sha(evidence / 'app-verification.json') == r['app_verification_sha256']
assert app['source_sha256'] == r['source_sha256'] and app['expected_synthetic_title_found']
assert app['owner_login_status'] == app['owner_knowledge_status'] == 200
assert app['anonymous_status'] in [401, 403] and not app['anonymous_canary_disclosed'] and not app['production_build']
assert re.fullmatch(r'[a-f0-9]{64}', app['knowledge_body_sha256'])
assert 'POST /api/auth/login 200' in (evidence / 'app.log').read_text()
assert 'GET /api/riwi/owner/knowledge 200' in (evidence / 'app.log').read_text()
physical_files_rehashed = False
if args.private_root:
    private = args.private_root.resolve(strict=True)
    assert private == Path(r['private_root']).resolve(strict=True)
    assert private.parent == Path('/tmp').resolve(strict=True) and re.fullmatch(r'riwi-r07-pitr-[A-Za-z0-9_]+', private.name)
    for name in ['source', 'restored']:
        assert not (private / name / 'postmaster.pid').exists()
        assert (private / name / 'PG_VERSION').read_text().strip() == '16'
    assert not (private / 'password').exists()
    assert sha(private / 'base/backup_label') == backup['backup_label_sha256']
    for item in backup['archived_backup_wal']:
        wal = private / 'wal' / item['name']
        assert wal.stat().st_size == item['bytes'] and sha(wal) == item['sha256']
    physical_files_rehashed = True
print(json.dumps({'verified': True, 'scope': 'LOCAL_NATIVE_PHYSICAL_BACKUP_AND_PITR_ONLY',
                  'source_sha256': r['source_sha256'], 'source_files': len(manifest['files']),
                  'tables_compared': r['tables_compared'], 'foreign_keys': r['fk_count'],
                  'before_target_canaries_restored': 5, 'after_target_canaries_absent': 3,
                  'raw_gates_verified': len(r['checks']), 'frozen_QA_tools_verified': len(r['qa_tool_sha256']),
                  'physical_backup_WAL_rehashed_now': physical_files_rehashed,
                  'restored_owner_login_and_knowledge_verified': True, 'anonymous_denied': True,
                  'app_and_two_clusters_stopped': True, 'provider_acceptance': False,
                  'contractual_RPO_RTO_selected': False,
                  'local_observed_RPO_seconds': rpo,
                  'local_RTO_to_app_verified_seconds': r['rto_request_to_app_verified_seconds']}, indent=2))
