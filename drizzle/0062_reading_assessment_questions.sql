-- Capture the exact 40 questions at Start. Original General questions are retained.
-- Existing attempts with no selection keep their original passage scope.
CREATE TABLE reading_assessment_questions (
 attempt_id uuid NOT NULL REFERENCES reading_assessments(attempt_id) ON DELETE CASCADE,
 question_id uuid NOT NULL REFERENCES reading_questions(id),
 position integer NOT NULL CHECK(position BETWEEN 1 AND 40),
 PRIMARY KEY(attempt_id,position),
 UNIQUE(attempt_id,question_id)
);
--> statement-breakpoint
ALTER TABLE reading_assessment_questions ENABLE ROW LEVEL SECURITY;
