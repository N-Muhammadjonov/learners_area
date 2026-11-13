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
    unassigned = {'3162d0c6-19d9-4de0-9b2a-23f2a75f893f', 'b1307a3e-8b99-5ad7-a99c-73688bf49738'}
    for old, new in zip(intro['senses'], result['senses']):
        assert new.get('cefr') == (None if old['sense_id'] in unassigned else 'B2')
        assert old['examples'] == new['examples']
        assert old['sense_id'] == new['sense_id']
        assert old['definition_en'] == new['definition_en']
    humming = source('hum')
    rendered = present(humming)['senses']
    assert {c['text'] for c in rendered['69db394f-7df9-4871-b8bb-fefb256a0424']['collocations']} == {
        'the hum of traffic', 'the hum of conversation', 'background hum'}
    assert {c['text'] for c in rendered['e754ac6a-e982-45c2-9c34-449ed04215bc']['collocations']} == {
        'hum of military preparation'}


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


def test_introduction_opposite_selects_text_section_not_reasoning_or_time():
    ledger = json.loads((ROOT / 'content/dictionary/audit-20261113-phase09-lexical-decisions-1718-1719.json').read_text())
    proof = ledger['additional_target_proofs'][0]
    target = proof['entry']
    assert hashlib.sha256(stable({k: v for k, v in target.items() if k != 'release_id'}).encode()).hexdigest() == proof['entry_projection']['content_sha']
    assert set(proof['entry_projection']['sense_ids']) == {s['sense_id'] for s in target['senses']}
    selected = next(s for s in target['senses'] if s['sense_id'] == proof['selected_sense_id'])
    assert selected['definition_en'] == 'the last section of a communication'
    entry = source('introduction')
    frozen = copy.deepcopy(entry)
    revised = curation.curate_candidate_entry(entry)
    assert entry == frozen
    antonyms = [r for r in revised['relations'] if r['relation_type'] == 'antonym']
    assert [(r['source_sense_id'], r['target_lexeme_id'], r['target_sense_id']) for r in antonyms] == [
        ('aafda03f-c624-4adb-90d6-48d7fb728bac', target['lexeme_id'], selected['sense_id'])]
    view = present(revised)['senses']
    for sid, rendered in view.items():
        assert bool(rendered['antonyms']) == (sid == 'aafda03f-c624-4adb-90d6-48d7fb728bac')


def test_completed_1701_1730_lexical_ledgers_have_no_missing_or_recounted_senses():
    expected = {(e['lexeme_id'], s['sense_id']) for e in receipt()['lexemes'] for s in e['senses']}
    actual = []
    for path in (ROOT / 'content/dictionary').glob('audit-*-phase*-lexical-decisions-*.json'):
        data = json.loads(path.read_text())
        if data['source_readback_receipt'] == RECEIPT.relative_to(ROOT).as_posix():
            actual.extend((r['lexeme_id'], r['sense_id']) for r in data['senses'])
    assert len(actual) == len(set(actual))
    assert set(actual) == expected


def test_damage_financial_usage_preserves_physical_and_legal_harm_senses():
    ledger = json.loads((ROOT / 'content/dictionary/audit-20261113-phase09-lexical-decisions-1727-1730.json').read_text())
    intervention = ledger['target_interventions'][0]
    entry = intervention['entry']
    assert hashlib.sha256(stable({k: v for k, v in entry.items() if k != 'release_id'}).encode()).hexdigest() == intervention['entry_projection']['content_sha']
    assert set(intervention['entry_projection']['sense_ids']) == {s['sense_id'] for s in entry['senses']}
    frozen = copy.deepcopy(entry)
    candidate = curation.curate_candidate_entry(entry)
    assert entry == frozen
    for old, new in zip(entry['senses'], candidate['senses']):
        if old['sense_id'] == intervention['sense_id']:
            assert new.get('cefr') is None
            assert 'informal' in new['definition_en'] and 'damage?' in new['definition_en']
            assert old['examples'] == new['examples']
        else:
            assert old == new


