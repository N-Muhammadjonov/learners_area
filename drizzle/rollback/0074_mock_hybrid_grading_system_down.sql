-- Rollback script for 0074_mock_hybrid_grading_system.sql / 20261030230000_mock_hybrid_grading_system.sql
-- Safely removes P1 Mock Hybrid Grading tables and added columns on mock_attempts while preserving
-- original mock_tests, mock_sections, and mock_attempts rows.

DROP TABLE IF EXISTS public.mock_audit_events;
DROP TABLE IF EXISTS public.mock_grading_import_issues;
DROP TABLE IF EXISTS public.mock_grading_revisions;
DROP TABLE IF EXISTS public.mock_grading_batches;
DROP TABLE IF EXISTS public.mock_speaking_audio;
DROP TABLE IF EXISTS public.mock_writing_answers;
DROP TABLE IF EXISTS public.mock_section_submissions;

DROP INDEX IF EXISTS public.mock_attempts_user_weekly_slot_uq;
DROP INDEX IF EXISTS public.mock_attempts_user_status_idx;

ALTER TABLE public.mock_attempts DROP COLUMN IF EXISTS section_deadlines;
ALTER TABLE public.mock_attempts DROP COLUMN IF EXISTS active_section_position;
ALTER TABLE public.mock_attempts DROP COLUMN IF EXISTS content_snapshot_hash;
ALTER TABLE public.mock_attempts DROP COLUMN IF EXISTS deadline_at;
ALTER TABLE public.mock_attempts DROP COLUMN IF EXISTS finalized_at;
ALTER TABLE public.mock_attempts DROP COLUMN IF EXISTS submitted_at;
ALTER TABLE public.mock_attempts DROP COLUMN IF EXISTS weekly_slot;
ALTER TABLE public.mock_attempts DROP COLUMN IF EXISTS schedule_id;

DROP TABLE IF EXISTS public.mock_schedules;
