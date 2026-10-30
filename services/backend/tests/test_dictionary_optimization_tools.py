import importlib.util
import json
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[3]/'tools/dictionary-optimization'
spec = importlib.util.spec_from_file_location('optimization', ROOT/'scripts/dictionary_optimization.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


def inventory():
    releases = []
    for ident in [d.ACTIVE, d.PREVIOUS]:
        descriptor = {'name': 'directory', 'sha256': 'a'*64, 'raw_sha256': 'b'*64,
                      'compressed_bytes': 100, 'raw_bytes': 200}
        shards = [dict(shard=a+b, entries=1, sha256='c'*64, raw_sha256='d'*64,
                       compressed_bytes=100, raw_bytes=200) for a in sorted(d.HEX) for b in sorted(d.HEX)]
        manifest = {'release_id': ident, 'lexemes': 256, 'senses': 256, 'examples': 256,
                    'search_terms': 256, 'entry_inventory_sha256': 'e'*64,
                    'sense_set_sha256': 'f'*64, 'example_set_sha256': '0'*64,
                    'storage': {'shards': shards, 'search': {'version': 'prefix-sorted-postings-v3',
                        'objects': [descriptor], 'directory': descriptor,
                        'routes': {'EN:a': descriptor, 'UZ:o': descriptor}, 'logicalTerms': 256}}}
        releases.append(dict(id=ident, state='validated', delivery='r2-worker-v1',
                             manifest=manifest, manifestSha=d.sha(d.manifest_bytes(manifest))))
    return {'channels': [dict(name='stable', active_release_id=d.ACTIVE,
                              previous_release_id=d.PREVIOUS)], 'releases': releases}


def restamp(value):
    for r in value['releases']:
        r['manifestSha'] = d.sha(d.manifest_bytes(r['manifest']))


def test_valid_metadata_never_claims_r2_byte_verification():
    result = d.validate_inventory(inventory())
    assert result['status'] == 'PASS'
    assert result['r2BytesVerified'] is False


def test_native_manifest_comparator_is_required():
    value = {'raw_sha256': 'x', 'rawBytes': 1, 'EN:a': {}, 'en_b': {}}
    assert d.manifest_bytes(value) != d.canonical(value)


@pytest.mark.parametrize('change,code', [
    ('sha', 'manifest_checksum_mismatch'),
    ('shard_missing', 'shard_inventory_incomplete'),
    ('shard_duplicate', 'shard_inventory_incomplete'),
    ('counts', 'entry_count_mismatch'),
    ('route', 'unlisted_route_descriptor'),
    ('index_duplicate', 'duplicate_index_object'),
    ('terms', 'search_count_mismatch'),
    ('invalid_hash', 'invalid_descriptor_hash'),
    ('invalid_size', 'invalid_descriptor_size'),
    ('release', 'manifest_release_mismatch'),
])
def test_inventory_rejects_corruption(change, code):
    value = inventory()
    manifest = value['releases'][0]['manifest']
    search = manifest['storage']['search']
    if change == 'sha':
        value['releases'][0]['manifestSha'] = '0'*64
    elif change == 'shard_missing':
        manifest['storage']['shards'].pop()
    elif change == 'shard_duplicate':
        manifest['storage']['shards'][0] = manifest['storage']['shards'][1]
    elif change == 'counts':
        manifest['lexemes'] += 1
    elif change == 'route':
        search['routes']['EN:a'] = dict(search['directory'], name='unknown')
    elif change == 'index_duplicate':
        search['objects'].append(search['objects'][0])
    elif change == 'terms':
        search['logicalTerms'] += 1
    elif change == 'invalid_hash':
        manifest['storage']['shards'][0]['sha256'] = 'invalid'
    elif change == 'invalid_size':
        manifest['storage']['shards'][0]['compressed_bytes'] = 0
    elif change == 'release':
        manifest['release_id'] = d.LEGACY
    if change != 'sha':
        restamp(value)
    with pytest.raises(ValueError, match=code):
        d.validate_inventory(value)


def benchmark(stage='before', ms=100):
    return dict(stage=stage, release=d.ACTIVE, querySetSha='a'*64, cohort='desktop', network='same-runner',
      apiBase='https://learnersarea.uz', samples=[dict(case=i%6, temperature=t, ms=ms, pass_=True,
      responseSha=str(i%6), **{'pass': True}) for t in ['observed_first_pass', 'warm'] for i in range(120)])


def test_p95_boundary_passes_without_claiming_cold_start():
    result = d.compare_benchmarks(benchmark(), benchmark('after', 110))
    assert result['status'] == 'PASS' and result['coldStartVerified'] is False


@pytest.mark.parametrize('change,code', [
    ('slow', 'p95_regression'), ('small', 'insufficient_benchmark_samples'),
    ('error', 'benchmark_request_or_parity_failure'), ('payload', 'response_parity_mismatch'),
    ('order', 'query_order_changed'), ('cohort', 'incomparable_cohort'),
    ('release', 'incomparable_release'), ('stage', 'invalid_benchmark_stage'),
    ('querySetSha', 'incomparable_querySetSha'),
])
def test_performance_gate_rejects_invalid_comparisons(change, code):
    before, after = benchmark(), benchmark('after')
    if change == 'slow':
        after = benchmark('after', 111)
    elif change == 'small':
        after['samples'] = after['samples'][:50]
    elif change == 'error':
        after['samples'][0]['pass'] = False
    elif change == 'payload':
        after['samples'][0]['responseSha'] = 'changed'
    elif change == 'order':
        after['samples'][0]['case'] = 4
    else:
        after[change] = 'different'
    with pytest.raises(ValueError, match=code):
        d.compare_benchmarks(before, after)


@pytest.mark.parametrize('values', [[], [float('nan')], [-1], [float('inf')]])
def test_invalid_latency_samples_fail(values):
    with pytest.raises(ValueError):
        d.percentile(values, .95)


def test_real_audit_stops_without_backup_and_measured_receipts(tmp_path):
    audit = d.load(ROOT/'evidence/audit.json')
    result = d.gates(audit, {'status': 'PASS'}, {}, tmp_path)
    assert result['status'] == 'BLOCKED'
    assert 'private_backup_restore' in result['blocked']
    assert 'comparable_performance' in result['blocked']
    assert 'explicit_cleanup_approval' in result['blocked']
    assert result['productionMutationPerformed'] is False


def test_running_publish_is_a_hard_stop(tmp_path):
    audit = d.load(ROOT/'evidence/audit.json')
    audit['baseline']['jobs'][0]['phase'] = 'worker_index'
    result = d.gates(audit, {'status': 'PASS'}, {}, tmp_path)
    assert not result['checks']['no_running_publish']


def test_fabricated_attestation_without_matching_artifact_is_blocked(tmp_path):
    audit = d.load(ROOT/'evidence/audit.json')
    receipts = {'private_backup_restore': {'status': 'PASS', 'artifact': 'absent.json',
                'sha256': 'a'*64, 'measuredAt': '2026-10-26T00:00:00Z'}}
    assert not d.gates(audit, {'status': 'PASS'}, receipts, tmp_path)['checks']['private_backup_restore']
    artifact = tmp_path/'absent.json'
    artifact.write_text(json.dumps({'status': 'PASS'}))
    assert not d.gates(audit, {'status': 'PASS'}, receipts, tmp_path)['checks']['private_backup_restore']


def test_qa_origin_requires_a_separate_approved_origin_and_session(monkeypatch):
    with pytest.raises(ValueError):
        d.validate_api_origin('https://qa.example.test', 'LA_EXISTING_SESSION_COOKIE')
    monkeypatch.setenv('LA_APPROVED_QA_ORIGIN', 'https://qa.example.test')
    with pytest.raises(ValueError):
        d.validate_api_origin('https://qa.example.test', 'LA_EXISTING_SESSION_COOKIE')
    d.validate_api_origin('https://qa.example.test', 'LA_EXISTING_QA_SESSION_COOKIE')


@pytest.mark.parametrize('origin', ['http://learnersarea.uz', 'https://user@learnersarea.uz',
                                    'https://learnersarea.uz/forward', 'https://learnersarea.uz?key=x'])
def test_benchmark_rejects_unsafe_origins(origin):
    with pytest.raises(ValueError):
        d.validate_api_origin(origin, 'LA_EXISTING_SESSION_COOKIE')