@pytest.mark.parametrize('enrichment_path', sorted((ROOT / 'content/dictionary').glob('audit-*-phase09-source-enrichment-*.json')), ids=lambda p: p.stem)
def test_backfill_source_enrichment_preserves_historical_receipt_and_canonical_identities(enrichment_path):
    report = json.loads(enrichment_path.read_text())
    historical_path = ROOT / report['historical_receipt']
    assert hashlib.sha256(historical_path.read_bytes()).hexdigest() == report['historical_receipt_sha256']
    historical = {e['lexeme_id']: e for e in json.loads(historical_path.read_text())['lexemes']}
    assert report['scope']['new_source_readback_lexemes'] == report['scope']['new_source_readback_senses'] == 0
    for originals, projection in ((report['lexemes'], report['source_projection']),
                                  (report['target_entries'], report['target_projection'])):
        rows = {e['lexeme_id']: e for e in projection}
        assert len(rows) == len(originals)
        for entry in originals:
            row = rows[entry['lexeme_id']]
            assert hashlib.sha256(stable({k: v for k, v in entry.items() if k != 'release_id'}).encode()).hexdigest() == row['content_sha']
            assert set(row['sense_ids']) == {s['sense_id'] for s in entry['senses']}
    for entry in report['lexemes']:
        old = historical[entry['lexeme_id']]
        assert entry['display_lemma'] == old['lemma'] and entry['part_of_speech'] == old['part_of_speech']
        assert {s['sense_id'] for s in entry['senses']} == {s['sense_id'] for s in old['senses']}
        for sense in entry['senses']:
            previous = next(s for s in old['senses'] if s['sense_id'] == sense['sense_id'])
            assert curation.original_meaning_hash(entry, sense) == previous['meaning_sha']
            assert sense['definition_uz'] == previous['definition_uz']
            assert sense['translations'][0]['text'] == previous['translation_uz']
            assert sense.get('cefr') == previous['cefr']


def backfill_twenty():
    return json.loads((ROOT / 'content/dictionary/audit-20261113-phase09-source-enrichment-0011-0020.json').read_text())


def test_backfill_twenty_pins_fragment_person_snow_and_historical_clinical_relations():
    report = backfill_twenty()
    words = {e['lexeme_id']: e for e in report['lexemes']}
    targets = {e['lexeme_id']: e for e in report['target_entries']}
    assert len(report['existing_relation_matches']) == 16
    for match in report['existing_relation_matches']:
        source = words[match['source_lexeme_id']]
        original_sense = next(s for s in source['senses'] if s['sense_id'] == match['source_sense_id'])
        target = targets[match['target_lexeme_id']]
        target_sense = next(s for s in target['senses'] if s['sense_id'] == match['target_sense_id'])
        assert original_sense['definition_en'] == target_sense['definition_en'] == match['target_definition_en']
        assert (target['display_lemma'], target['part_of_speech']) == (match['display_lemma'], match['part_of_speech'])
        candidate = curation.curate_candidate_entry(source)
        edges = [r for r in candidate['relations'] if r['relation_type'] == 'synonym'
                 and r['target_lexeme_id'] == target['lexeme_id'] and r['target_sense_id'] == target_sense['sense_id']]
        assert len(edges) == 1 and edges[0]['source_sense_id'] == original_sense['sense_id']
    flake = next(e for e in report['lexemes'] if e['display_lemma'] == 'flake')
    views = present(curation.curate_candidate_entry(flake))['senses']
    assert {r['text'] for r in views['06640187-71be-4178-b157-73c1518bfc3f']['synonyms']} == {'snowflake'}
    assert {r['text'] for r in views['a4e4aa6d-2c53-4002-ad18-d5224208aa66']['synonyms']} == {'eccentric', 'geek', 'oddball'}
    assert {r['text'] for r in views['e3d17978-a3ac-4585-8165-64ec3bf4e308']['synonyms']} == {'bit', 'chip', 'fleck', 'scrap'}
    hysterical = next(e for e in report['lexemes'] if e['display_lemma'] == 'hysterical')
    views = present(curation.curate_candidate_entry(hysterical))['senses']
    assert views['725120af-7844-44a6-a94b-99cad490b356']['synonyms'] == []
    assert [(r['lexemeId'], r['senseId']) for r in views['f68dd2ea-347f-4d64-8dd8-8eeecfbf385f']['synonyms']] == [
        ('4962ae8b-eef8-524b-bd41-a8ae7c530819', '00a2f5aa-96f9-4f7c-9daf-284e95566d29')]


