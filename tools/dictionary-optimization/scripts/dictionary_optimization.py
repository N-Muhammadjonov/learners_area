#!/usr/bin/env python3
"""Read-only dictionary evidence tools. This program never executes cleanup SQL.

Run from an existing Learners Area checkout with its existing backend runtime.
Credentials are read only from environment variables and never written to evidence.
"""
from __future__ import annotations
import argparse
import asyncio
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit

PROD = 'tuoeabrrnsiuxpjmslxp'
LEGACY = 'rel-v1-a834010a6ccc72c8b3cd8db9'
ACTIVE = 'rel-v1-977bce7f8dab7e773955238e'
PREVIOUS = 'rel-v1-cfadf47e87701f627f3270ce'
HEX = set('0123456789abcdef')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()


def manifest_bytes(value):
    # Existing stableJson sorts with ICU English localeCompare, not code points.
    root = Path(os.environ.get('LA_REPO', Path(__file__).resolve().parents[3]))
    sys.path.insert(0, str(root/'services/backend'))
    from app.dictionary_canonical import stable
    return stable(value).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def load(path):
    p = Path(path)
    return json.loads(gzip.decompress(p.read_bytes()) if p.suffix == '.gz' else p.read_bytes())


def save(path, value):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def require(value, code):
    if not value:
        raise ValueError(code)


def digest_ok(value):
    return isinstance(value, str) and len(value) == 64 and set(value) <= HEX


def validate_inventory(inventory):
    """Validate captured metadata; deliberately does NOT claim R2 bytes were read."""
    channels = inventory['channels']
    require(len(channels) == 1 and channels[0]['name'] == 'stable', 'unexpected_channels')
    channel = channels[0]
    releases = {r['id']: r for r in inventory['releases']}
    require(len(releases) == len(inventory['releases']), 'duplicate_release')
    expected = {channel['active_release_id'], channel['previous_release_id']}
    require(None not in expected and len(expected) == 2 and set(releases) == expected,
            'protected_release_inventory_incomplete')
    result = []
    for ident in sorted(expected):
        row = releases[ident]
        manifest = row['manifest']
        require(row['state'] == 'validated' and row['delivery'] == 'r2-worker-v1',
                'protected_release_not_worker_validated')
        require(manifest['release_id'] == ident, 'manifest_release_mismatch')
        require(sha(manifest_bytes(manifest)) == row['manifestSha'], 'manifest_checksum_mismatch')
        shards = manifest['storage']['shards']
        prefixes = {s['shard'] for s in shards}
        require(len(shards) == 256 and prefixes == {a+b for a in HEX for b in HEX},
                'shard_inventory_incomplete')
        require(sum(s['entries'] for s in shards) == manifest['lexemes'], 'entry_count_mismatch')
        search = manifest['storage']['search']
        objects = search['objects']
        by_name = {o['name']: o for o in objects}
        require(len(by_name) == len(objects) and len(objects) > 0, 'duplicate_index_object')
        require(search['version'] == 'prefix-sorted-postings-v3', 'index_version_mismatch')
        require(search['logicalTerms'] == manifest['search_terms'], 'search_count_mismatch')
        for descriptor in shards + objects:
            require(digest_ok(descriptor['sha256']) and digest_ok(descriptor['raw_sha256']),
                    'invalid_descriptor_hash')
            require(type(descriptor['compressed_bytes']) is int and descriptor['compressed_bytes'] > 0
                    and type(descriptor['raw_bytes']) is int and descriptor['raw_bytes'] > 0,
                    'invalid_descriptor_size')
        for descriptor in [search['directory'], *search['routes'].values()]:
            require(by_name.get(descriptor['name']) == descriptor, 'unlisted_route_descriptor')
        for field in ['entry_inventory_sha256', 'sense_set_sha256', 'example_set_sha256']:
            require(digest_ok(manifest[field]), 'invalid_manifest_identity_hash')
        result.append({'release': ident, 'lexemes': manifest['lexemes'], 'shards': len(shards),
                       'indexObjects': len(objects), 'routes': len(search['routes']),
                       'logicalTerms': search['logicalTerms'], 'manifestSha': row['manifestSha'],
                       'compressedBytes': sum(s['compressed_bytes'] for s in shards + objects)})
    return {'status': 'PASS', 'scope': 'captured_metadata_only', 'r2BytesVerified': False,
            'channel': channel, 'releases': result}


def percentile(values, q):
    require(bool(values), 'empty_latency_sample')
    require(all(type(v) in (int, float) and math.isfinite(v) and v >= 0 for v in values),
            'invalid_latency_sample')
    return sorted(values)[max(0, math.ceil(len(values) * q) - 1)]


