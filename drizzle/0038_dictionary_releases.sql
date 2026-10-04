CREATE TABLE dictionary_releases (
 id text PRIMARY KEY CHECK (id ~ '^rel-v1-[a-f0-9]{24}$'),
 base_release_id text REFERENCES dictionary_releases(id),
 state text NOT NULL CHECK (state IN ('building','validated','failed')),
 manifest jsonb, manifest_sha text, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), validated_at timestamptz,
 CHECK ((state = 'validated') = (manifest IS NOT NULL AND manifest_sha IS NOT NULL AND validated_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE dictionary_channels (
 name text PRIMARY KEY CHECK (name = 'stable'),
 active_release_id text NOT NULL REFERENCES dictionary_releases(id),
 previous_release_id text REFERENCES dictionary_releases(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE dictionary_entries (
 release_id text NOT NULL REFERENCES dictionary_releases(id), lexeme_id uuid NOT NULL,
 lemma_norm text NOT NULL, part_of_speech text NOT NULL, lexical_type text NOT NULL,
 payload jsonb NOT NULL, content_sha text NOT NULL,
 PRIMARY KEY(release_id,lexeme_id),
 UNIQUE(release_id,lemma_norm,part_of_speech,lexical_type,lexeme_id)
);
--> statement-breakpoint
CREATE INDEX dictionary_entries_identity_idx ON dictionary_entries(release_id,lemma_norm,part_of_speech,lexical_type);
--> statement-breakpoint
CREATE TABLE dictionary_search_terms (
 release_id text NOT NULL, lexeme_id uuid NOT NULL, direction text NOT NULL CHECK(direction IN ('EN','UZ')),
 term text NOT NULL, rank integer NOT NULL CHECK(rank BETWEEN 0 AND 2),
 PRIMARY KEY(release_id,lexeme_id,direction,term),
 FOREIGN KEY(release_id,lexeme_id) REFERENCES dictionary_entries(release_id,lexeme_id)
);
--> statement-breakpoint
CREATE INDEX dictionary_search_prefix_idx ON dictionary_search_terms(release_id,direction,term text_pattern_ops);
--> statement-breakpoint
CREATE TABLE dictionary_sense_mappings (
 sense_id uuid PRIMARY KEY, app_sense_id uuid NOT NULL REFERENCES lexemes(id) ON DELETE RESTRICT,
 app_unit_id uuid REFERENCES lexical_units(id) ON DELETE RESTRICT,
 mapping_method text NOT NULL CHECK(mapping_method IN ('canonical_id','exact_identity','new_canonical')),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX dictionary_sense_app_identity_idx ON dictionary_sense_mappings(app_sense_id);
--> statement-breakpoint
CREATE TABLE dictionary_recent_searches (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 direction text NOT NULL CHECK(direction IN ('EN','UZ')), query_norm text NOT NULL,
 query_display text NOT NULL, lexeme_id uuid NOT NULL,
 searched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,lexeme_id)
);
--> statement-breakpoint
CREATE INDEX dictionary_recent_user_idx ON dictionary_recent_searches(user_id,searched_at DESC);
--> statement-breakpoint
CREATE TABLE dictionary_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL REFERENCES users(id),
 base_release_id text NOT NULL REFERENCES dictionary_releases(id), changes jsonb NOT NULL,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','discarded')),
 result_release_id text REFERENCES dictionary_releases(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE dictionary_owner_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 operation text NOT NULL, entity_id text, base_release_id text, candidate_release_id text,result_release_id text,
 before_state jsonb, after_state jsonb, validation_result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE dictionary_publish_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL REFERENCES users(id),
 base_release_id text NOT NULL REFERENCES dictionary_releases(id), candidate_release_id text NOT NULL REFERENCES dictionary_releases(id),
 draft_ids uuid[] NOT NULL, phase text NOT NULL CHECK(phase IN ('copy','apply','index','validate','activate','complete','failed')),
 cursor_id uuid, error text, updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX dictionary_one_publish_job_idx ON dictionary_publish_jobs((true)) WHERE phase NOT IN ('complete','failed');
--> statement-breakpoint
CREATE FUNCTION dictionary_immutable_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM dictionary_releases WHERE id IN (OLD.release_id, NEW.release_id) AND state = 'validated') THEN
  RAISE EXCEPTION 'immutable_dictionary_release';
 END IF;
 RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER dictionary_entries_immutable BEFORE INSERT OR UPDATE OR DELETE ON dictionary_entries FOR EACH ROW EXECUTE FUNCTION dictionary_immutable_release();
--> statement-breakpoint
CREATE TRIGGER dictionary_terms_immutable BEFORE INSERT OR UPDATE OR DELETE ON dictionary_search_terms FOR EACH ROW EXECUTE FUNCTION dictionary_immutable_release();

--> statement-breakpoint
CREATE FUNCTION dictionary_immutable_registry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state = 'validated' AND (TG_OP = 'DELETE' OR
   ROW(NEW.id,NEW.base_release_id,NEW.state,NEW.manifest,NEW.manifest_sha,NEW.validated_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.base_release_id,OLD.state,OLD.manifest,OLD.manifest_sha,OLD.validated_at)) THEN
  RAISE EXCEPTION 'immutable_dictionary_registry';
 END IF;
 RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER dictionary_registry_immutable BEFORE UPDATE OR DELETE ON dictionary_releases FOR EACH ROW EXECUTE FUNCTION dictionary_immutable_registry();