def test_jig_compound_metre_repair_preserves_tool_lure_and_dance_boundaries():
    original = next(e for e in backfill_twenty()['lexemes'] if e['display_lemma'] == 'jig')
    frozen = copy.deepcopy(original)
    revised = curation.curate_candidate_entry(original)
    assert original == frozen
    levels = {s['sense_id']: s.get('cefr') for s in revised['senses']}
    assert levels == {'02852879-0f73-4e39-bf16-1a0745ea5145': None, '4a1e98e9-6f08-4a21-976b-b06ffb62fbca': None,
                      'a1dafb0e-d2ac-4d12-99a7-16aad1e3655f': 'C2', 'b4fdfb92-df7b-4f59-8ef5-b19277c0686e': 'C2'}
    for old, new in zip(original['senses'], revised['senses']):
        assert old['sense_id'] == new['sense_id'] and old['examples'] == new['examples']
        if old['sense_id'] == 'a1dafb0e-d2ac-4d12-99a7-16aad1e3655f':
            assert 'three-four' in old['definition_en']
            assert 'compound metre' in new['definition_en'] and 'typically' in new['definition_en'] and '6/8' in new['definition_en']
            assert 'uch chorak' not in new['definition_uz'] and '6/8' in new['definition_uz']
        else:
            assert old['definition_en'] == new['definition_en']
    views = present(revised)['senses']
    assert {c['text'] for c in views['b4fdfb92-df7b-4f59-8ef5-b19277c0686e']['collocations']} == {'an Irish jig'}
    assert all(not view['collocations'] for sid, view in views.items() if sid != 'b4fdfb92-df7b-4f59-8ef5-b19277c0686e')


def test_same_meaning_historical_note_preserves_previously_approved_examples():
    from app.dictionary_presentation import corrected_examples
    original = next(e for e in backfill_twenty()['lexemes'] if e['display_lemma'] == 'hysterical')
    candidate = curation.curate_candidate_entry(original)
    for old, new in zip(original['senses'], candidate['senses']):
        expected = corrected_examples(original, old)
        assert len(expected) == 2 and expected != old['examples']
        assert new['examples'] == old['examples']
        assert corrected_examples(candidate, new) == expected
    clinical = candidate['senses'][1]
    assert 'historical medical usage' in clinical['definition_en']
    assert clinical.get('cefr') is None
    assert candidate['senses'][0]['cefr'] == 'C1'


@pytest.mark.parametrize('damage', ['no_opt_in', 'wrong_original', 'wrong_hash', 'wrong_replacement', 'wrong_semantic_release', 'wrong_entry_release'])
def test_example_carryover_requires_explicit_exact_original_and_replacement_guards(monkeypatch, damage):
    from app import dictionary_presentation as presentation
    original = next(e for e in backfill_twenty()['lexemes'] if e['display_lemma'] == 'hysterical')
    candidate = curation.curate_candidate_entry(original)
    clinical = candidate['senses'][1]
    metadata = copy.deepcopy(presentation.sense_corrections())
    patch = metadata['entries'][candidate['lexeme_id']][clinical['sense_id']]
    if damage == 'no_opt_in':
        patch.pop('preserve_example_corrections')
    elif damage == 'wrong_original':
        patch['replace_definition_en']['original'] += ' changed'
    elif damage == 'wrong_hash':
        patch['meaning_sha'] = '0' * 64
    elif damage == 'wrong_replacement':
        patch['replace_definition_en']['text'] += ' changed'
    elif damage == 'wrong_semantic_release':
        metadata['source_release'] = 'other-release'
    else:
        candidate['release_id'] = 'other-release'
    monkeypatch.setattr(presentation, 'sense_corrections', lambda: metadata)
    assert presentation.corrected_examples(candidate, clinical) == clinical['examples']


