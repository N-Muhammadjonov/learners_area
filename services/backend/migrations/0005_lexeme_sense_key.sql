-- Vocabulary: a word is a SENSE, not a spelling.
--
-- `lexemes.term` was unique, so two senses of one spelling ("resilient" = able to
-- recover / "resilient" = springing back) had to share a single definition. The
-- catalogue is now keyed by sense_key = term | part of speech | first meaning,
-- computed by src/lib/services/vocabulary/dedupe.ts.
--
-- Order matters in this file: the column is added, the existing rows are
-- backfilled, and only then is the unique index created.
ALTER TABLE "lexemes" DROP CONSTRAINT "lexemes_term_unique";--> statement-breakpoint
ALTER TABLE "lexemes" ADD COLUMN "sense_key" varchar(200) DEFAULT '' NOT NULL;--> statement-breakpoint
-- Backfill, mirroring senseKeyOf(): lowercase, collapse whitespace, drop a
-- leading article, bucket the part of speech, keep the first meaning only.
UPDATE "lexemes" SET "sense_key" = concat_ws(
  '|',
  nullif(
    regexp_replace(
      regexp_replace(lower(trim(regexp_replace("term", '\s+', ' ', 'g'))), '^(a|an|the) ', ''),
      '\s+', ' ', 'g'
    ),
    ''
  ),
  nullif(
    case
      when lower(trim(coalesce("part_of_speech", ''))) ~ '^(n|noun)' then 'noun'
      when lower(trim(coalesce("part_of_speech", ''))) ~ '^(v|verb)' then 'verb'
      when lower(trim(coalesce("part_of_speech", ''))) ~ '^(adj|adjective)' then 'adjective'
      when lower(trim(coalesce("part_of_speech", ''))) ~ '^(adv|adverb)' then 'adverb'
      when lower(trim(coalesce("part_of_speech", ''))) ~ '^(phr|phrase|idiom|expression)' then 'phrase'
      when lower(trim(coalesce("part_of_speech", ''))) ~ '^(prep|preposition)' then 'preposition'
      else regexp_replace(lower(trim(coalesce("part_of_speech", ''))), '[^a-z]+', '', 'g')
    end,
    ''
  ),
  nullif(
    left(
      trim(
        regexp_replace(
          regexp_replace(lower(split_part(regexp_replace("definition_en", E'[;,.(\\n]', ',', 'g'), ',', 1)), '\s+', ' ', 'g'),
          '[^a-z0-9'' -]', '', 'g'
        )
      ),
      60
    ),
    ''
  )
);--> statement-breakpoint
-- Point every student entry at its sense. Two rows that collapse onto the same
-- sense and the same student are, by definition, the same word: keep the oldest
-- entry (and its schedule) and drop the later copy.
DELETE FROM "user_vocabulary" v
USING "user_vocabulary" keep, "lexemes" l
WHERE v."lexeme_id" = l."id"
  AND keep."lexeme_id" = l."id"
  AND keep."user_id" = v."user_id"
  AND keep."created_at" < v."created_at";--> statement-breakpoint
UPDATE "user_vocabulary" v
SET "sense_key" = l."sense_key"
FROM "lexemes" l
WHERE v."lexeme_id" = l."id";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lexemes_term_idx" ON "lexemes" USING btree ("term");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lexemes_sense_key_idx" ON "lexemes" USING btree ("sense_key");
