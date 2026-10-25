CREATE TABLE reading_assessments (
 attempt_id uuid PRIMARY KEY REFERENCES reading_attempts(id) ON DELETE CASCADE,
 set_id uuid NOT NULL REFERENCES general_reading_sets(id),
 title text NOT NULL,
 duration_minutes integer NOT NULL DEFAULT 60 CHECK(duration_minutes = 60)
);
--> statement-breakpoint
CREATE TABLE reading_assessment_passages (
 attempt_id uuid NOT NULL REFERENCES reading_assessments(attempt_id) ON DELETE CASCADE,
 passage_id uuid NOT NULL REFERENCES reading_passages(id),
 passage_no integer NOT NULL CHECK(passage_no BETWEEN 1 AND 3),
 PRIMARY KEY(attempt_id,passage_no), UNIQUE(attempt_id,passage_id)
);