def test_carried_example_corrections_still_require_exact_original_example_text():
    from app.dictionary_presentation import corrected_examples
    original = next(e for e in backfill_twenty()['lexemes'] if e['display_lemma'] == 'hysterical')
    candidate = curation.curate_candidate_entry(original)
    clinical = candidate['senses'][1]
    expected = corrected_examples(candidate, clinical)
    clinical['examples'][0]['text_en'] += ' changed'
    result = corrected_examples(candidate, clinical)
    assert result[0] == clinical['examples'][0]
    assert result[1] == expected[1]


def test_partial_variant_and_historical_target_repairs_do_not_start_example_audit():
    report = backfill_twenty()
    for original in report['target_entries']:
        if original['display_lemma'] not in ('a capella', 'hysteric'):
            continue
        candidate = curation.curate_candidate_entry(original)
        assert candidate['senses'][0].get('cefr') is None
        assert candidate['senses'][0]['examples'] == original['senses'][0]['examples']
        if original['display_lemma'] == 'a capella':
            assert candidate['senses'][0]['definition_en'] == '(of singing) without instrumental accompaniment.'
        else:
            assert 'historical medical usage' in candidate['senses'][0]['definition_en']
            assert 'tarixiy' in candidate['senses'][0]['translations'][0]['text']


def backfill_thirty():
    return json.loads((ROOT / 'content/dictionary/audit-20261113-phase09-source-enrichment-0021-0030.json').read_text())


@pytest.mark.parametrize('enrichment_path', sorted((ROOT / 'content/dictionary').glob('audit-*-phase09-source-enrichment-*.json')), ids=lambda p: p.stem)
def test_enriched_backfill_has_complete_unique_lexical_ledgers_and_exact_existing_edges(enrichment_path):
    report = json.loads(enrichment_path.read_text())
    targets = {e['lexeme_id']: e for e in report['target_entries']}
    expected = {(e['lexeme_id'], s['sense_id']) for e in report['lexemes'] for s in e['senses']}
    actual = []
    for path in (ROOT / 'content/dictionary').glob('audit-*-phase*-lexical-decisions-*.json'):
        ledger = json.loads(path.read_text())
        if ledger['source_readback_receipt'] == enrichment_path.relative_to(ROOT).as_posix():
            actual.extend((s['lexeme_id'], s['sense_id']) for s in ledger['senses'])
    assert len(actual) == len(set(actual)) and set(actual) == expected
    words = {e['lexeme_id']: e for e in report['lexemes']}
    for match in report['existing_relation_matches']:
        original = words[match['source_lexeme_id']]
        sense = next(s for s in original['senses'] if s['sense_id'] == match['source_sense_id'])
        target = targets[match['target_lexeme_id']]
        target_sense = next(s for s in target['senses'] if s['sense_id'] == match['target_sense_id'])
        assert sense['definition_en'] == target_sense['definition_en'] == match['target_definition_en']
        assert (target['display_lemma'], target['part_of_speech']) == (match['display_lemma'], match['part_of_speech'])
        candidate = curation.curate_candidate_entry(original)
        edges = [r for r in candidate['relations'] if r['relation_type'] == 'synonym'
                 and r['target_lexeme_id'] == target['lexeme_id'] and r['target_sense_id'] == target_sense['sense_id']]
        assert len(edges) == 1 and edges[0]['source_sense_id'] == sense['sense_id']


