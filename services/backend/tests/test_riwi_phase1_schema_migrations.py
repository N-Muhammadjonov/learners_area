from __future__ import annotations

import hashlib
import json
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PRISTINE_MAIN = Path("/tmp/learners_area_pristine_main")
DRIZZLE_DIR = REPO_ROOT / "drizzle"
BACKEND_MIGRATIONS_DIR = REPO_ROOT / "services" / "backend" / "migrations"
JOURNAL_PATH = DRIZZLE_DIR / "meta" / "_journal.json"
SCHEMA_TS_PATH = REPO_ROOT / "src" / "db" / "schema.ts"


class RiwiPhase1SchemaMigrationsTest(unittest.TestCase):
    def test_existing_migrations_0000_to_0069_and_0071_are_unmodified(self) -> None:
        if not PRISTINE_MAIN.exists():
            return
        for pristine_file in sorted((PRISTINE_MAIN / "services" / "backend" / "migrations").glob("*.sql")):
            curr_backend = BACKEND_MIGRATIONS_DIR / pristine_file.name
            self.assertTrue(curr_backend.exists(), f"Missing {curr_backend}")
            expected_sha = hashlib.sha256(pristine_file.read_bytes()).hexdigest()
            self.assertEqual(hashlib.sha256(curr_backend.read_bytes()).hexdigest(), expected_sha)
            pristine_drizzle = PRISTINE_MAIN / "drizzle" / pristine_file.name
            if pristine_drizzle.exists():
                curr_drizzle = DRIZZLE_DIR / pristine_file.name
                self.assertTrue(curr_drizzle.exists(), f"Missing {curr_drizzle}")
                self.assertEqual(hashlib.sha256(curr_drizzle.read_bytes()).hexdigest(), expected_sha)

    def test_forward_only_migrations_0072_to_0074_exist_and_match_in_both_dirs_without_0070_0071_collision(self) -> None:
        expected_names = [
            "0072_riwi_core_and_governance.sql",
            "0073_riwi_assessments_and_security_signals.sql",
            "0074_riwi_speaking_sessions_and_activity_indexes.sql",
        ]
        for name in expected_names:
            d_file = DRIZZLE_DIR / name
            b_file = BACKEND_MIGRATIONS_DIR / name
            self.assertTrue(d_file.exists(), f"Missing drizzle/{name}")
            self.assertTrue(b_file.exists(), f"Missing services/backend/migrations/{name}")
            self.assertEqual(d_file.read_text(encoding="utf-8"), b_file.read_text(encoding="utf-8"))
        self.assertTrue((BACKEND_MIGRATIONS_DIR / "0071_shared_abuse_limits.sql").exists())
        self.assertFalse((BACKEND_MIGRATIONS_DIR / "0070_riwi_core_and_governance.sql").exists())
        self.assertFalse((BACKEND_MIGRATIONS_DIR / "0071_riwi_assessments_and_security_signals.sql").exists())

    def test_journal_has_contiguous_indices_0_to_73_and_preserves_0071_shared_abuse_limits(self) -> None:
        journal = json.loads(JOURNAL_PATH.read_text(encoding="utf-8"))
        entries = journal["entries"]
        self.assertEqual(len(entries), 74)
        for idx, entry in enumerate(entries):
            self.assertEqual(entry["idx"], idx)
        self.assertEqual(entries[69]["tag"], "0069_video_progress_playback_duration")
        self.assertEqual(entries[70]["tag"], "0071_shared_abuse_limits")
        self.assertEqual(entries[71]["tag"], "0072_riwi_core_and_governance")
        self.assertEqual(entries[72]["tag"], "0073_riwi_assessments_and_security_signals")
        self.assertEqual(entries[73]["tag"], "0074_riwi_speaking_sessions_and_activity_indexes")

    def test_riwi_tables_enums_and_constraints_in_sql_and_schema_ts(self) -> None:
        combined_sql = "\n".join(
            (DRIZZLE_DIR / name).read_text(encoding="utf-8")
            for name in [
                "0072_riwi_core_and_governance.sql",
                "0073_riwi_assessments_and_security_signals.sql",
                "0074_riwi_speaking_sessions_and_activity_indexes.sql",
            ]
        )
        required_tables = [
            "riwi_knowledge_sources",
            "riwi_knowledge_units",
            "riwi_knowledge_conflicts",
            "riwi_learning_signals",
            "riwi_learning_reviews",
            "riwi_conversations",
            "riwi_conversation_messages",
            "riwi_action_confirmations",
            "riwi_provider_experiments",
            "riwi_provider_experiment_results",
            "riwi_usage_metrics",
            "riwi_assessment_policies",
            "riwi_assessment_policy_versions",
            "riwi_security_signals",
            "speaking_ai_sessions",
            "speaking_ai_session_items",
        ]
        for table in required_tables:
            self.assertIn(f'"{table}"', combined_sql, f"Missing table {table} in 0072..0074 SQL")

        schema_ts = SCHEMA_TS_PATH.read_text(encoding="utf-8")
        for ts_symbol in [
            "apiRateBuckets",
            "riwiKnowledgeSources",
            "riwiKnowledgeUnits",
            "riwiKnowledgeConflicts",
            "riwiLearningSignals",
            "riwiLearningReviews",
            "riwiConversations",
            "riwiConversationMessages",
            "riwiActionConfirmations",
            "riwiProviderExperiments",
            "riwiProviderExperimentResults",
            "riwiAssessmentPolicies",
            "riwiAssessmentPolicyVersions",
            "riwiUsageMetrics",
            "riwiSecuritySignals",
            "speakingAiSessions",
            "speakingAiSessionItems",
            "assessmentContractKey",
            "ownerPolicyScope",
            "ownerPolicyVersion",
            "teachingFeedback",
        ]:
            self.assertIn(ts_symbol, schema_ts, f"Missing symbol {ts_symbol} in src/db/schema.ts")


if __name__ == "__main__":
    unittest.main()
