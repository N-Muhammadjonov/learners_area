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


def present(entry):
    stored = shard(entry['lexeme_id'][:2]).get(entry['lexeme_id'], {})
    senses = entry['senses']
    result = {}
    for sense in senses:
        sid = sense['sense_id']
        candidate = stored.get('senses', {}).get(sid)
        row = candidate if candidate and candidate.get('meaningSha') == meaning_hash(entry, sense) else None
        scoped = [r for r in entry['relations'] if r['relation_type'] == 'synonym' and r.get('source_sense_id') == sid]
        legacy = [r for r in entry['relations'] if r['relation_type'] == 'synonym' and not r.get('source_sense_id')] if len(senses) == 1 else []
        def links(relations):
            return [dict(text=r['display_lemma'], lexemeId=r['target_lexeme_id'], **({'senseId': r['target_sense_id']} if r.get('target_sense_id') else {})) for r in relations]
        synonyms = {}
        for item in [*(row['synonyms'] if row else links(legacy)), *links(scoped)]:
            synonyms[(item.get('lexemeId'), item.get('senseId'), item['text'])] = item
        collocations = row['collocations'] if row else [{'text': c['text']} for c in entry['collocations'] if c.get('sense_id') == sid or (not c.get('sense_id') and len(senses) == 1)]
        examples = [ex for ex in sense['examples'] if example_uses_entry(entry, ex['text_en'])]
        result[sid] = {'synonyms': list(synonyms.values()), 'collocations': collocations,
                       'examples': [*(row.get('addedExamples', []) if row else []), *examples]}
    return {'senses': result}
