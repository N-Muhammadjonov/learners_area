"""Prepare exactly two reviewed Reading passages, without connecting to a DB.

Editorial plans and generated SQL stay local. Publish only code and aggregate
receipts. Existing occurrences keep their IDs; shared and learner senses remain
immutable. Every change is guarded by the body checksum and previous identity.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from uuid import UUID, NAMESPACE_URL, uuid5


def prepare(plan: dict, snapshots: list[dict]) -> dict:
    if plan.get('version') != 1 or not re.fullmatch(r'[a-z0-9-]{1,80}', plan.get('release', '')):
        raise ValueError('Invalid reviewed release')
    passages = plan.get('passages', [])
    if len(passages) != 2 or len(snapshots) != 2 or len({p['id'] for p in passages}) != 2:
        raise ValueError('Exactly two distinct passages are required')
    sources = {p['id']: p for p in snapshots}
    if set(sources) != {p['id'] for p in passages}:
        raise ValueError('Source pair does not match the reviewed pair')
    result = {'version': 1, 'release': plan['release'], 'passages': []}
    for passage in passages:
        UUID(passage['id'])
        body = sources[passage['id']]['body_text']
        checksum = hashlib.sha256(body.encode()).hexdigest()
        if passage['sourceSha256'] != checksum or passage.get('unknown'):
            raise ValueError('Source changed or editorial review is incomplete')
        old = {(r['start_char'], r['end_char']): r for r in sources[passage['id']]['occurrences']}
        if len(old) != len(sources[passage['id']]['occurrences']):
            raise ValueError('Ambiguous original interval')
        rows, seen = [], set()
        for entry in passage['entries']:
            start, end = entry['start'], entry['end']
            if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(body):
                raise ValueError('Invalid reviewed offset')
            if body[start:end] != entry['surface'] or (start, end) in seen:
                raise ValueError('Duplicate or inexact source span')
            seen.add((start, end))
            for key, maximum in [('term', 120), ('partOfSpeech', 30), ('definitionEn', None), ('translationUz', None)]:
                if not isinstance(entry.get(key), str) or not entry[key].strip() or (maximum and len(entry[key]) > maximum):
                    raise ValueError('Invalid reviewed meaning: ' + key)
            if len(entry['surface']) > 120:
                raise ValueError('Reviewed phrase exceeds source column limit')
            identity = f"reading:{passage['id']}:{checksum}:{start}-{end}"
            meaning = {k: entry[k] for k in ('term', 'partOfSpeech', 'definitionEn', 'translationUz')}
            meaning_hash = hashlib.sha256(json.dumps(meaning, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            previous = old.get((start, end))
            if previous:
                UUID(previous['id'])
                if previous['lexeme_id']:
                    UUID(previous['lexeme_id'])
            rows.append({**meaning, 'start': start, 'end': end, 'surface': entry['surface'],
                         'id': previous['id'] if previous else str(uuid5(NAMESPACE_URL, identity)),
                         'oldLexemeId': previous['lexeme_id'] if previous else None,
                         'oldSurface': previous['surface_form'] if previous else None,
                         'isNew': previous is None,
                         'lexemeId': str(uuid5(NAMESPACE_URL, identity + ':' + meaning_hash)),
                         'senseKey': identity + ':' + meaning_hash,
                         'target': 'pronoun' not in entry['partOfSpeech'].casefold()})
        if not rows:
            raise ValueError('Empty reviewed passage')
        result['passages'].append({'id': passage['id'], 'sourceSha256': checksum, 'entries': rows})
    return result


def build_sql(manifest: dict, *, rollback: bool = False) -> str:
    literal = json.dumps(manifest, ensure_ascii=False, separators=(',', ':')).replace("'", "''")
    if '$reading_pair$' in literal:
        raise ValueError('SQL delimiter in reviewed source')
    return """-- LOCAL reviewed two-passage release. No learner/shared-lexeme writes.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $reading_pair$
DECLARE
  manifest jsonb := '""" + literal + """'::jsonb;
  passage jsonb;
  item jsonb;
  source text;
  current_row public.lexical_occurrences%ROWTYPE;
  before_users text;
  after_users text;
  before_lexemes text;
  after_lexemes text;
  planned_ids uuid[];
