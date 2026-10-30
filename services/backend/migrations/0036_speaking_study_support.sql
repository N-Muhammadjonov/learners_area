ALTER TABLE speaking_prompts ADD COLUMN study_support jsonb NOT NULL DEFAULT '{"vocabularyHtml":"","modelAnswerHtml":"","ideasHtml":"","vocabulary":[]}'::jsonb;
--> statement-breakpoint
ALTER TABLE vocab_folders ALTER COLUMN name TYPE varchar(200);
--> statement-breakpoint
DROP INDEX lexical_occurrences_listening_offset_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX lexical_occurrences_listening_offset_idx ON lexical_occurrences(listening_test_id, section_number, segment_key, start_char, end_char) WHERE listening_test_id IS NOT NULL;