def test_startup_shutdown_and_daunted_undaunted_select_only_the_reviewed_meanings():
    report = backfill_thirty()
    words = {e['lexeme_id']: e for e in report['lexemes']}
    targets = {e['lexeme_id']: e for e in report['target_entries']}
    for proof in report['new_antonym_targets']:
        target = targets[proof['target_lexeme_id']]
        selected = next(s for s in target['senses'] if s['sense_id'] == proof['target_sense_id'])
        assert selected['definition_en'] == proof['target_definition_en']
        assert curation.original_meaning_hash(target, selected) == proof['target_meaning_sha']
        candidate = curation.curate_candidate_entry(words[proof['source_lexeme_id']])
        opposites = [r for r in candidate['relations'] if r['relation_type'] == 'antonym']
        assert [(r['source_sense_id'], r['target_lexeme_id'], r['target_sense_id']) for r in opposites] == [
            (proof['source_sense_id'], target['lexeme_id'], selected['sense_id'])]
        if candidate['display_lemma'] == 'startup':
            assert proof['source_sense_id'] == 'f56773d3-7e2d-4d35-9b42-f79de2ddf783'
            assert selected['definition_en'] == 'termination of operations'
            assert {s['sense_id']: s.get('cefr') for s in candidate['senses']} == {
                'd7525883-85d3-4bd1-90f0-409545b4c051': None, 'f56773d3-7e2d-4d35-9b42-f79de2ddf783': None,
                '94cb1d1c-56f4-42e0-89bf-fcf8ecab3cc9': 'C1'}
        else:
            assert candidate['display_lemma'] == 'daunted'
            assert selected['definition_en'] == 'unshaken in purpose'
            assert selected['sense_id'] != 'cfbd5174-13f3-4e59-b276-23a0d881898e'


def test_epigenesis_is_development_not_gene_activity_and_keeps_frozen_source():
    original = next(e for e in backfill_thirty()['lexemes'] if e['display_lemma'] == 'epigenesis')
    frozen = copy.deepcopy(original)
    candidate = curation.curate_candidate_entry(original)
    assert original == frozen
    before, after = original['senses'][0], candidate['senses'][0]
    assert 'gene activity' in before['definition_en']
    assert 'differentiation' in after['definition_en'] and 'tissues and organs' in after['definition_en']
    assert 'DNA' not in after['definition_en'] and 'a’zolarga' in after['definition_uz']
    assert after['sense_id'] == before['sense_id'] and after['translations'] == before['translations']
    assert after.get('cefr') is None and after['examples'] == before['examples'] == []


def test_interior_officeholder_and_post_are_separate_resource_management_senses():
    original = next(e for e in backfill_thirty()['lexemes'] if e['display_lemma'] == 'secretary of the interior')
    candidate = curation.curate_candidate_entry(original)
    person, post = candidate['senses']
    assert 'person who heads' in person['definition_en'] and 'shaxs' in person['definition_uz']
    assert 'office of the head' in post['definition_en'] and 'lavozimi' in post['definition_uz']
    for sense in candidate['senses']:
        assert 'natural resources' in sense['definition_en'] and 'federal yerlar' in sense['definition_uz']
        assert sense.get('cefr') is None
    edges = [r for r in candidate['relations'] if r['relation_type'] == 'synonym']
    assert {r['source_sense_id']: r['target_sense_id'] for r in edges} == {
        '045d066d-960e-5f90-bee5-17a0d73314e7': '5d1aead2-3a62-5030-8f60-3f3bb5ee16c7',
        'e743d613-eb7a-5518-8304-6ca7184efc94': '34bd8264-47d4-54ff-b66b-f03afd0fef11'}


def test_tropic_does_not_inherit_tropical_level_or_change_other_target_senses():
    report = backfill_thirty()
    tropic = next(e for e in report['lexemes'] if e['display_lemma'] == 'tropic')
    assert all(s.get('cefr') is None for s in curation.curate_candidate_entry(tropic)['senses'])
    target = next(e for e in report['target_entries'] if e['display_lemma'] == 'tropical')
    revised = curation.curate_candidate_entry(target)
    for old, new in zip(target['senses'], revised['senses']):
        if old['sense_id'] == 'eddea5b3-45d1-4ac7-922f-78db4adcddf7':
            assert old['cefr'] == 'B1' and new['cefr'] == 'B2'
            assert {k: v for k, v in old.items() if k != 'cefr'} == {k: v for k, v in new.items() if k != 'cefr'}
        else:
            assert new == old


def test_latest_backfill_retains_previously_approved_example_presentations():
    from app.dictionary_presentation import corrected_examples
    report = backfill_thirty()
    for original in report['lexemes'] + report['target_entries']:
        frozen = copy.deepcopy(original)
        candidate = curation.curate_candidate_entry(original)
        assert original == frozen
        for old, new in zip(original['senses'], candidate['senses']):
            assert old['examples'] == new['examples']
            assert corrected_examples(original, old) == corrected_examples(candidate, new)


