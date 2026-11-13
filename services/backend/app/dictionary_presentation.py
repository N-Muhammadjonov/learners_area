"""Exact-sense presentation and morphology from the pinned main contract."""
from __future__ import annotations
import gzip
import hashlib
import io
import json
import os
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
import regex
from .dictionary_canonical import stable
from .step30_video_lexical import forms_of

ROOT = Path(os.environ.get('DICTIONARY_PRESENTATION_DIR') or Path(__file__).resolve().parents[1] / 'assets/dictionary/presentation')


@lru_cache(maxsize=1)
def manifest():
    return json.loads((ROOT / 'manifest.json').read_text())


@lru_cache(maxsize=16)
def shard(prefix):
    descriptor = manifest()['shards'].get(prefix)
    if not descriptor:
        return {}
    data = (ROOT / (prefix + '.json.gz')).read_bytes()
    if len(data) != descriptor['bytes'] or hashlib.sha256(data).hexdigest() != descriptor['sha256']:
        raise ValueError('dictionary_presentation_checksum')
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
        raw = stream.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError('dictionary_presentation_limit')
    return json.loads(raw)


def usage_norm(text):
    value = unicodedata.normalize('NFKC', text).lower()
    value = re.sub('[\u2019\u2018\u02bc\u02bb`]', "'", value)
    return regex.sub(r"[^\p{L}\p{N}']+", ' ', value).strip()


def example_uses_entry(entry, text):
    body = ' ' + usage_norm(text) + ' '
    forms = [entry['display_lemma'], *[f['surface_form'] for f in entry.get('forms', [])],
             *[row[0] for row in forms_of(entry['display_lemma'], entry['part_of_speech'])]]
    for form in dict.fromkeys(forms):
        norm = usage_norm(form)
        if not norm:
            continue
        if ' ' + norm + ' ' in body:
            return True
        if entry['lexical_type'] == 'phrasal_verb':
            words = norm.split(' ')
            if len(words) > 1 and regex.search(' ' + r" (?:[\p{L}\p{N}']+ ){0,3}".join(regex.escape(w) for w in words) + ' ', body):
                return True
    return False


def meaning_hash(entry, sense):
    return hashlib.sha256(stable({'lemma': entry['display_lemma'], 'pos': entry['part_of_speech'], 'definition': sense['definition_en']}).encode()).hexdigest()



@lru_cache(maxsize=1)
def example_corrections():
    """Load editorial examples without changing immutable R2 source objects."""
    path = Path(__file__).resolve().parents[1] / 'assets/dictionary/example_corrections.json'
    return json.loads(path.read_text(encoding='utf-8'))


def corrected_examples(entry, sense):
    """Apply replacements only to matching frozen release, sense and source text."""
    data = example_corrections()
    if entry.get('release_id') != data['source_release']:
        return sense['examples']
    change = data['entries'].get(entry['lexeme_id'], {}).get(sense['sense_id'])
    if not change or change['meaning_sha'] != meaning_hash(entry, sense):
        return sense['examples']
    revised = []
    for example in sense['examples']:
        replacement = change['examples'].get(example['example_id'])
        if replacement and example['text_en'] == replacement['original_en']:
            revised.append({**example, 'text_en': replacement['text_en'],
                            'text_uz': replacement['text_uz']})
        else:
            revised.append(example)
    return revised


@lru_cache(maxsize=1)
def sense_corrections():
    """Immutable-release-specific, source-verified semantic presentation edits."""
    path = Path(__file__).resolve().parents[1] / 'assets/dictionary/sense_corrections.json'
    return json.loads(path.read_text(encoding='utf-8'))


def corrected_sense_presentation(entry, sense):
    """Never apply a correction to a different release or meaning."""
    data = sense_corrections()
    if entry.get('release_id') != data['source_release']:
        return {}
    correction = data['entries'].get(entry['lexeme_id'], {}).get(sense['sense_id'], {})
    if correction.get('meaning_sha') != meaning_hash(entry, sense):
        return {}
    # Exact allowlist: editorial evidence and source attribution never enter
    # the reader-facing semantic presentation, even if future patches add them.
    return {
        'remove_synonym_lexeme_ids': list(correction.get('remove_synonym_lexeme_ids', [])),
        'remove_antonym_lexeme_ids': list(correction.get('remove_antonym_lexeme_ids', [])),
        'add_synonyms': [
            {key: item[key] for key in ('text', 'lexemeId', 'senseId')}
            for item in [*correction.get('scope_synonyms', []), *correction.get('add_synonyms', [])]
        ],
        'add_antonyms': [
            {key: item[key] for key in ('text', 'lexemeId', 'senseId')}
            for item in [*correction.get('scope_antonyms', []), *correction.get('add_antonyms', [])]
        ],
        'add_collocations': [
            {'text': item['text']}
            for item in correction.get('add_collocations', [])
        ],
    }


