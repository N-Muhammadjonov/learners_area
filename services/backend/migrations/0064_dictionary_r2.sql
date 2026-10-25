-- New releases may reference private immutable shards; existing payloads stay intact.
ALTER TABLE dictionary_entries ALTER COLUMN payload DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE dictionary_entries ADD COLUMN storage_shard text,
 ADD COLUMN storage_release text REFERENCES dictionary_releases(id),
 ADD COLUMN search_preview jsonb,
 ADD COLUMN sense_ids uuid[],
 ADD COLUMN example_ids uuid[],
 ADD CONSTRAINT dictionary_payload_location CHECK (
  (payload IS NOT NULL AND storage_shard IS NULL AND storage_release IS NULL) OR
  (payload IS NULL AND storage_release IS NOT NULL AND storage_shard IS NOT NULL AND storage_shard ~ '^[a-f0-9]{2}$' AND storage_shard=left(lexeme_id::text,2)
    AND search_preview IS NOT NULL AND sense_ids IS NOT NULL AND example_ids IS NOT NULL));
--> statement-breakpoint
CREATE TABLE dictionary_r2_shards (
 release_id text NOT NULL REFERENCES dictionary_releases(id),
 shard text NOT NULL CHECK (shard ~ '^[a-f0-9]{2}$'),
 descriptor jsonb NOT NULL,
 PRIMARY KEY(release_id,shard)
);
--> statement-breakpoint
CREATE TRIGGER dictionary_shards_immutable BEFORE INSERT OR UPDATE OR DELETE ON dictionary_r2_shards
 FOR EACH ROW EXECUTE FUNCTION dictionary_immutable_release();
--> statement-breakpoint
ALTER TABLE dictionary_publish_jobs DROP CONSTRAINT dictionary_publish_jobs_phase_check;
--> statement-breakpoint
ALTER TABLE dictionary_publish_jobs ADD CONSTRAINT dictionary_publish_jobs_phase_check
 CHECK (phase IN ('copy','apply','index','validate','offload','activate','complete','failed'));
--> statement-breakpoint
ALTER TABLE dictionary_r2_shards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON dictionary_r2_shards FROM PUBLIC;
