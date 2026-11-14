"""Offline preparation must fail closed and never masquerade as editorial review."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

from app.step40_dictionary_storage import encode_shard

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('audit_accelerator', ROOT / 'tools/dictionary-optimization/scripts/audit_accelerator.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
RELEASE = 'rel-v1-1fa06d8d41d8ff701632573e'


def source():
    data = json.loads((ROOT / 'content/dictionary/audit-20261113-phase09-source-enrichment-selected-0090-0127.json').read_text())
    return copy.deepcopy(data['lexemes'][0])


def fixture(tmp_path):
    repo, cache = tmp_path / 'repo', tmp_path / 'cache'
    (repo / 'content/dictionary').mkdir(parents=True)
    (repo / 'services/backend/assets/dictionary').mkdir(parents=True)
    cache.mkdir()
    original = source()
    body, descriptor, _ = encode_shard(RELEASE, [original], packed=True)
    name = 'content/dictionary/audit-fixture.json'
    receipt = repo / name
    receipt.write_text(json.dumps({'source_release': RELEASE, 'lexemes': [original], 'descriptor': descriptor}))
    (repo / 'services/backend/assets/dictionary/sense_corrections.json').write_bytes((ROOT / 'services/backend/assets/dictionary/sense_corrections.json').read_bytes())
    shard = cache / (descriptor['shard'] + '.json.gz')
    shard.write_bytes(body)
    return repo, cache, receipt, shard, name


def test_authenticated_index_and_pack_never_increment_editorial_or_source_coverage(tmp_path):
    repo, cache, _, shard, name = fixture(tmp_path)
    original_bytes = shard.read_bytes()
    database = tmp_path / 'offline.sqlite'
    result = a.build_index(repo, cache, database, RELEASE)
    proof = tmp_path / 'index.json'
    proof.write_text(json.dumps(result))
    packet = tmp_path / 'packet.json'
    summary = a.export_pack(repo, database, proof, name, packet)
    assert result['indexed'] == {'shards': 1, 'lexemes': 1, 'senses': 1}
    assert result['new_editorial_senses_certified'] == summary['new_editorial_senses_certified'] == 0
    assert result['new_source_coverage_counted'] == summary['new_source_coverage_counted'] == 0
    assert summary['review_status'] == 'prepared_context_only_no_editorial_signoff'
    assert shard.read_bytes() == original_bytes
    assert hashlib.sha256(database.read_bytes()).hexdigest() == result['index_sha256']
    assert summary['scope']['requested_senses'] == 1


def test_corrupted_shard_cannot_replace_an_existing_good_offline_index(tmp_path):
    repo, cache, _, shard, _ = fixture(tmp_path)
    database = tmp_path / 'offline.sqlite'
    a.build_index(repo, cache, database, RELEASE)
    before = database.read_bytes()
    body = bytearray(shard.read_bytes())
    body[-9] ^= 1
    shard.write_bytes(body)
    with pytest.raises(ValueError, match='checksum_mismatch'):
        a.build_index(repo, cache, database, RELEASE)
    assert database.read_bytes() == before
    assert not list(tmp_path.glob('*.tmp'))


def test_modified_index_is_rejected_before_export(tmp_path):
    repo, cache, _, _, name = fixture(tmp_path)
    database = tmp_path / 'offline.sqlite'
    proof = tmp_path / 'index.json'
    proof.write_text(json.dumps(a.build_index(repo, cache, database, RELEASE)))
    database.write_bytes(database.read_bytes() + b'changed')
    out = tmp_path / 'packet.json'
    with pytest.raises(ValueError, match='offline_index_checksum_mismatch'):
        a.export_pack(repo, database, proof, name, out)
    assert not out.exists()


def test_compact_context_preserves_requested_meanings_and_lexical_fields_without_examples(tmp_path):
    repo, cache, _, _, name = fixture(tmp_path)
    database, proof = tmp_path / 'offline.sqlite', tmp_path / 'index.json'
    proof.write_text(json.dumps(a.build_index(repo, cache, database, RELEASE)))
    full, compact = tmp_path / 'full.json', tmp_path / 'compact.json'
    a.export_pack(repo, database, proof, name, full)
    a.export_pack(repo, database, proof, name, compact, compact=True)
    data, small = json.loads(full.read_text()), json.loads(compact.read_text())
    requested = {(r['lexeme_id'], sid) for r in data['entries'] for sid in r['requested_sense_ids']}
    assert requested == {(s['lexeme_id'], s['sense_id']) for s in small['senses']}
    record = data['entries'][0]
    row = small['senses'][0]
    original = next(s for s in record['original_entry']['senses'] if s['sense_id'] == row['sense_id'])
    current = next(s for s in record['candidate_entry']['senses'] if s['sense_id'] == row['sense_id'])
    assert row['original'] == {'en': original['definition_en'], 'uz': original['definition_uz'],
                               'translations': [t['text'] for t in original['translations']], 'cefr': original.get('cefr')}
    assert row['candidate_changes'] == {k: current.get(k) for k in ('definition_en', 'definition_uz', 'translations', 'cefr') if original.get(k) != current.get(k)}
    assert row['candidate_links'] == {k: record['candidate_presentation']['senses'][row['sense_id']][k] for k in ('synonyms', 'antonyms', 'collocations')}
    assert row['meaning_sha'] == record['meaning_hashes'][row['sense_id']]
    assert all('examples' not in s for s in small['senses'])
    assert small['new_editorial_senses_certified'] == 0


def test_compact_context_records_previously_removed_sense_without_first_sense_fallback():
    from app.dictionary_sense_curation import original_meaning_hash
    original = source()
    sense = original['senses'][0]
    packet = {'source_release': RELEASE, 'entries': [{'original_entry': original,
        'candidate_entry': dict(original, senses=[]), 'requested_sense_ids': [sense['sense_id']],
        'meaning_hashes': {sense['sense_id']: original_meaning_hash(original, sense)},
        'candidate_presentation': {'senses': {}}, 'relation_structure_checks': []}], 'target_entries': []}
    result = a.compact_context(packet)
    row = result['senses'][0]
    assert row['sense_id'] == sense['sense_id'] and row['original']['en'] == sense['definition_en']
    assert row['candidate_present'] is False and row['candidate_changes'] == {}
    assert row['candidate_links'] == {'synonyms': [], 'antonyms': [], 'collocations': []}


@pytest.mark.parametrize('change', [None, 'content_inventory', 'offset_inventory'])
def test_fresh_projection_requires_complete_content_and_offset_inventories(tmp_path, change):
    from app.dictionary_canonical import stable
    repo, cache, _, shard, _ = fixture(tmp_path)
    database, proof = tmp_path / 'offline.sqlite', tmp_path / 'index.json'
    proof.write_text(json.dumps(a.build_index(repo, cache, database, RELEASE)))
    original = source()
    raw_bytes = len(stable(original).encode()) + 1
    content_sha = a.digest(stable({k: v for k, v in original.items() if k != 'release_id'}).encode())
    senses = sorted(s['sense_id'] for s in original['senses'])
    examples = sorted(e['example_id'] for s in original['senses'] for e in s['examples'])
    value = {'release_id': RELEASE, 'entries': 1, 'senses': len(senses), 'distinct_senses': len(set(senses)),
             'examples': len(examples), 'distinct_examples': len(set(examples)), 'invalid_storage_rows': 0,
             'entry_inventory_sha256': a.digest((original['lexeme_id'] + ':' + content_sha).encode()),
             'offset_inventory_sha256': a.digest(':'.join(map(str, (original['lexeme_id'], original['lexeme_id'][:2], 0, shard.stat().st_size, raw_bytes, RELEASE))).encode()),
             'sense_set_sha256': a.digest(json.dumps(senses, separators=(',', ':')).encode()),
             'example_set_sha256': a.digest(json.dumps(examples, separators=(',', ':')).encode())}
    if change:
        value['entry_inventory_sha256' if change == 'content_inventory' else 'offset_inventory_sha256'] = '0' * 64
    projection = tmp_path / 'projection.json'
    projection.write_text(json.dumps(value))
    if change:
        with pytest.raises(ValueError, match='fresh_database_source_projection_mismatch'):
            a.verify_projection(repo, database, proof, projection, cache)
    else:
        result = a.verify_projection(repo, database, proof, projection, cache)
        assert result['status'] == 'PASS'
        assert result['new_editorial_senses_certified'] == 0 and result['full_linguistic_signoff'] is False
        assert result['example_identity_only_not_editorial_review'] is True


@pytest.mark.parametrize('change', ['different_release', 'conflicting_descriptor'])
def test_descriptor_identity_cannot_silently_drift(tmp_path, change):
    repo, cache, receipt, _, _ = fixture(tmp_path)
    value = json.loads(receipt.read_text())
    if change == 'different_release':
        value['source_release'] = 'rel-v1-' + '0' * 24
        receipt.write_text(json.dumps(value))
        error = 'no_authenticated_descriptor'
    else:
        value['descriptor']['sha256'] = 'f' * 64
        (receipt.parent / 'audit-conflict.json').write_text(json.dumps(value))
        error = 'conflicting_immutable_shard_descriptor'
    with pytest.raises(ValueError, match=error):
        a.build_index(repo, cache, tmp_path / 'offline.sqlite', RELEASE)


def relation_fixture():
    entry = source()
    target = copy.deepcopy(entry)
    target['lexeme_id'] = '12345678-1234-5234-8234-123456789abc'
    target['senses'][0]['sense_id'] = '12345678-1234-5234-8234-123456789abd'
    edge = dict(relation_type='synonym', target_lexeme_id=target['lexeme_id'],
                target_sense_id=target['senses'][0]['sense_id'], part_of_speech=target['part_of_speech'],
                display_lemma=target['display_lemma'], lexical_type=target['lexical_type'])
    return entry, edge, target


def test_unique_exact_gloss_suggestion_is_not_an_editorial_decision_or_mutation():
    entry, edge, target = relation_fixture()
    before = copy.deepcopy((entry, edge, target))
    proof = a.relation_proof(entry, edge, target)
    assert proof['status'] == 'unique_exact_pos_gloss_match_only'
    assert proof['proposed_source_sense_id'] == entry['senses'][0]['sense_id']
    assert proof['editorial_signoff'] is False and proof['candidate_mutated'] is False
    assert (entry, edge, target) == before


@pytest.mark.parametrize('change', ['uncached', 'no_target_sense', 'duplicate_source_gloss', 'wrong_source_scope', 'wrong_pos', 'antonym'])
def test_relation_preparation_never_guesses_first_or_ambiguous_senses(change):
    entry, edge, target = relation_fixture()
    if change == 'uncached':
        target = None
    elif change == 'no_target_sense':
        edge.pop('target_sense_id')
    elif change == 'duplicate_source_gloss':
        second = copy.deepcopy(entry['senses'][0])
        second['sense_id'] = '22345678-1234-5234-8234-123456789abc'
        entry['senses'].append(second)
    elif change == 'wrong_source_scope':
        edge['source_sense_id'] = '32345678-1234-5234-8234-123456789abc'
    elif change == 'wrong_pos':
        target['part_of_speech'] = 'n'
    else:
        edge['relation_type'] = 'antonym'
    proof = a.relation_proof(entry, edge, target)
    assert proof['status'] != 'unique_exact_pos_gloss_match_only'
    assert 'proposed_source_sense_id' not in proof
    assert proof['editorial_signoff'] is False


def test_accelerated_synonym_edits_have_complete_exact_source_target_proofs():
    from app import dictionary_sense_curation as curation
    from app.dictionary_canonical import stable
    path = ROOT / 'content/dictionary/audit-20261113-phase09-relation-scope-accelerated-first200.json'
    receipt = json.loads(path.read_text())
    sources = {e['lexeme_id']: e for e in receipt['source_entries']}
    targets = {e['lexeme_id']: e for e in receipt['target_entries']}
    decisions = receipt['scope_decisions']
    assert receipt['scope']['synonym_edges_scoped'] == len(decisions) == 115
    assert receipt['scope']['fully_seven_field_reviewed_senses_added'] == 0
    assert receipt['new_editorial_senses_certified'] == 0 and receipt['full_linguistic_signoff'] is False
    assert len(sources) == receipt['scope']['source_lexemes'] == 48
    assert len({(d['source_lexeme_id'], d['source_sense_id']) for d in decisions}) == receipt['scope']['source_senses'] == 73
    for entry in list(sources.values()) + list(targets.values()):
        assert hashlib.sha256(stable({k: v for k, v in entry.items() if k != 'release_id'}).encode()).hexdigest() == receipt['entry_content_shas'][entry['lexeme_id']]
    for d in decisions:
        original, target = sources[d['source_lexeme_id']], targets[d['target_lexeme_id']]
        source_sense = next(s for s in original['senses'] if s['sense_id'] == d['source_sense_id'])
        target_sense = next(s for s in target['senses'] if s['sense_id'] == d['target_sense_id'])
        assert original['part_of_speech'] == target['part_of_speech']
        assert source_sense['definition_en'] == target_sense['definition_en'] == d['source_definition_en'] == d['target_definition_en']
        assert curation.original_meaning_hash(original, source_sense) == d['source_meaning_sha']
        assert curation.original_meaning_hash(target, target_sense) == d['target_meaning_sha']
        assert sum(s['definition_en'] == target_sense['definition_en'] for s in original['senses']) == 1
        proof = a.relation_proof(original, d['original_edge'], target)
        assert proof['status'] == 'unique_exact_pos_gloss_match_only'
        assert proof['proposed_source_sense_id'] == source_sense['sense_id']
        candidate = curation.curate_candidate_entry(original)
        actual = [r for r in candidate['relations'] if r['relation_type'] == 'synonym' and r['target_lexeme_id'] == target['lexeme_id'] and r.get('target_sense_id') == target_sense['sense_id']]
        assert len(actual) == 1 and actual[0]['source_sense_id'] == source_sense['sense_id']
        assert [s['examples'] for s in candidate['senses']] == [s['examples'] for s in original['senses']]
