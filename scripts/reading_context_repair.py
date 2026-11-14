"""Build a source-checksummed, idempotent Reading data repair transaction.

This does not connect to a database. Review and test its SQL before executing it
through the approved database connection. Learner data and lexemes are immutable.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from uuid import UUID


def build_sql(manifest: dict, *, rollback: bool = False) -> str:
    if manifest.get('version') != 1 or not isinstance(manifest.get('changes'), list):
        raise ValueError('Unsupported repair manifest')
    ids = set()
    for row in manifest['changes']:
        for key in ('id', 'passageId', 'lexemeId'):
            UUID(row[key])
        if row.get('newLexemeId'):
            UUID(row['newLexemeId'])
        if row['id'] in ids:
            raise ValueError('Duplicate occurrence identity')
        ids.add(row['id'])
        if not re.fullmatch(r'[a-f0-9]{64}', row['sourceSha256']):
            raise ValueError('Invalid canonical source checksum')
        if any(type(row[k]) is not int or row[k] < 0 for k in ('oldStart', 'oldEnd', 'start', 'end')):
            raise ValueError('Invalid source offset')
        if row['end'] <= row['start'] or not row.get('surface'):
            raise ValueError('Empty source span')
        if row.get('newMeaning'):
            meaning = row['newMeaning']
            if not row.get('newLexemeId') or any(not isinstance(meaning.get(key), str) or not meaning[key].strip() for key in ('term','partOfSpeech','definitionEn','translationUz','senseKey')):
                raise ValueError('Incomplete source-specific meaning')
    literal = json.dumps(manifest, ensure_ascii=False, separators=(',', ':')).replace("'", "''")
    if '$reading_repair$' in literal:
        raise ValueError('Invalid SQL delimiter in source manifest')
    return """-- Generated from the reviewed manifest; no user/lexeme deletion or updates.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $reading_repair$
DECLARE
  manifest jsonb := '""" + literal + """'::jsonb;
  item jsonb;
  source text;
  target public.lexical_occurrences%ROWTYPE;
  wanted_surface text;
  wanted_lexeme uuid;
  before_users text;
  after_users text;
BEGIN
  SELECT md5(coalesce(string_agg(to_jsonb(v)::text,'' ORDER BY id),''))
    INTO before_users FROM public.user_vocabulary v;
  FOR item IN SELECT value FROM jsonb_array_elements(manifest->'changes') LOOP
    SELECT body_text INTO STRICT source FROM public.reading_passages
      WHERE id=(item->>'passageId')::uuid FOR SHARE;
    IF encode(sha256(convert_to(source,'UTF8')),'hex') <> item->>'sourceSha256' THEN
      RAISE EXCEPTION 'reading_source_checksum_changed: %',item->>'passageId';
    END IF;
    wanted_surface := coalesce(item->>'newSurface',item->>'surface');
    wanted_lexeme := coalesce(item->>'newLexemeId',item->>'lexemeId')::uuid;
    IF substring(source FROM (item->>'start')::int+1 FOR (item->>'end')::int-(item->>'start')::int) <> wanted_surface THEN
      RAISE EXCEPTION 'reading_repair_surface_mismatch: %',item->>'id';
    END IF;
    IF item ? 'newMeaning' THEN
      INSERT INTO public.lexemes(id,term,part_of_speech,definition_en,translation_uz,sense_key,provenance,verification_status,import_batch)
        VALUES(wanted_lexeme,item->'newMeaning'->>'term',item->'newMeaning'->>'partOfSpeech',
          item->'newMeaning'->>'definitionEn',item->'newMeaning'->>'translationUz',item->'newMeaning'->>'senseKey',
          'authored','verified',manifest->>'release') ON CONFLICT(id) DO NOTHING;
      IF NOT EXISTS(SELECT 1 FROM public.lexemes WHERE id=wanted_lexeme
          AND term=item->'newMeaning'->>'term' AND definition_en=item->'newMeaning'->>'definitionEn'
          AND translation_uz=item->'newMeaning'->>'translationUz'
          AND part_of_speech=item->'newMeaning'->>'partOfSpeech' AND sense_key=item->'newMeaning'->>'senseKey') THEN
        RAISE EXCEPTION 'reading_repair_meaning_changed: %',wanted_lexeme;
      END IF;
    END IF;
    SELECT * INTO STRICT target FROM public.lexical_occurrences
      WHERE id=(item->>'id')::uuid FOR UPDATE;
    IF target.source_type <> 'reading' OR target.passage_id <> (item->>'passageId')::uuid THEN
      RAISE EXCEPTION 'reading_repair_source_identity_changed: %',item->>'id';
    END IF;
    IF target.start_char=(item->>'start')::int AND target.end_char=(item->>'end')::int
       AND target.surface_form=wanted_surface AND target.lexeme_id=wanted_lexeme THEN
      CONTINUE;
    END IF;
    IF target.start_char IS DISTINCT FROM (item->>'oldStart')::int
       OR target.end_char IS DISTINCT FROM (item->>'oldEnd')::int
       OR target.surface_form IS DISTINCT FROM item->>'surface'
       OR target.lexeme_id IS DISTINCT FROM (item->>'lexemeId')::uuid THEN
      RAISE EXCEPTION 'reading_repair_occurrence_changed: %',item->>'id';
    END IF;
    UPDATE public.lexical_occurrences SET
      start_char=(item->>'start')::int,end_char=(item->>'end')::int,
      surface_form=wanted_surface,lexeme_id=wanted_lexeme,
      lexical_unit_id=CASE WHEN lexeme_id=wanted_lexeme THEN lexical_unit_id
        ELSE (SELECT lexical_unit_id FROM public.lexemes WHERE id=wanted_lexeme) END
      WHERE id=target.id;
  END LOOP;
  SELECT md5(coalesce(string_agg(to_jsonb(v)::text,'' ORDER BY id),''))
    INTO after_users FROM public.user_vocabulary v;
  IF before_users IS DISTINCT FROM after_users THEN
    RAISE EXCEPTION 'reading_repair_changed_learner_vocabulary';
  END IF;
END $reading_repair$;
""" + ('ROLLBACK;\n' if rollback else 'COMMIT;\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    args.output.write_text(build_sql(json.loads(args.manifest.read_text()), rollback=args.rollback))
