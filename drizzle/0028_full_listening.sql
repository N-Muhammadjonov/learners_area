CREATE TABLE listening_packages (
 test_id uuid PRIMARY KEY REFERENCES listening_tests(id) ON DELETE CASCADE,
 source_id varchar(80) NOT NULL UNIQUE, payload jsonb NOT NULL,
 audio_object_key text NOT NULL, image_object_key text, source_hash varchar(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE listening_activity_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 test_id uuid NOT NULL REFERENCES listening_packages(test_id) ON DELETE CASCADE,
 activity integer NOT NULL CHECK (activity BETWEEN 2 AND 5), speed_rate real CHECK(speed_rate IN (1,1.25,1.5,1.75,2)), answers jsonb NOT NULL DEFAULT '{}',
 score integer, total integer, completed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX listening_activity_owner_test_idx ON listening_activity_runs(user_id,test_id);
--> statement-breakpoint
CREATE TABLE listening_drafts (
 attempt_id uuid PRIMARY KEY REFERENCES listening_attempts(id) ON DELETE CASCADE,
 answers jsonb NOT NULL DEFAULT '{}', audio_position real NOT NULL DEFAULT 0 CHECK(audio_position >= 0),
 audio_started_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