@pytest.mark.parametrize('selected_source_path', sorted((ROOT / 'content/dictionary').glob('audit-*-phase09-source-enrichment-selected-*.json')), ids=lambda p: p.stem)
def test_cached_selected_source_authenticates_archived_offsets_without_claiming_fresh_database_checks(selected_source_path):
    report = json.loads(selected_source_path.read_text())
    historical = json.loads((ROOT / report['historical_receipt']).read_text())['lexemes']
    old = {e['lexeme_id']: (i, e) for i, e in enumerate(historical, 1)}
    rows = {e['lexeme_id']: e for e in report['source_projection']}
    positions = []
    for entry in report['lexemes']:
        index, archived = old[entry['lexeme_id']]
        positions.append(index)
        row = rows[entry['lexeme_id']]
        assert (row['storage_offset'], row['storage_length']) == (archived['storage_offset'], archived['storage_length'])
        assert 'not a fresh database' in row['content_sha_provenance']
        assert not any(r['relation_type'] in ('synonym', 'antonym') for r in entry['relations'])
    assert positions == report['scope']['historical_sequential_positions']
    assert report['scope']['contiguous_range_claimed'] is False
    assert report['source_verification']['fresh_database_content_sha_comparison'] == 'NOT_RERUN_connector_unavailable'
    assert report['scope']['new_source_readback_senses'] == 0


def test_separate_scalar_interventions_are_exact_guarded_edits_and_not_full_sense_signoffs():
    from app.dictionary_presentation import corrected_examples
    data = json.loads((ROOT / 'content/dictionary/audit-20261113-phase09-surgical-scalars-0032-0035.json').read_text())
    historical = {e['lexeme_id']: e for e in json.loads((ROOT / data['historical_receipt']).read_text())['lexemes']}
    full_ids = {(r['lexeme_id'], r['sense_id']) for f in (ROOT / 'content/dictionary').glob('audit-*-phase*-lexical-decisions-*.json') for r in json.loads(f.read_text())['senses']}
    assert data['scope']['new_fully_seven_field_reviewed_senses'] == 0
    for row in data['interventions']:
        original = row['original_entry']
        assert (row['lexeme_id'], row['sense_id']) not in full_ids
        assert row['full_seven_field_review_counted'] is False
        assert row['synonym_antonym_target_readback_completed'] is False
        sense = original['senses'][0]
        archived = next(s for s in historical[original['lexeme_id']]['senses'] if s['sense_id'] == row['sense_id'])
        assert curation.original_meaning_hash(original, sense) == row['meaning_sha'] == archived['meaning_sha']
        candidate = curation.curate_candidate_entry(original)
        revised = candidate['senses'][0]
        view = present(candidate)['senses'][row['sense_id']]
        assert candidate['relations'] == original['relations']
        assert revised['examples'] == sense['examples']
        assert corrected_examples(candidate, revised) == corrected_examples(original, sense)
        for field, decision in row['fields'].items():
            assert decision['evidence_urls'] and decision['reasoning']
            assert decision['after'] == (view[field] if field == 'collocations' else revised.get('translations' if field == 'translation_uz' else field))
        if original['display_lemma'] == 'absinth':
            assert 'sometimes colourless' in revised['definition_en'] and 'ko‘pincha' in revised['definition_uz']
        elif original['display_lemma'] == 'excel':
            assert sense['cefr'] == 'B2' and revised['cefr'] == 'C2'
            assert 'exceptionally good' in revised['definition_en']
        elif original['display_lemma'] == 'unfrock':
            assert 'clergy' in revised['definition_en'] and 'lavozimi' in revised['definition_uz']


def test_dropkick_first_bounce_and_explicit_sport_level_preserve_original_source():
    report = json.loads((ROOT / 'content/dictionary/audit-20261113-phase09-source-enrichment-selected-0031-0046.json').read_text())
    entry = next(e for e in report['lexemes'] if e['display_lemma'] == 'dropkick')
    frozen = copy.deepcopy(entry)
    candidate = curation.curate_candidate_entry(entry)
    assert entry == frozen
    sense = candidate['senses'][0]
    assert 'rises from its first bounce' in sense['definition_en']
    assert sense['cefr'] == 'C2' and sense['sense_id'] == entry['senses'][0]['sense_id']
    assert sense['examples'] == entry['senses'][0]['examples']


