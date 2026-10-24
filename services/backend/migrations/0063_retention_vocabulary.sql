-- Add context-bound vocabulary to immutable Retention versions. No body,
-- rubric, result, timing or existing lexical identity is rewritten.
ALTER TABLE lexical_occurrences ADD COLUMN retention_text_version_id uuid REFERENCES retention_text_versions(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE lexical_occurrences DROP CONSTRAINT lexical_occurrences_source_check;
--> statement-breakpoint
ALTER TABLE lexical_occurrences ADD CONSTRAINT lexical_occurrences_source_check CHECK (
 (source_type = 'reading' AND passage_id IS NOT NULL AND listening_test_id IS NULL AND video_lesson_id IS NULL AND retention_text_version_id IS NULL)
 OR (source_type = 'listening' AND listening_test_id IS NOT NULL AND passage_id IS NULL AND video_lesson_id IS NULL AND retention_text_version_id IS NULL)
 OR (source_type = 'video' AND video_lesson_id IS NOT NULL AND passage_id IS NULL AND listening_test_id IS NULL AND retention_text_version_id IS NULL)
 OR (source_type = 'retention' AND retention_text_version_id IS NOT NULL AND passage_id IS NULL AND listening_test_id IS NULL AND video_lesson_id IS NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX lexical_occurrences_retention_offset_idx ON lexical_occurrences (retention_text_version_id,start_char,end_char) WHERE retention_text_version_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE user_vocabulary_contexts DROP CONSTRAINT user_vocabulary_contexts_source_type_check;
--> statement-breakpoint
ALTER TABLE user_vocabulary_contexts ADD CONSTRAINT user_vocabulary_contexts_source_type_check CHECK (source_type IN ('reading','listening','video','podcast','retention'));