BEGIN
  IF jsonb_array_length(manifest->'passages') <> 2 OR
     (SELECT count(DISTINCT p->>'id') FROM jsonb_array_elements(manifest->'passages') p) <> 2 THEN
    RAISE EXCEPTION 'reading_pair_requires_two_passages';
  END IF;
  SELECT array_agg((e->>'lexemeId')::uuid) INTO planned_ids
    FROM jsonb_array_elements(manifest->'passages') p,
         jsonb_array_elements(p->'entries') e;
  SELECT md5(coalesce(string_agg(to_jsonb(v)::text,'' ORDER BY id),''))
    INTO before_users FROM public.user_vocabulary v;
  SELECT md5(coalesce(string_agg(to_jsonb(l)::text,'' ORDER BY id),''))
    INTO before_lexemes FROM public.lexemes l WHERE NOT (id=ANY(planned_ids));
  -- Lock both canonical bodies in stable order before changing either passage.
  PERFORM id FROM public.reading_passages WHERE id IN
    (SELECT (p->>'id')::uuid FROM jsonb_array_elements(manifest->'passages') p)
    ORDER BY id FOR SHARE;
  FOR passage IN SELECT value FROM jsonb_array_elements(manifest->'passages') LOOP
    SELECT body_text INTO STRICT source FROM public.reading_passages WHERE id=(passage->>'id')::uuid;
    IF encode(sha256(convert_to(source,'UTF8')),'hex') <> passage->>'sourceSha256' THEN
      RAISE EXCEPTION 'reading_pair_source_changed: %',passage->>'id';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(passage->'entries') LOOP
      IF (item->>'start')::int < 0 OR (item->>'end')::int <= (item->>'start')::int OR
         substring(source FROM (item->>'start')::int+1 FOR (item->>'end')::int-(item->>'start')::int)
           IS DISTINCT FROM item->>'surface' THEN
        RAISE EXCEPTION 'reading_pair_span_changed: %',item->>'id';
      END IF;
      INSERT INTO public.lexemes(id,term,part_of_speech,definition_en,translation_uz,sense_key,
          provenance,verification_status,import_batch)
        VALUES((item->>'lexemeId')::uuid,item->>'term',item->>'partOfSpeech',item->>'definitionEn',
          item->>'translationUz',item->>'senseKey','authored','verified',manifest->>'release')
        ON CONFLICT(id) DO NOTHING;
      IF NOT EXISTS(SELECT 1 FROM public.lexemes WHERE id=(item->>'lexemeId')::uuid
          AND term=item->>'term' AND part_of_speech=item->>'partOfSpeech'
          AND definition_en=item->>'definitionEn' AND translation_uz=item->>'translationUz'
          AND sense_key=item->>'senseKey') THEN
        RAISE EXCEPTION 'reading_pair_meaning_collision: %',item->>'lexemeId';
      END IF;
      SELECT * INTO current_row FROM public.lexical_occurrences WHERE id=(item->>'id')::uuid FOR UPDATE;
      IF FOUND THEN
        IF current_row.source_type <> 'reading' OR current_row.passage_id <> (passage->>'id')::uuid
           OR current_row.start_char <> (item->>'start')::int OR current_row.end_char <> (item->>'end')::int THEN
          RAISE EXCEPTION 'reading_pair_identity_changed: %',item->>'id';
        END IF;
        IF current_row.lexeme_id=(item->>'lexemeId')::uuid AND current_row.surface_form=item->>'surface'
           AND current_row.is_target_vocabulary=(item->>'target')::boolean
           AND current_row.resolution_status='resolved' AND current_row.resolution_source='authored-context' THEN
          CONTINUE;
        END IF;
        IF (item->>'isNew')::boolean OR current_row.lexeme_id IS DISTINCT FROM (item->>'oldLexemeId')::uuid
           OR current_row.surface_form IS DISTINCT FROM item->>'oldSurface' THEN
          RAISE EXCEPTION 'reading_pair_previous_binding_changed: %',item->>'id';
        END IF;
        UPDATE public.lexical_occurrences SET lexeme_id=(item->>'lexemeId')::uuid,
          lexical_unit_id=NULL,surface_form=item->>'surface',
          is_target_vocabulary=(item->>'target')::boolean,
          resolution_status='resolved',resolution_source='authored-context' WHERE id=current_row.id;
      ELSE
        IF NOT (item->>'isNew')::boolean THEN
          RAISE EXCEPTION 'reading_pair_existing_id_missing: %',item->>'id';
        END IF;
        INSERT INTO public.lexical_occurrences(id,passage_id,lexeme_id,source_type,start_char,end_char,
            surface_form,occurrence_type,is_target_vocabulary,resolution_status,resolution_source)
          VALUES((item->>'id')::uuid,(passage->>'id')::uuid,(item->>'lexemeId')::uuid,'reading',
            (item->>'start')::int,(item->>'end')::int,item->>'surface',
            CASE WHEN item->>'surface' ~ '\\s' THEN 'phrase' ELSE 'word' END,
            (item->>'target')::boolean,'resolved','authored-context');
      END IF;
    END LOOP;
  END LOOP;
  SELECT md5(coalesce(string_agg(to_jsonb(v)::text,'' ORDER BY id),''))
    INTO after_users FROM public.user_vocabulary v;
  SELECT md5(coalesce(string_agg(to_jsonb(l)::text,'' ORDER BY id),''))
    INTO after_lexemes FROM public.lexemes l WHERE NOT (id=ANY(planned_ids));
  IF before_users IS DISTINCT FROM after_users OR before_lexemes IS DISTINCT FROM after_lexemes THEN
    RAISE EXCEPTION 'reading_pair_changed_preserved_state';
  END IF;
END $reading_pair$;
""" + ('ROLLBACK;\n' if rollback else 'COMMIT;\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--snapshot', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    args.output.write_text(build_sql(prepare(json.loads(args.plan.read_text()), json.loads(args.snapshot.read_text())), rollback=args.rollback))