def score(samples):
    require(bool(samples), 'empty_benchmark')
    latencies = [s['ms'] for s in samples]
    failures = sum(not s['pass'] for s in samples)
    return {'requests': len(samples), 'failures': failures,
            'successRate': (len(samples)-failures)/len(samples),
            'p50Ms': percentile(latencies, .50), 'p95Ms': percentile(latencies, .95),
            'p99Ms': percentile(latencies, .99)}


def compare_benchmarks(before, after):
    for key in ['release', 'querySetSha', 'cohort', 'network', 'apiBase']:
        require(bool(before.get(key)) and before.get(key) == after.get(key), 'incomparable_' + key)
    require(before.get('stage') == 'before' and after.get('stage') == 'after', 'invalid_benchmark_stage')
    cohorts = {}
    for temperature in ['observed_first_pass', 'warm']:
        b = [s for s in before['samples'] if s['temperature'] == temperature]
        a = [s for s in after['samples'] if s['temperature'] == temperature]
        require(len(a) >= 100 and len(b) >= 100, 'insufficient_benchmark_samples')
        require([s['case'] for s in a] == [s['case'] for s in b], 'query_order_changed')
        bs, ass = score(b), score(a)
        require(all(s['pass'] for s in b + a), 'benchmark_request_or_parity_failure')
        require([s['responseSha'] for s in b] == [s['responseSha'] for s in a],
                'response_parity_mismatch')
        require(ass['p95Ms'] <= bs['p95Ms'] * 1.10, 'p95_regression')
        require(ass['successRate'] >= bs['successRate'], 'error_rate_regression')
        cohorts[temperature] = {'before': bs, 'after': ass}
    return {'status': 'PASS', 'cohorts': cohorts,
            'coldStartVerified': False, 'note': 'First pass does not prove an empty edge/isolate cache.'}


def gates(audit, inventory_result, attestations, receipt_root=Path('.')):
    """Absent evidence is BLOCKED. A successful fixture run is not a production measurement."""
    baseline = audit['baseline']
    dependency = audit['dependencyAudit']
    terms = audit['termAudit']['terms']
    stable = next(c for c in baseline['channels'] if c['name'] == 'stable')
    checks = {
        'metadata_integrity': inventory_result.get('status') == 'PASS',
        'no_running_publish': all(j['phase'] in ('complete', 'failed') for j in baseline['jobs']),
        'all_terms_legacy_only': len(terms) == 2 and {t['release_id'] for t in terms} == {LEGACY}
          and {t['direction'] for t in terms} == {'EN', 'UZ'}
          and sum(t['terms'] for t in terms) == 1201156,
        'legacy_not_protected': LEGACY not in (stable['active_release_id'], stable['previous_release_id'])
          and dependency['legacyReferencedByChannels'] == 0
          and dependency['legacyReferencedByJobs'] == 0,
        'no_inbound_fk': not any(c['type'] == 'f' and c['referenced'] == 'dictionary_search_terms'
                                for c in audit['termAudit']['constraints']),
        'rls_preserved': all(t['enabled'] and not t['anonSelect'] and not t['authenticatedSelect']
                             for t in dependency['rls']),
    }
    # These require separate real artifacts. Booleans in this document cannot substitute for receipts.
    for name in ['current_r2_object_checks', 'functional_en_uz', 'authenticated_api_parity',
                 'comparable_performance', 'actual_cold_start', 'worker_error_rate',
                 'private_backup_restore', 'worker_version_config_snapshot',
                 'legacy_reader_decommission', 'maintenance_rehearsal', 'explicit_cleanup_approval']:
        receipt = attestations.get(name, {})
        checks[name] = False
        if (receipt.get('status') == 'PASS' and receipt.get('artifact')
                and digest_ok(receipt.get('sha256')) and receipt.get('measuredAt')):
            artifact = Path(receipt_root)/receipt['artifact']
            if artifact.is_file():
                body = artifact.read_bytes()
                checks[name] = (sha(body) == receipt['sha256'] and json.loads(body).get('status') == 'PASS')
    return {'status': 'READY_FOR_REVIEW' if all(checks.values()) else 'BLOCKED',
            'checks': checks, 'blocked': [k for k, v in checks.items() if not v],
            'productionMutationPerformed': False,
            'note': 'This tool never executes SQL. Receipts must be independently reviewed before any cleanup.'}


def validate_api_origin(api_base, cookie_env):
    parsed = urlsplit(api_base)
    require(parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password
            and not parsed.query and not parsed.fragment and parsed.path == '' and parsed.port in (None, 443),
            'invalid_api_origin')
    if api_base != 'https://learnersarea.uz':
        require(api_base == os.environ.get('LA_APPROVED_QA_ORIGIN')
                and cookie_env == 'LA_EXISTING_QA_SESSION_COOKIE', 'unapproved_qa_origin_or_session')