def test_closed_end_lease_is_about_residual_value_risk_not_mandatory_return():
    report = json.loads((ROOT / 'content/dictionary/audit-20261113-phase09-source-enrichment-selected-0047-0064.json').read_text())
    original = next(e for e in report['lexemes'] if e['display_lemma'] == 'closed-end lease')
    frozen = copy.deepcopy(original)
    candidate = curation.curate_candidate_entry(original)
    assert original == frozen
    old, new = original['senses'][0], candidate['senses'][0]
    assert 'requires the asset to be returned' in old['definition_en']
    assert 'can return' in new['definition_en'] and 'residual value' in new['definition_en']
    assert 'U.S. consumer leasing' in new['definition_en'] and 'other contractual charges may still apply' in new['definition_en']
    assert 'qoldiq qiymatdan past' in new['definition_uz'] and 'boshqa to‘lovlar' in new['definition_uz']
    assert new['sense_id'] == old['sense_id'] and new.get('cefr') is None
    assert new['examples'] == old['examples'] == []


def test_flavin_classification_repairs_all_three_language_fields_without_guessing_level():
    report = json.loads((ROOT / 'content/dictionary/audit-20261113-phase09-source-enrichment-selected-0047-0064.json').read_text())
    original = next(e for e in report['lexemes'] if e['display_lemma'] == 'flavin')
    frozen = copy.deepcopy(original)
    candidate = curation.curate_candidate_entry(original)
    assert original == frozen
    sense = candidate['senses'][0]
    assert 'ketone' in original['senses'][0]['definition_en']
    assert 'ketone' not in sense['definition_en'] and 'isoalloxazine' in sense['definition_en']
    assert 'keton' not in sense['definition_uz'] and 'izoalloksazin' in sense['definition_uz']
    assert 'keton' not in sense['translations'][0]['text'] and 'flavin' in sense['translations'][0]['text']
    assert sense.get('cefr') is None
    assert candidate['relations'] == original['relations']


def test_colt_animal_level_and_male_translation_do_not_spread_to_firearm():
    report = json.loads((ROOT / 'content/dictionary/audit-20261113-phase09-source-enrichment-selected-0067-0075.json').read_text())
    original = next(e for e in report['lexemes'] if e['display_lemma'] == 'colt')
    frozen = copy.deepcopy(original)
    candidate = curation.curate_candidate_entry(original)
    assert original == frozen
    senses = {s['sense_id']: s for s in candidate['senses']}
    gun = senses['ab5ee940-2955-56a9-afad-e5fbf78dbabb']
    horse = senses['d6c810a6-8a86-41fe-aa97-93fa3c87e4f0']
    assert gun.get('cefr') is None and gun['definition_en'] == 'a kind of revolver'
    assert horse['cefr'] == 'C2' and 'typically under four' in horse['definition_en']
    assert 'erkak' in horse['translations'][0]['text']
    assert set(senses) == {s['sense_id'] for s in original['senses']}
    assert [s['examples'] for s in candidate['senses']] == [s['examples'] for s in original['senses']]


def test_stratus_and_goatee_remove_false_mandatory_appearance_criteria():
    report = json.loads((ROOT / 'content/dictionary/audit-20261113-phase09-source-enrichment-selected-0067-0075.json').read_text())
    words = {e['display_lemma']: e for e in report['lexemes']}
    stratus = curation.curate_candidate_entry(words['stratus'])['senses'][0]
    assert 'dark' in words['stratus']['senses'][0]['definition_en']
    assert 'grey sheet' in stratus['definition_en'] and 'irregular fragments' in stratus['definition_en']
    assert 'dark' not in stratus['definition_en'] and stratus.get('cefr') is None
    goatee = curation.curate_candidate_entry(words['goatee'])['senses'][0]
    assert goatee['cefr'] == 'C2' and words['goatee']['senses'][0]['cefr'] == 'B2'
    assert 'often trimmed' in goatee['definition_en'] and 'chin' in goatee['definition_en']


