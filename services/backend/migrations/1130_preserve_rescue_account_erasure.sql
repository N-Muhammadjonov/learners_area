-- Preserve account erasure for learner-owned support history. On PostgreSQL
-- even an empty foreign-key UPDATE invokes statement-level journal guards.
ALTER TABLE academy_rescue_cases DROP CONSTRAINT academy_rescue_cases_student_id_fkey;
ALTER TABLE academy_rescue_cases ADD CONSTRAINT academy_rescue_cases_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE academy_rescue_actions DROP CONSTRAINT academy_rescue_actions_group_id_student_id_fkey;
ALTER TABLE academy_rescue_actions ADD CONSTRAINT academy_rescue_actions_group_id_student_id_fkey
    FOREIGN KEY (group_id, student_id) REFERENCES academy_rescue_cases(group_id, student_id) ON DELETE CASCADE;
--> statement-breakpoint
-- Actual journal rows remain protected from every update or delete, including
-- foreign-key changes. A zero-row statement has no journal data to protect.
DROP TRIGGER finance_journal_lines_append_only ON finance_journal_lines;
CREATE TRIGGER finance_journal_lines_append_only
    BEFORE UPDATE OR DELETE ON finance_journal_lines
    FOR EACH ROW EXECUTE FUNCTION finance_journal_immutable_guard();
DROP TRIGGER finance_journal_entries_append_only ON finance_journal_entries;
CREATE TRIGGER finance_journal_entries_append_only
    BEFORE UPDATE OR DELETE ON finance_journal_entries
    FOR EACH ROW EXECUTE FUNCTION finance_journal_immutable_guard();