async def benchmark(args):
    import httpx
    validate_api_origin(args.api_base, args.cookie_env)
    cookie = os.environ.get(args.cookie_env, '')
    require(cookie, 'existing_authenticated_session_required')
    cases = load(args.cases)
    require(cases and all(c['direction'] in ('EN', 'UZ') and len(c['query']) <= 80 for c in cases),
            'invalid_query_cases')
    samples = []
    async with httpx.AsyncClient(timeout=15, follow_redirects=False,
                                 headers={'Cookie': cookie}) as client:
        for temperature in ['observed_first_pass', 'warm']:
            for i in range(args.requests):
                case = cases[i % len(cases)]
                start = time.perf_counter()
                try:
                    response = await client.get(args.api_base+'/api/dictionary/search',
                         params={'q': case['query'], 'direction': case['direction'], 'release_id': args.release})
                    body = response.json()
                    results = body.get('results', [])
                    passed = (response.status_code == 200 and body.get('release_id') == args.release
                              and isinstance(results, list) and len(results) <= 20
                              and all({'lexeme_id', 'display_lemma', 'part_of_speech',
                                       'translation_uz', 'match_type'} <= set(r) for r in results)
                              and 'private' in response.headers.get('cache-control', '')
                              and 'no-store' in response.headers.get('cache-control', ''))
                    if case.get('expectedId'):
                        passed = passed and any(r['lexeme_id'] == case['expectedId'] for r in results)
                    if case.get('empty'):
                        passed = passed and not results
                    result_hash = sha(canonical(body))
                    status = response.status_code
                except Exception as exc:
                    passed, result_hash, status = False, type(exc).__name__, None
                samples.append({'case': i % len(cases), 'temperature': temperature,
                     'ms': (time.perf_counter()-start)*1000, 'pass': passed,
                     'status': status, 'responseSha': result_hash})
                # Maximum 240 requests/minute, below the existing 300/minute per-user policy.
                await asyncio.sleep(.25)
    value = {'stage': args.stage, 'release': args.release, 'querySetSha': sha(canonical(cases)),
             'apiBase': args.api_base, 'cohort': args.cohort, 'network': args.network,
             'measuredAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'samples': samples,
             'actualColdStart': 'NOT_MEASURED', 'workerR2RequestCount': 'NOT_OBSERVED',
             'workerErrorRate': 'NOT_OBSERVED', 'coldWarmCacheState': 'NOT_FORCED'}
    save(args.out, value)
    return {'output': args.out, 'score': score(samples)}


