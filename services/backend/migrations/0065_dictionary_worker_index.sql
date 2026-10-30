-- Optimized releases retain canonical identities and control data in Postgres.
-- Their search index/previews are immutable private R2 objects.
ALTER TABLE dictionary_releases ADD COLUMN delivery text NOT NULL DEFAULT 'legacy'
 CHECK (delivery IN ('legacy','r2-worker-v1'));
--> statement-breakpoint
CREATE TABLE dictionary_search_indexes (
 release_id text PRIMARY KEY REFERENCES dictionary_releases(id),
 descriptor jsonb NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER dictionary_search_index_immutable BEFORE INSERT OR UPDATE OR DELETE ON dictionary_search_indexes
 FOR EACH ROW EXECUTE FUNCTION dictionary_immutable_release();
--> statement-breakpoint
ALTER TABLE dictionary_search_indexes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON dictionary_search_indexes FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE dictionary_entries DROP CONSTRAINT dictionary_payload_location;
--> statement-breakpoint
ALTER TABLE dictionary_entries ADD CONSTRAINT dictionary_payload_location CHECK (
 (payload IS NOT NULL AND storage_shard IS NULL AND storage_release IS NULL) OR
 (payload IS NULL AND storage_release IS NOT NULL AND storage_shard IS NOT NULL
 AND storage_shard ~ '^[a-f0-9]{2}$' AND storage_shard=left(lexeme_id::text,2)
 AND sense_ids IS NOT NULL AND example_ids IS NOT NULL));
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON dictionary_search_indexes,dictionary_r2_shards FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON dictionary_search_indexes,dictionary_r2_shards FROM authenticated;
 END IF;
END $$;
--> statement-breakpoint
ALTER TABLE dictionary_publish_jobs DROP CONSTRAINT dictionary_publish_jobs_phase_check;
--> statement-breakpoint
ALTER TABLE dictionary_publish_jobs ADD CONSTRAINT dictionary_publish_jobs_phase_check
 CHECK (phase IN ('copy','apply','index','validate','offload','worker_index','activate','complete','failed'));
--> statement-breakpoint
ALTER TABLE dictionary_releases DROP CONSTRAINT dictionary_releases_check;
--> statement-breakpoint
ALTER TABLE dictionary_releases ADD CONSTRAINT dictionary_releases_check
 CHECK ((state IN ('validated','retired')) = (manifest IS NOT NULL AND manifest_sha IS NOT NULL AND validated_at IS NOT NULL));
--> statement-breakpoint
-- Retired releases retain their manifest/provenance, but can never be selected
-- for learners. Retirement is an explicit guarded operator action, not activation.
ALTER TABLE dictionary_releases DROP CONSTRAINT dictionary_releases_state_check;
--> statement-breakpoint
ALTER TABLE dictionary_releases ADD CONSTRAINT dictionary_releases_state_check
 CHECK (state IN ('building','validated','failed','retired'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION dictionary_immutable_registry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state='retired' THEN RAISE EXCEPTION 'immutable_dictionary_registry'; END IF;
 IF OLD.state='validated' THEN
  IF TG_OP='UPDATE' AND NEW.state='retired'
    AND (to_jsonb(NEW)-'state')=(to_jsonb(OLD)-'state')
    AND OLD.delivery='legacy'
    AND EXISTS(SELECT 1 FROM dictionary_channels c JOIN dictionary_releases r ON r.id=c.active_release_id WHERE c.name='stable' AND r.state='validated' AND r.delivery='r2-worker-v1')
    AND NOT EXISTS(SELECT 1 FROM dictionary_channels WHERE active_release_id=OLD.id OR previous_release_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM dictionary_publish_jobs WHERE phase NOT IN ('complete','failed') OR candidate_release_id=OLD.id OR base_release_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM dictionary_entries WHERE storage_release=OLD.id AND release_id<>OLD.id)
  THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' OR ROW(NEW.id,NEW.base_release_id,NEW.state,NEW.manifest,NEW.manifest_sha,NEW.validated_at,NEW.delivery)
   IS DISTINCT FROM ROW(OLD.id,OLD.base_release_id,OLD.state,OLD.manifest,OLD.manifest_sha,OLD.validated_at,OLD.delivery)
  THEN RAISE EXCEPTION 'immutable_dictionary_registry'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION dictionary_immutable_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM dictionary_releases WHERE id IN (OLD.release_id,NEW.release_id)
  AND (state='validated' OR (state='retired' AND TG_OP<>'DELETE')))
 THEN RAISE EXCEPTION 'immutable_dictionary_release'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
-- Durable lease works through Supabase transaction pooling and survives restarts.
ALTER TABLE dictionary_publish_jobs ADD COLUMN worker_lease_token uuid,
 ADD COLUMN worker_lease_until timestamptz;
--> statement-breakpoint
-- Numeric identity/location metadata permits one bounded R2 range read per
-- opened entry. Payloads and search previews remain outside PostgreSQL.
ALTER TABLE dictionary_entries ADD COLUMN storage_offset integer,
 ADD COLUMN storage_length integer, ADD COLUMN storage_raw_bytes integer,
 ADD CONSTRAINT dictionary_entry_range CHECK (
 (storage_offset IS NULL AND storage_length IS NULL AND storage_raw_bytes IS NULL) OR
 (payload IS NULL AND storage_shard IS NOT NULL
 AND storage_offset IS NOT NULL AND storage_length IS NOT NULL AND storage_raw_bytes IS NOT NULL
 AND storage_offset>=0 AND storage_length>0 AND storage_raw_bytes>0));
--> statement-breakpoint
-- A single owner-control flag replaces preview JSON for owner summary counts.
ALTER TABLE dictionary_entries ADD COLUMN is_custom boolean NOT NULL DEFAULT false;
