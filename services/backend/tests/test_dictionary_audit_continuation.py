"""Frozen-source continuation and exact relation-scoping regressions."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import pytest

from app import dictionary_sense_curation as curation
from app.dictionary_canonical import stable
from app.dictionary_presentation import corrected_sense_presentation, present

ROOT = Path(__file__).resolve().parents[3]
RECEIPT = ROOT / 'content/dictionary/audit-20261113-phase09-lexemes-1701-1730.json'


def receipt():
    return json.loads(RECEIPT.read_text(encoding='utf-8'))


def source(lemma):
    return next(e for e in receipt()['lexemes'] if e['display_lemma'] == lemma)


def test_readback_is_contiguous_without_recounting_previous_batches():
    report = receipt()
    words = report['lexemes']
    assert report['source_projection']['stable'] == report['source_release']
    assert report['source_projection']['inventory'] == {'entries': 65277, 'senses': 110409}
    previous = []
    for name in ('first-200', 'next-500', 'third-500', 'fourth-500'):
        p = ROOT / f'content/dictionary/audit-20261113-phase09-{name}-lexemes.json'
        previous.extend(json.loads(p.read_text())['lexemes'])
    assert len(previous) == 1700
    old_ids = {w['lexeme_id'] for w in previous}
    new_ids = [w['lexeme_id'] for w in words]
    assert not old_ids & set(new_ids)
    assert new_ids == sorted(new_ids)
    assert max(old_ids) == report['resume_after_lexeme'] < min(new_ids)
    assert report['scope']['lexemes'] == len(words) == len(set(new_ids))
    assert report['scope']['senses'] == sum(len(e['senses']) for e in words)
    assert [r['lexeme_id'] for r in report['source_projection']['entries']] == new_ids
    assert report['signoff']['phase_complete'] is False
    assert report['signoff']['linguistic_external_certification_complete'] is False


def test_complete_canonical_source_hashes_and_selected_target_meaning_hashes():
    report = receipt()
    projection = {r['lexeme_id']: r for r in report['source_projection']['entries']}
    words = {e['lexeme_id']: e for e in report['lexemes']}
    for entry in words.values():
        canonical = {k: v for k, v in entry.items() if k != 'release_id'}
        assert hashlib.sha256(stable(canonical).encode()).hexdigest() == projection[entry['lexeme_id']]['content_sha']
        assert set(projection[entry['lexeme_id']]['sense_ids']) == {s['sense_id'] for s in entry['senses']}
        for sense in entry['senses']:
            assert curation.original_meaning_hash(entry, sense) == report['meaning_hashes'][entry['lexeme_id']][sense['sense_id']]
    for decision in report['relation_decisions']:
        entry = words[decision['source_lexeme_id']]
        sense = next(s for s in entry['senses'] if s['sense_id'] == decision['source_sense_id'])
        assert curation.original_meaning_hash(entry, sense) == decision['source_meaning_sha']
        target_identity = {'display_lemma': decision['target_lemma'], 'part_of_speech': decision['target_pos']}
        assert curation.original_meaning_hash(target_identity, {'definition_en': decision['target_definition_en']}) == decision['target_meaning_sha']
        if decision['type'] == 'synonym':
            assert sense['definition_en'] == decision['target_definition_en']
        else:
            assert entry['display_lemma'] == 'breathing'
            assert decision['target_definition_en'] == 'not breathing or able to breathe except with difficulty'


def test_candidate_scopes_only_reviewed_target_pairs_and_keeps_examples():
    report = receipt()
    expected = {}
    for d in report['relation_decisions']:
        expected[(d['source_lexeme_id'], d['type'], d['target_lexeme_id'], d['target_sense_id'])] = d['source_sense_id']
    for entry in report['lexemes']:
        frozen = copy.deepcopy(entry)
        revised = curation.curate_candidate_entry(entry)
        assert entry == frozen
        assert [s['examples'] for s in revised['senses']] == [s['examples'] for s in frozen['senses']]
        actual = {
            (entry['lexeme_id'], r['relation_type'], r['target_lexeme_id'], r.get('target_sense_id'))
            for r in revised['relations']
        }
        assert {key for key in expected if key[0] == entry['lexeme_id']} <= actual
        for relation in revised['relations']:
            key = (entry['lexeme_id'], relation['relation_type'], relation['target_lexeme_id'], relation.get('target_sense_id'))
            if key in expected:
                assert relation['source_sense_id'] == expected[key]
        for sense in entry['senses']:
            view = corrected_sense_presentation(entry, sense)
            serialized = json.dumps(view).casefold()
            assert 'https://' not in serialized and 'source' not in serialized


def test_two_cost_senses_are_never_scoped_by_lexeme_id_alone():
    entry = source('price')
    result = curation.curate_candidate_entry(entry)
    costs = {r['target_sense_id']: r['source_sense_id'] for r in result['relations'] if r['display_lemma'] == 'cost' and r['relation_type'] == 'synonym'}
    assert costs == {
        '7863fc1b-12ed-47a7-bb4b-92eecabc1c65': 'ecb89969-0607-46a8-9826-ba749353d0c5',
        '9e913e90-ce6f-4fac-a4b9-2f4060b6a433': 'ff71e820-7dff-4756-b28e-651281440186',
    }


@pytest.mark.parametrize('damage', ['missing', 'duplicate', 'wrong_source', 'wrong_pos', 'wrong_label'])
def test_scope_rejects_drifted_source_edge(damage):
    entry = source('stomatal')
    edge = next(r for r in entry['relations'] if r['relation_type'] == 'synonym')
    if damage == 'missing':
        entry['relations'].remove(edge)
    elif damage == 'duplicate':
        entry['relations'].append(copy.deepcopy(edge))
    elif damage == 'wrong_source':
        edge['source_sense_id'] = '26b7ca51-2502-53b0-b350-127cc1202bef'
    elif damage == 'wrong_pos':
        edge['part_of_speech'] = 'n'
    else:
        edge['display_lemma'] = 'unverified replacement'
    before = copy.deepcopy(entry)
    with pytest.raises(ValueError, match='relation_scope_mismatch'):
        curation.curate_candidate_entry(entry)
    assert entry == before


def test_new_editorial_repairs_preserve_meaning_boundaries_and_source():
    fermion = source('fermion')
    assert 'elementar' in fermion['senses'][0]['translations'][0]['text']
    revised = curation.curate_candidate_entry(fermion)
    assert revised['senses'][0]['translations'][0]['text'] == 'fermion; yarim butun spinli zarracha'
    intro = source('introduction')
    result = curation.curate_candidate_entry(intro)
    changed = {'203af725-79b3-470d-a449-00a04e84049a', '87e4704d-e524-5712-84f5-4107e71de6dc'}
    for old, new in zip(intro['senses'], result['senses']):
        if old['sense_id'] in changed:
            assert new['cefr'] == 'B2'
        else:
            assert old == new
    humming = source('hum')
    rendered = present(humming)['senses']
    assert {c['text'] for c in rendered['69db394f-7df9-4871-b8bb-fefb256a0424']['collocations']} == {
        'the hum of traffic', 'the hum of conversation', 'background hum'}
    assert rendered['e754ac6a-e982-45c2-9c34-449ed04215bc']['collocations'] == []


def test_twenty_phase_recovery_cannot_claim_structural_coverage_as_linguistic_pass():
    data = json.loads((ROOT / 'content/dictionary/audit-20261113-20-phase-recovery.json').read_text())
    phases = data['phases']
    assert len(phases) == 20 and sum(p['senses'] for p in phases) == 110409
    assert phases[0]['rank_start'] == 1 and phases[-1]['rank_end'] == 110409
    for left, right in zip(phases, phases[1:]):
        assert left['rank_end'] + 1 == right['rank_start']
    assert sum(p['structural_senses_reported'] for p in phases) == 49685
    assert all(not p['full_linguistic_signoff'] for p in phases)
    assert data['full_linguistic_senses_completed'] is None
    for phase in phases[:9]:
        assert hashlib.sha256((ROOT / phase['source_receipt']).read_bytes()).hexdigest() == phase['receipt_sha256']


@pytest.mark.parametrize('ledger_path', sorted((ROOT / 'content/dictionary').glob('audit-*-phase*-lexical-decisions-*.json')), ids=lambda p: p.stem)
def test_lexical_decisions_cover_each_field_and_match_current_candidate_values(ledger_path):
    from app.dictionary_presentation import present
    ledger = json.loads(ledger_path.read_text())
    source_words = {e['lexeme_id']: e for e in json.loads((ROOT / ledger['source_readback_receipt']).read_text())['lexemes']}
    required = {'definition_en', 'definition_uz', 'translation_uz', 'cefr', 'synonyms', 'antonyms', 'collocations'}
    seen = set()
    for row in ledger['senses']:
        key = (row['lexeme_id'], row['sense_id'])
        assert key not in seen
        seen.add(key)
        original = source_words[row['lexeme_id']]
        sense = next(s for s in original['senses'] if s['sense_id'] == row['sense_id'])
        assert row['meaning_sha'] == curation.original_meaning_hash(original, sense)
        candidate = curation.curate_candidate_entry(original)
        revised = next(s for s in candidate['senses'] if s['sense_id'] == row['sense_id'])
        view = present(candidate)['senses'][row['sense_id']]
        assert set(row['fields']) == required
        for name, decision in row['fields'].items():
            assert decision['evidence_urls'] and decision['reasoning'] and decision['decision']
            if name in ('synonyms', 'antonyms', 'collocations'):
                assert decision['after'] == view[name]
            else:
                assert decision['after'] == revised.get('translations' if name == 'translation_uz' else name)
        assert row['full_pipeline_signoff'] is False
    assert ledger['scope']['senses'] == len(seen)
    assert ledger['scope']['field_decisions'] == len(seen) * len(required)
    assert ledger['scope']['new_source_readback_lexemes'] == 0
    assert ledger['phase_complete'] is False


def test_lexical_ledgers_do_not_recount_the_same_sense_or_source_readback():
    seen = set()
    for file in (ROOT / 'content/dictionary').glob('audit-*-phase*-lexical-decisions-*.json'):
        data = json.loads(file.read_text())
        assert data['scope']['new_source_readback_senses'] == 0
        for row in data['senses']:
            key = (data['source_release'], row['lexeme_id'], row['sense_id'])
            assert key not in seen
            seen.add(key)


def test_unsmooth_antonym_uses_physical_surface_not_other_smooth_senses():
    file = ROOT / 'content/dictionary/audit-20261113-phase09-lexical-decisions-1703-1709.json'
    proof = json.loads(file.read_text())['additional_target_proofs'][0]
    target = proof['entry']
    assert hashlib.sha256(stable({k: v for k, v in target.items() if k != 'release_id'}).encode()).hexdigest() == proof['entry_projection']['content_sha']
    assert set(proof['entry_projection']['sense_ids']) == {s['sense_id'] for s in target['senses']}
    sense = next(s for s in target['senses'] if s['sense_id'] == proof['selected_sense_id'])
    assert sense['definition_en'] == 'having a surface free from roughness or bumps or ridges or irregularities'
    entry = source('unsmooth')
    candidate = curation.curate_candidate_entry(entry)
    antonyms = [r for r in candidate['relations'] if r['relation_type'] == 'antonym']
    assert len(antonyms) == 1
    assert antonyms[0]['source_sense_id'] == entry['senses'][0]['sense_id']
    assert (antonyms[0]['target_lexeme_id'], antonyms[0]['target_sense_id']) == (target['lexeme_id'], sense['sense_id'])


def test_abide_target_proofs_and_put_up_grammar_change_preserve_other_senses():
    data = json.loads((ROOT / 'content/dictionary/audit-20261113-phase09-lexical-decisions-1710.json').read_text())
    for proof in data['additional_target_proofs']:
        entry = proof['entry']
        assert hashlib.sha256(stable({k: v for k, v in entry.items() if k != 'release_id'}).encode()).hexdigest() == proof['entry_projection']['content_sha']
        assert proof['selected_sense_id'] in proof['entry_projection']['sense_ids']
    intervention = data['target_interventions'][0]
    original = intervention['entry']
    frozen = copy.deepcopy(original)
    result = curation.curate_candidate_entry(original)
    assert original == frozen
    for before, after in zip(original['senses'], result['senses']):
        if before['sense_id'] == intervention['sense_id']:
            assert curation.original_meaning_hash(original, before) == intervention['meaning_sha']
            assert after['cefr'] == 'B2' and "'put up with'" in after['definition_en']
            assert before['examples'] == after['examples']
        else:
            assert before == after
    literal = '28d49c76-2120-49d9-bbc9-c93f5dabdf6f'
    tolerate = '033fda48-dc62-4b8e-91a7-30f327e8e66d'
    revised = curation.curate_candidate_entry(source('abide'))
    levels = {s['sense_id']: s.get('cefr') for s in revised['senses']}
    assert levels == {literal: None, tolerate: 'C2'}
    antonyms = [r for r in revised['relations'] if r['relation_type'] == 'antonym']
    assert [(r['source_sense_id'], r['target_sense_id']) for r in antonyms] == [(literal, '2b083025-bfe2-4aa3-836d-9927e8ff28e5')]


def test_unproven_levels_become_null_without_clearing_evidenced_or_unreviewed_senses():
    assert curation.curate_candidate_entry(source('mottle'))['senses'][0].get('cefr') is None
    quart = curation.curate_candidate_entry(source('quart'))
    levels = {s['sense_id']: s.get('cefr') for s in quart['senses']}
    assert levels == {
        '11e70d5b-274a-42ec-aaff-de64838e111e': 'C2',
        '62e0a647-d75f-42fc-8d02-5f116a32b9ec': None,
        '981a5175-47af-445c-9ca2-651373deebfd': 'C2',
    }
    patches = curation.load_corrections()['entries']
    for original in receipt()['lexemes']:
        candidate = curation.curate_candidate_entry(original)
        for before, after in zip(original['senses'], candidate['senses']):
            patch = patches.get(original['lexeme_id'], {}).get(before['sense_id'], {})
            if 'replace_cefr' not in patch:
                assert before.get('cefr') == after.get('cefr')
    imperial = next(s for s in quart['senses'] if s['sense_id'] == '981a5175-47af-445c-9ca2-651373deebfd')
    assert 'approximately 1.137 litres' in imperial['definition_en']
