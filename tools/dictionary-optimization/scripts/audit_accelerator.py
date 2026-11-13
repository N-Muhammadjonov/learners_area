"""Offline audit preparation; never certifies editorial quality or changes source data.

Reuses the application's strict immutable decoder, canonical hashes and candidate
curation. SQLite is a disposable audit-only cache, not a production database.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

FIELDS = {'shard', 'sha256', 'raw_sha256', 'compressed_bytes', 'raw_bytes', 'entries'}


def digest(body):
    return hashlib.sha256(body).hexdigest()


def runtime(repo):
    sys.path.insert(0, str(Path(repo) / 'services/backend'))
    from app.step40_dictionary_storage import decode_shard
    from app.dictionary_canonical import stable
    from app import dictionary_sense_curation as curation
    from app import dictionary_presentation
    return decode_shard, stable, curation, dictionary_presentation


def collect_descriptors(repo, release):
    """Keep the exact committed receipt and JSON pointer behind each descriptor."""
    result = {}

    def walk(value, pointer, proof):
        if isinstance(value, dict):
            if FIELDS <= value.keys() and re.fullmatch(r'[a-f0-9]{2}', str(value['shard'])):
                descriptor = {k: v for k, v in value.items() if k in FIELDS | {'format'}}
                previous = result.get(value['shard'])
                if previous and previous['descriptor'] != descriptor:
                    raise ValueError('conflicting_immutable_shard_descriptor')
                result.setdefault(value['shard'], dict(proof, pointer=pointer, descriptor=descriptor))
            for key, part in value.items():
                walk(part, pointer + '/' + str(key).replace('~', '~0').replace('/', '~1'), proof)
        elif isinstance(value, list):
            for index, part in enumerate(value):
                walk(part, pointer + '/' + str(index), proof)

    repo = Path(repo)
    for path in sorted((repo / 'content/dictionary').glob('audit-*.json')):
        body = path.read_bytes()
        value = json.loads(body)
        if value.get('source_release') == release and value.get('scope') != 'authenticated_cached_source_index_only':
            walk(value, '', {'receipt': str(path.relative_to(repo)), 'receipt_sha256': digest(body)})
    return result


def reviewed_senses(repo, release):
    reviewed = {}
    for path in sorted((Path(repo) / 'content/dictionary').glob('audit-*-phase*-lexical-decisions-*.json')):
        ledger = json.loads(path.read_bytes())
        if ledger['source_release'] != release:
            continue
        for row in ledger['senses']:
            if not row.get('lexical_field_review_complete'):
                continue
            key = (row['lexeme_id'], row['sense_id'])
            if key in reviewed:
                raise ValueError('duplicate_editorial_sense_count')
            reviewed[key] = row['meaning_sha']
    return reviewed


def build_index(repo, cache_dir, database, release):
    started = time.perf_counter()
    repo, cache_dir, database = Path(repo), Path(cache_dir), Path(database)
    decode, stable, curation, _ = runtime(repo)
    descriptors = collect_descriptors(repo, release)
    caches = sorted(p for p in cache_dir.glob('*.json.gz') if re.fullmatch(r'[a-f0-9]{2}\.json\.gz', p.name))
    if not caches:
        raise ValueError('no_cached_immutable_shards')
    database.parent.mkdir(parents=True, exist_ok=True)
    # Publish only a fully validated index. On error the old cache is untouched.
    with tempfile.NamedTemporaryFile(prefix=database.name + '.', suffix='.tmp', dir=database.parent, delete=False) as tmp:
        temporary = Path(tmp.name)
    con = sqlite3.connect(temporary)
    proofs = []
    try:
        con.executescript('''
            CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE shards (shard TEXT PRIMARY KEY, proof TEXT NOT NULL);
            CREATE TABLE lexemes (lexeme_id TEXT PRIMARY KEY, lemma TEXT NOT NULL, pos TEXT NOT NULL,
                shard TEXT NOT NULL, content_sha TEXT NOT NULL, entry_json TEXT NOT NULL);
            CREATE TABLE senses (sense_id TEXT PRIMARY KEY, lexeme_id TEXT NOT NULL,
                meaning_sha TEXT NOT NULL, definition_en TEXT NOT NULL, pos TEXT NOT NULL);
            CREATE INDEX senses_by_lexeme ON senses(lexeme_id);
            CREATE INDEX senses_by_exact_gloss ON senses(pos, definition_en);
        ''')
        con.execute('INSERT INTO metadata VALUES (?,?)', ('release', release))
        for path in caches:
            shard = path.name[:2]
            if shard not in descriptors:
                raise ValueError('cached_shard_has_no_authenticated_descriptor')
            proof = descriptors[shard]
            entries = decode(release, proof['descriptor'], path.read_bytes())
            con.execute('INSERT INTO shards VALUES (?,?)', (shard, json.dumps(proof, ensure_ascii=False)))
            for entry in entries:
                content_sha = digest(stable({k: v for k, v in entry.items() if k != 'release_id'}).encode())
                con.execute('INSERT INTO lexemes VALUES (?,?,?,?,?,?)',
                            (entry['lexeme_id'], entry['display_lemma'], entry['part_of_speech'], shard,
                             content_sha, json.dumps(entry, ensure_ascii=False, separators=(',', ':'))))
                con.executemany('INSERT INTO senses VALUES (?,?,?,?,?)',
                                [(s['sense_id'], entry['lexeme_id'], curation.original_meaning_hash(entry, s),
                                  s['definition_en'], entry['part_of_speech']) for s in entry['senses']])
            proofs.append({'shard': shard, **proof})
        con.commit()
        if con.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('offline_index_integrity_failure')
        counts = {table: con.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]
                  for table in ('shards', 'lexemes', 'senses')}
        glosses = con.execute('SELECT COUNT(*) FROM (SELECT pos,definition_en FROM senses GROUP BY pos,definition_en)').fetchone()[0]
        result = {'schema': 1, 'status': 'PASS', 'source_release': release,
                  'scope': 'authenticated_cached_source_index_only', 'indexed': counts,
                  'distinct_pos_gloss_groups': glosses, 'elapsed_seconds': round(time.perf_counter() - started, 6),
                  'fresh_database_content_sha_comparison': 'NOT_RERUN_connector_unavailable',
                  'source_proofs': proofs, 'new_editorial_senses_certified': 0,
                  'new_source_coverage_counted': 0, 'production_mutation': False,
                  'full_linguistic_signoff': False, 'examples_audited': False}
        con.close()
        temporary.replace(database)
        result['index_sha256'] = digest(database.read_bytes())
        return result
    except BaseException:
        con.close()
        temporary.unlink(missing_ok=True)
        raise


def relation_proof(entry, edge, target):
    """Exact frozen identities/glosses help reviewers; they are not semantic signoff."""
    proof = {'relation_type': edge['relation_type'], 'target_lexeme_id': edge['target_lexeme_id'],
             'target_sense_id': edge.get('target_sense_id'), 'existing_source_sense_id': edge.get('source_sense_id'),
             'editorial_signoff': False, 'candidate_mutated': False}
    if target is None:
        return dict(proof, status='target_not_in_authenticated_cache')
    if (target['lexeme_id'], target['part_of_speech'], target['display_lemma'], target['lexical_type']) != (
            edge['target_lexeme_id'], edge['part_of_speech'], edge['display_lemma'], edge['lexical_type']):
        return dict(proof, status='target_identity_mismatch')
    senses = [s for s in target['senses'] if s['sense_id'] == edge.get('target_sense_id')]
    if len(senses) != 1:
        return dict(proof, status='exact_target_sense_missing_no_fallback')
    target_sense = senses[0]
    proof['target_definition_en'] = target_sense['definition_en']
    if edge['relation_type'] != 'synonym':
        return dict(proof, status='antonym_requires_separate_semantic_evidence')
    matches = [s['sense_id'] for s in entry['senses'] if s['definition_en'] == target_sense['definition_en']
               and entry['part_of_speech'] == target['part_of_speech']]
    if len(matches) != 1:
        return dict(proof, status='source_gloss_ambiguous_or_different', matching_source_sense_ids=matches)
    if edge.get('source_sense_id') not in (None, matches[0]):
        return dict(proof, status='existing_source_scope_conflicts_with_exact_gloss')
    return dict(proof, status='unique_exact_pos_gloss_match_only', proposed_source_sense_id=matches[0])


def compact_context(packet):
    """Deduplicate frozen/unchanged fields and exclude examples from lexical work."""
    from app import dictionary_sense_curation as curation
    senses, links, target_context = [], [], {}
    targets = {e['lexeme_id']: e for e in packet['target_entries']}
    current_targets = {ident: {s['sense_id']: s for s in curation.curate_candidate_entry(e)['senses']}
                       for ident, e in targets.items()}
    for record in packet['entries']:
        original, candidate = record['original_entry'], record['candidate_entry']
        current = {s['sense_id']: s for s in candidate['senses']}
        for old in original['senses']:
            sid = old['sense_id']
            if sid not in record['requested_sense_ids']:
                continue
            now = current[sid]
            changes = {key: now.get(key) for key in ('definition_en', 'definition_uz', 'translations', 'cefr') if old.get(key) != now.get(key)}
            view = record['candidate_presentation']['senses'][sid]
            senses.append({'lexeme_id': original['lexeme_id'], 'sense_id': sid,
                           'lemma': original['display_lemma'], 'pos': original['part_of_speech'],
                           'meaning_sha': record['meaning_hashes'][sid],
                           'original': {'en': old['definition_en'], 'uz': old['definition_uz'],
                                        'translations': [t['text'] for t in old['translations']], 'cefr': old.get('cefr')},
                           'candidate_changes': changes,
                           'candidate_links': {key: view[key] for key in ('synonyms', 'antonyms', 'collocations')}})
        for proof in record['relation_structure_checks']:
            links.append(dict(proof, source_lexeme_id=original['lexeme_id']))
            target = targets.get(proof['target_lexeme_id'])
            if target is not None:
                for s in target['senses']:
                    if s['sense_id'] == proof.get('target_sense_id'):
                        target_context[s['sense_id']] = {'lexeme_id': target['lexeme_id'], 'lemma': target['display_lemma'],
                            'pos': target['part_of_speech'], 'en': s['definition_en'], 'uz': s['definition_uz'],
                            'translations': [t['text'] for t in s['translations']],
                            'meaning_sha': curation.original_meaning_hash(target, s),
                            'candidate_changes': {k: current_targets[target['lexeme_id']][s['sense_id']].get(k)
                                for k in ('definition_en', 'definition_uz', 'translations', 'cefr')
                                if s.get(k) != current_targets[target['lexeme_id']][s['sense_id']].get(k)}}
    return dict({k: v for k, v in packet.items() if k not in ('entries', 'target_entries')},
                format='compact_lexical_context_v1', senses=senses, relation_structure_checks=links,
                exact_target_senses=target_context,
                omission_note='Examples deferred. Full original entries, attribution and shard proofs remain in the checksum-bound audit-only SQLite index; unchanged candidate fields inherit original values.')


def export_pack(repo, database, index_receipt, source_receipt, out, limit=250, compact=False):
    """Prepare originals, current candidates and exact target contexts in one read."""
    if not 1 <= limit <= 1000:
        raise ValueError('sense_pack_limit_out_of_bounds')
    started = time.perf_counter()
    repo, database, out = Path(repo), Path(database), Path(out)
    index_proof = json.loads(Path(index_receipt).read_bytes())
    if index_proof.get('status') != 'PASS' or index_proof.get('index_sha256') != digest(database.read_bytes()):
        raise ValueError('offline_index_checksum_mismatch')
    _, _, curation, presentation = runtime(repo)
    candidate_bytes = (repo / 'services/backend/assets/dictionary/sense_corrections.json').read_bytes()
    if candidate_bytes != curation.CORRECTIONS_PATH.read_bytes():
        raise ValueError('candidate_runtime_asset_mismatch')
    con = sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        release = con.execute('SELECT value FROM metadata WHERE key=?', ('release',)).fetchone()[0]
        if index_proof['source_release'] != release:
            raise ValueError('offline_index_release_mismatch')
        source_path = repo / source_receipt
        source_bytes = source_path.read_bytes()
        source = json.loads(source_bytes)
        if source['source_release'] != release:
            raise ValueError('source_receipt_release_mismatch')
        if len({e['lexeme_id'] for e in source['lexemes']}) != len(source['lexemes']):
            raise ValueError('duplicate_source_receipt_lexeme')
        reviewed = reviewed_senses(repo, release)
        curation.load_corrections.cache_clear()
        presentation.sense_corrections.cache_clear()
        records, targets, missing = [], {}, []
        requested = 0
        # The receipt's stable order is preserved; complete lexemes stay together.
        for archived in source['lexemes']:
            lexeme_id = archived['lexeme_id']
            row = con.execute('SELECT entry_json,content_sha,shard FROM lexemes WHERE lexeme_id=?', (lexeme_id,)).fetchone()
            if row is None:
                missing.append(lexeme_id)
                continue
            entry = json.loads(row[0])
            archived_senses = archived.get('sense_ids', [s['sense_id'] for s in archived.get('senses', [])])
            if archived_senses and set(archived_senses) != {s['sense_id'] for s in entry['senses']}:
                raise ValueError('archived_source_sense_identity_mismatch')
            selected = []
            for sense in entry['senses']:
                known = reviewed.get((lexeme_id, sense['sense_id']))
                if known and known != curation.original_meaning_hash(entry, sense):
                    raise ValueError('reviewed_source_meaning_drift')
                if not known:
                    selected.append(sense['sense_id'])
            if not selected:
                continue
            candidate = curation.curate_candidate_entry(entry)
            links = []
            for edge in entry['relations']:
                if edge['relation_type'] not in ('synonym', 'antonym'):
                    continue
                ident = edge['target_lexeme_id']
                target = targets.get(ident)
                if target is None:
                    target_row = con.execute('SELECT entry_json FROM lexemes WHERE lexeme_id=?', (ident,)).fetchone()
                    if target_row:
                        target = json.loads(target_row[0])
                        targets[ident] = target
                links.append(relation_proof(entry, edge, target))
            records.append({'lexeme_id': lexeme_id, 'requested_sense_ids': selected,
                            'source_content_sha': row[1], 'source_shard': row[2], 'original_entry': entry,
                            'candidate_entry': candidate, 'candidate_presentation': presentation.present(candidate),
                            'meaning_hashes': {s['sense_id']: curation.original_meaning_hash(entry, s) for s in entry['senses']},
                            'relation_structure_checks': links})
            requested += len(selected)
            if requested >= limit:
                break
        result = {'schema': 1, 'source_release': release, 'visibility': 'audit_only_not_dictionary_content',
                  'scope': {'lexemes': len(records), 'requested_senses': requested, 'cached_target_lexemes': len(targets)},
                  'source_receipt': str(source_receipt), 'source_receipt_sha256': digest(source_bytes),
                  'source_index_sha256': digest(database.read_bytes()),
                  'candidate_asset_sha256': digest(candidate_bytes),
                  'presentation_manifest_sha256': digest((presentation.ROOT / 'manifest.json').read_bytes()),
                  'uncached_source_lexeme_ids': missing, 'entries': records, 'target_entries': list(targets.values()),
                  'elapsed_seconds': round(time.perf_counter() - started, 6),
                  'review_status': 'prepared_context_only_no_editorial_signoff',
                  'new_editorial_senses_certified': 0, 'new_source_coverage_counted': 0,
                  'production_mutation': False, 'examples_audited': False}
        if compact:
            result = compact_context(result)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        return dict({k: v for k, v in result.items() if k not in ('entries', 'target_entries', 'uncached_source_lexeme_ids', 'senses', 'relation_structure_checks', 'exact_target_senses')},
                    uncached_source_count=len(missing))
    finally:
        con.close()