async def verify_r2(args):
    """Reuses existing credentials and immutable readers; never writes an R2 object."""
    inventory = load(args.inventory)
    validate_inventory(inventory)
    database = urlsplit(os.environ.get('DATABASE_URL', ''))
    require(database.scheme in ('postgres', 'postgresql') and
            (database.hostname == 'db.'+PROD+'.supabase.co' or
             (database.username or '').endswith('.'+PROD)), 'production_database_identity_required')
    root = Path(args.repo).resolve()
    sys.path.insert(0, str(root/'services/backend'))
    from app.step40_dictionary_storage import read_shard, read_immutable, index_key, manifest_key, decompress_bounded
    from app.step39_dictionary_publish import content_hash
    from app import main as core
    db = await core.pool()
    total_reads = total_bytes = checked_entries = 0
    async with db.acquire() as con:
        async with con.transaction(readonly=True, isolation='repeatable_read'):
            current = await con.fetchrow("SELECT active_release_id,previous_release_id FROM dictionary_channels WHERE name='stable'")
            channel = inventory['channels'][0]
            require(all(current[k] == channel[k] for k in ['active_release_id', 'previous_release_id']),
                    'channel_changed_since_snapshot')
            require(not await con.fetchval("SELECT 1 FROM dictionary_publish_jobs WHERE phase NOT IN ('complete','failed') LIMIT 1"),
                    'publish_in_progress')
            for release in inventory['releases']:
                ident, manifest = release['id'], release['manifest']
                require(await con.fetchval('SELECT manifest_sha FROM dictionary_releases WHERE id=$1', ident)
                        == release['manifestSha'], 'live_manifest_changed')
                for descriptor in manifest['storage']['shards']:
                    records = await read_shard(ident, descriptor)
                    rows = await con.fetch('SELECT lexeme_id,content_sha,sense_ids,example_ids FROM dictionary_entries WHERE release_id=$1 AND storage_shard=$2',
                                           ident, descriptor['shard'])
                    by_id = {str(r['lexeme_id']): r for r in rows}
                    require(len(records) == len(rows), 'projection_count_mismatch')
                    seen = set()
                    for entry in records:
                        uid = entry['lexeme_id']
                        require(uid not in seen and uid in by_id, 'unexpected_or_duplicate_entry')
                        seen.add(uid)
                        row = by_id[uid]
                        require(content_hash(entry) == row['content_sha'], 'entry_hash_mismatch')
                        require([s['sense_id'] for s in entry['senses']] == [str(s) for s in row['sense_ids']],
                                'sense_identity_mismatch')
                        require([e['example_id'] for s in entry['senses'] for e in s['examples']]
                                == [str(e) for e in row['example_ids']], 'example_identity_mismatch')
                    checked_entries += len(records)
                    total_reads += 1
                    total_bytes += descriptor['compressed_bytes']
                objects = manifest['storage']['search']['objects']
                for start in range(0, len(objects), 8):
                    batch = objects[start:start+8]
                    bodies = await asyncio.gather(*(read_immutable(index_key(ident, d['name']), d['compressed_bytes']) for d in batch))
                    for d, body in zip(batch, bodies):
                        require(sha(body) == d['sha256'], 'index_checksum_mismatch')
                        raw = decompress_bounded(body, d['raw_bytes'])
                        require(len(raw) == d['raw_bytes'] and sha(raw) == d['raw_sha256'], 'index_raw_checksum_mismatch')
                        require(json.loads(raw)['release_id'] == ident, 'index_release_mismatch')
                        total_reads += 1
                        total_bytes += len(body)
                body = await read_immutable(manifest_key(ident), 2*1024*1024)
                require(sha(body) == release['manifestSha'], 'remote_manifest_mismatch')
                total_reads += 1
                total_bytes += len(body)
        # Read outside the snapshot so a concurrent publish/rollback invalidates this receipt.
        current = await con.fetchrow("SELECT active_release_id,previous_release_id FROM dictionary_channels WHERE name='stable'")
        require(all(current[k] == channel[k] for k in ['active_release_id', 'previous_release_id']),
                'channel_changed_during_verification')
        require(not await con.fetchval("SELECT 1 FROM dictionary_publish_jobs WHERE phase NOT IN ('complete','failed') LIMIT 1"),
                'publish_started_during_verification')
    result = {'status': 'PASS', 'project': PROD, 'entries': checked_entries,
              'logicalReadCalls': total_reads, 'actualR2HttpRequestCount': 'NOT_OBSERVED',
              'compressedBytesRead': total_bytes, 'inventorySha256': sha(canonical(inventory)),
              'measuredAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    save(args.out, result)
    return result


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    commands = p.add_subparsers(dest='command', required=True)
    inv = commands.add_parser('inventory')
    inv.add_argument('--inventory', required=True)
    inv.add_argument('--out', required=True)
    gate = commands.add_parser('gates')
    gate.add_argument('--audit', required=True)
    gate.add_argument('--inventory-result', required=True)
    gate.add_argument('--attestations', required=True)
    gate.add_argument('--out', required=True)
    compare = commands.add_parser('compare')
    compare.add_argument('--before', required=True)
    compare.add_argument('--after', required=True)
    compare.add_argument('--out', required=True)
    bench = commands.add_parser('benchmark')
    bench.add_argument('--api-base', default='https://learnersarea.uz')
    bench.add_argument('--cookie-env', default='LA_EXISTING_SESSION_COOKIE')
    bench.add_argument('--cases', required=True)
    bench.add_argument('--release', required=True)
    bench.add_argument('--stage', choices=['before', 'after'], required=True)
    bench.add_argument('--cohort', required=True)
    bench.add_argument('--network', required=True)
    bench.add_argument('--requests', type=int, default=120)
    bench.add_argument('--out', required=True)
    r2 = commands.add_parser('verify-r2')
    r2.add_argument('--repo', required=True)
    r2.add_argument('--inventory', required=True)
    r2.add_argument('--out', required=True)
    return p


def main():
    args = parser().parse_args()
    if args.command == 'inventory':
        result = validate_inventory(load(args.inventory))
    elif args.command == 'gates':
        result = gates(load(args.audit), load(args.inventory_result), load(args.attestations),
                       Path(args.attestations).parent)
    elif args.command == 'compare':
        result = compare_benchmarks(load(args.before), load(args.after))
    elif args.command == 'benchmark':
        require(args.requests >= 100, 'insufficient_benchmark_samples')
        result = asyncio.run(benchmark(args))
    else:
        result = asyncio.run(verify_r2(args))
    if args.command not in ('benchmark', 'verify-r2'):
        save(args.out, result)
    print(json.dumps(result, ensure_ascii=False))
    return 2 if result.get('status') == 'BLOCKED' else 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        # Never print exception messages that may contain connection strings or cookies.
        print(json.dumps({'status': 'FAILED', 'errorType': type(exc).__name__}), file=sys.stderr)
        raise SystemExit(1)
