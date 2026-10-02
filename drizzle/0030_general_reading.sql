-- 0030 General Reading (docs/VOCABULARY-ARCHITECTURE.md, B18).
-- Additive only: three NEW tables. No existing table, column, row or id changes.
-- Mode is explicit and server-verifiable: a reading passage is GENERAL_PRACTICE
-- only if it has a row in general_reading_passages (reading_mode is pinned to
-- 'general_practice'). Every existing passage has no such row and therefore keeps
-- its current IELTS Academic meaning. Nothing is reclassified.
CREATE TABLE general_reading_sets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title varchar(200) NOT NULL,
 description text,
 difficulty_level varchar(10),
 publication_state publication_state NOT NULL DEFAULT 'published',
 publish_at timestamptz,
 source_ref varchar(80),
 created_at timestamptz NOT NULL DEFAULT now()
)
--> statement-breakpoint
CREATE UNIQUE INDEX general_reading_sets_source_ref_idx ON general_reading_sets (source_ref) WHERE source_ref IS NOT NULL
--> statement-breakpoint
CREATE TABLE general_reading_passages (
 passage_id uuid PRIMARY KEY REFERENCES reading_passages(id) ON DELETE CASCADE,
 set_id uuid NOT NULL REFERENCES general_reading_sets(id) ON DELETE CASCADE,
 passage_no smallint NOT NULL CHECK (passage_no BETWEEN 1 AND 3),
 reading_mode varchar(24) NOT NULL DEFAULT 'general_practice' CHECK (reading_mode = 'general_practice')
)
--> statement-breakpoint
CREATE UNIQUE INDEX general_reading_passages_slot_idx ON general_reading_passages (set_id, passage_no)
--> statement-breakpoint
CREATE TABLE general_reading_progress (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 set_id uuid NOT NULL REFERENCES general_reading_sets(id) ON DELETE CASCADE,
 passage_id uuid NOT NULL REFERENCES reading_passages(id) ON DELETE CASCADE,
 answers jsonb NOT NULL DEFAULT '{}'::jsonb,
 score integer,
 total integer,
 checked_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
)
--> statement-breakpoint
CREATE UNIQUE INDEX general_reading_progress_owner_idx ON general_reading_progress (user_id, passage_id)
--> statement-breakpoint
CREATE INDEX general_reading_progress_set_idx ON general_reading_progress (user_id, set_id)