def test_lunch_keeps_evidenced_intransitive_level_without_assigning_it_to_feeding_someone():
    from app.dictionary_presentation import corrected_examples
    report = json.loads((ROOT / 'content/dictionary/audit-20261113-phase09-source-enrichment-selected-0076-0086.json').read_text())
    original = next(e for e in report['lexemes'] if e['display_lemma'] == 'lunch')
    frozen = copy.deepcopy(original)
    candidate = curation.curate_candidate_entry(original)
    assert original == frozen
    senses = {s['sense_id']: s for s in candidate['senses']}
    eat = senses['5b618a77-27eb-4911-bf2c-2548fe953a95']
    provide = senses['ec67e05b-90e8-464e-ad53-542babd1ca68']
    assert eat['cefr'] == 'A1' and 'Rasmiyroq' in eat['definition_uz']
    assert provide.get('cefr') is None and provide['definition_en'] == 'provide a midday meal for'
    assert eat['translations'][0]['text'] == 'tushlik qilmoq'
    assert provide['translations'][0]['text'] == 'tushlik bermoq'
    views = present(candidate)['senses']
    assert {r['text'] for r in views[eat['sense_id']]['collocations']} == {'lunch at a restaurant'}
    assert views[provide['sense_id']]['collocations'] == []
    for old in original['senses']:
        new = senses[old['sense_id']]
        assert new['examples'] == old['examples']
        assert corrected_examples(original, old) == corrected_examples(candidate, new)


def test_backfill_scopes_exact_targets_without_crossing_taste_attraction_or_voting_senses():
    report = json.loads((ROOT / 'content/dictionary/audit-20261113-phase09-source-enrichment-0001-0010.json').read_text())
    targets = {e['lexeme_id']: e for e in report['target_entries']}
    for entry in report['lexemes']:
        frozen = copy.deepcopy(entry)
        candidate = curation.curate_candidate_entry(entry)
        assert entry == frozen
        assert [s['examples'] for s in entry['senses']] == [s['examples'] for s in candidate['senses']]
        matches = [r for r in report['existing_relation_matches'] if r['source_lexeme_id'] == entry['lexeme_id']]
        for match in matches:
            target = targets[match['target_lexeme_id']]
            target_sense = next(s for s in target['senses'] if s['sense_id'] == match['target_sense_id'])
            source_sense = next(s for s in entry['senses'] if s['sense_id'] == match['source_sense_id'])
            assert target_sense['definition_en'] == source_sense['definition_en'] == match['target_definition_en']
            edge = [r for r in candidate['relations'] if r['relation_type'] == 'synonym'
                    and r['target_lexeme_id'] == target['lexeme_id'] and r['target_sense_id'] == target_sense['sense_id']]
            assert len(edge) == 1 and edge[0]['source_sense_id'] == source_sense['sense_id']
        if entry['display_lemma'] == 'delectable':
            views = present(candidate)['senses']
            assert {s['text'] for s in views['8a28124b-3139-4265-88fc-1bf7f53594f6']['synonyms']} == {'delicious', 'luscious', 'scrumptious', 'yummy'}
            assert {s['text'] for s in views['f479ba8d-fdf3-4cb4-b48a-3156dc1409c9']['synonyms']} == {'sexually attractive'}
        elif entry['display_lemma'] == 'affranchise':
            proof = report['new_antonym_target']
            target = targets[proof['target_lexeme_id']]
            sense = next(s for s in target['senses'] if s['sense_id'] == proof['target_sense_id'])
            assert sense['definition_en'] == 'make a slave of; bring into servitude'
            assert curation.original_meaning_hash(target, sense) == proof['target_meaning_sha']
            edge = [r for r in candidate['relations'] if r['relation_type'] == 'antonym']
            assert [(r['source_sense_id'], r['target_lexeme_id'], r['target_sense_id']) for r in edge] == [
                (proof['source_sense_id'], proof['target_lexeme_id'], proof['target_sense_id'])]


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