def present(entry):
    from .dictionary_reader_metadata import details
    reader=details(entry)
    stored = shard(entry['lexeme_id'][:2]).get(entry['lexeme_id'], {})
    senses = entry['senses']
    result = {}
    for sense in senses:
        sid = sense['sense_id']
        candidate = stored.get('senses', {}).get(sid)
        row = candidate if candidate and candidate.get('meaningSha') == meaning_hash(entry, sense) else None
        semantic = corrected_sense_presentation(entry, sense)
        scoped = [r for r in entry['relations'] if r['relation_type'] == 'synonym' and r.get('source_sense_id') == sid]
        legacy = [r for r in entry['relations'] if r['relation_type'] == 'synonym' and not r.get('source_sense_id')] if len(senses) == 1 else []
        def links(relations):
            return [dict(text=r['display_lemma'], lexemeId=r['target_lexeme_id'], **({'senseId': r['target_sense_id']} if r.get('target_sense_id') else {})) for r in relations]
        synonyms = {}
        for item in [*links(legacy), *(row.get('synonyms', []) if row else []), *links(scoped)]:
            synonyms[(item.get('lexemeId'), item.get('senseId'), item['text'])] = item
        # Remove misleading legacy edges first. New exact-sense replacements
        # may legitimately target the same lexeme with a different sense ID.
        excluded_synonyms = set(semantic.get('remove_synonym_lexeme_ids', []))
        if excluded_synonyms:
            synonyms = {key: item for key, item in synonyms.items()
                        if item.get('lexemeId') not in excluded_synonyms}
        for item in semantic.get('add_synonyms', []):
            relation = {'text': item['text'], 'lexemeId': item['lexemeId'],
                        'senseId': item['senseId']}
            synonyms[(relation['lexemeId'], relation['senseId'], relation['text'])] = relation
        collocations = {}
        for item in [*({'text': c['text']} for c in entry['collocations'] if c.get('sense_id') == sid or (not c.get('sense_id') and len(senses) == 1)), *(row.get('collocations', []) if row else []), *({'text': item['text']} for item in semantic.get('add_collocations', []))]:
            collocations[(usage_norm(item['text']), item.get('lexemeId'), item.get('senseId'))] = item
        examples = [ex for ex in corrected_examples(entry, sense) if example_uses_entry(entry, ex['text_en'])]
        antonyms={}
        for item in [*reader['antonyms'].get(sid,[]), *links([r for r in entry['relations'] if r['relation_type']=='antonym' and (r.get('source_sense_id')==sid or (not r.get('source_sense_id') and len(senses)==1))])]:
            antonyms[(item.get('lexemeId'),item.get('senseId'),item['text'])]=item
        excluded_antonyms = set(semantic.get('remove_antonym_lexeme_ids', []))
        if excluded_antonyms:
            antonyms = {key: item for key, item in antonyms.items()
                        if item.get('lexemeId') not in excluded_antonyms}
        for item in semantic.get('add_antonyms', []):
            relation = {'text': item['text'], 'lexemeId': item['lexemeId'],
                        'senseId': item['senseId']}
            antonyms[(relation['lexemeId'], relation['senseId'], relation['text'])] = relation
        result[sid] = {'antonyms':list(antonyms.values()),'synonyms': list(synonyms.values()), 'collocations': list(collocations.values()),
                       'examples': [*(row.get('addedExamples', []) if row else []), *examples]}
    phrases={}
    for item in [*({'text':c['text']} for c in entry['collocations']), *(c for view in result.values() for c in view['collocations'])]:
        key=(usage_norm(item['text']),item.get('lexemeId'),item.get('senseId'))
        phrases[key]=item
    return {'senses':result,'collocations':list(phrases.values()),
            'senseOrder':reader['senseOrder'],'primarySenseId':reader['primarySenseId'],
            'primaryTranslation':reader['primaryTranslation']}
