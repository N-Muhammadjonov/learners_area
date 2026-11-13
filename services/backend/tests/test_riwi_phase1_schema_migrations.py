from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sqlite3
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PRISTINE_MAIN = Path("/tmp/learners_area_pristine_main")
DRIZZLE_DIR = REPO_ROOT / "drizzle"
BACKEND_MIGRATIONS_DIR = REPO_ROOT / "services" / "backend" / "migrations"
JOURNAL_PATH = DRIZZLE_DIR / "meta" / "_journal.json"
SCHEMA_TS_PATH = REPO_ROOT / "src" / "db" / "schema.ts"
BACKEND_DIR = REPO_ROOT / "services" / "backend"


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

    def test_forward_only_migrations_0075_to_0078_exist_and_match_in_both_dirs_without_0070_0071_collision(self) -> None:
        expected_names = [
            "0075_riwi_core_and_governance.sql",
            "0076_riwi_assessments_and_security_signals.sql",
            "0077_riwi_speaking_sessions_and_activity_indexes.sql",
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

    def test_journal_has_contiguous_indices_and_preserves_0071_shared_abuse_limits(self) -> None:
        journal = json.loads(JOURNAL_PATH.read_text(encoding="utf-8"))
        entries = journal["entries"]
        self.assertEqual(len(entries), 82)
        self.assertEqual(entries[79]["tag"], "0080_study_plan")
        self.assertEqual(entries[81]["tag"], "0082_live_partner_features")
        for idx, entry in enumerate(entries):
            self.assertEqual(entry["idx"], idx)
        self.assertEqual(entries[69]["tag"], "0069_video_progress_playback_duration")
        self.assertEqual(entries[70]["tag"], "0071_shared_abuse_limits")
        self.assertEqual(entries[74]["tag"], "0075_riwi_core_and_governance")
        self.assertEqual(entries[75]["tag"], "0076_riwi_assessments_and_security_signals")
        self.assertEqual(entries[76]["tag"], "0077_riwi_speaking_sessions_and_activity_indexes")

    def test_riwi_tables_enums_and_constraints_in_sql_and_schema_ts(self) -> None:
        combined_sql = "\n".join(
            (DRIZZLE_DIR / name).read_text(encoding="utf-8")
            for name in [
                "0075_riwi_core_and_governance.sql",
                "0076_riwi_assessments_and_security_signals.sql",
                "0077_riwi_speaking_sessions_and_activity_indexes.sql",
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

    def test_postgresql_ddl_catalog_fk_and_reconciled_audit_inventories(self) -> None:
        # 1. Verify reconciled PORT_STATUS.json and MIGRATION_AUDIT_*.json preserve historical evidence
        port_status = json.loads((BACKEND_DIR / "PORT_STATUS.json").read_text(encoding="utf-8"))
        self.assertEqual(port_status["total_methods"], 345)
        self.assertEqual(port_status["canonical_pre_riwi_methods"], 311)
        self.assertEqual(port_status["historical_step40_ported_methods"], 272)
        self.assertEqual(port_status["post_step40_main_additive_methods"], 1)
        self.assertEqual(port_status["riwi_methods"], 34)
        self.assertEqual(len(port_status["historical_endpoints"]), 272)
        self.assertEqual(len(port_status["post_port_additive_endpoints"]), 32)

        for audit_name in ("MIGRATION_AUDIT_260.json", "MIGRATION_AUDIT_265.json"):
            audit = json.loads((BACKEND_DIR / audit_name).read_text(encoding="utf-8"))
            self.assertEqual(audit["historical_sql_count"], 66)
            self.assertEqual(len(audit["sql_sha256_by_filename"]), 66)
            self.assertEqual(len(audit["post_audit_main_additive_sql_sha256_by_filename"]), 5)
            self.assertEqual(len(audit["riwi_additive_sql_sha256_by_filename"]), 3)
            self.assertEqual(audit["current_total_sql_count"], 74)

        # 2. Build relational catalog across all migrations and validate FKs, ALTERs, and indexes
        all_sql_files = sorted(DRIZZLE_DIR.glob("*.sql"))
        # Main adds unrelated migrations; the immutable RIWI files and their
        # checksums are pinned above rather than freezing the whole repository.
        self.assertGreaterEqual(len(all_sql_files), 82)
        known_tables: set[str] = set()
        for sql_file in all_sql_files:
            content = sql_file.read_text(encoding="utf-8")
            for m in re.finditer(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?', content, re.I):
                known_tables.add(m.group(1))

        active_indexes: set[str] = set()
        for name in (
            "0075_riwi_core_and_governance.sql",
            "0076_riwi_assessments_and_security_signals.sql",
            "0077_riwi_speaking_sessions_and_activity_indexes.sql",
        ):
            sql = (DRIZZLE_DIR / name).read_text(encoding="utf-8")
            for line in sql.splitlines():
                drop_idx = re.search(r'DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?', line, re.I)
                if drop_idx:
                    active_indexes.discard(drop_idx.group(1))
                create_idx = re.search(
                    r'CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?\s+ON\s+"?([a-zA-Z0-9_]+)"?',
                    line,
                    re.I,
                )
                if create_idx:
                    idx_name, tbl_name = create_idx.group(1), create_idx.group(2)
                    self.assertNotIn(idx_name, active_indexes, f"Duplicate un-dropped index {idx_name} in {name}")
                    self.assertIn(tbl_name, known_tables, f"Index {idx_name} on unknown table {tbl_name} in {name}")
                    active_indexes.add(idx_name)

            for m in re.finditer(
                r'REFERENCES\s+(?:"?public"?\.)?"?([a-zA-Z0-9_]+)"?\s*\(\s*"?([a-zA-Z0-9_]+)"?\s*\)',
                sql,
                re.I,
            ):
                ref_table = m.group(1)
                self.assertIn(ref_table, known_tables, f"Unknown FK target table {ref_table} in {name}")
            for m in re.finditer(r'ALTER\s+TABLE\s+"?([a-zA-Z0-9_]+)"?', sql, re.I):
                target_table = m.group(1)
                self.assertIn(target_table, known_tables, f"Unknown ALTER TABLE target {target_table} in {name}")

        # 3. Execute relational DDL & FK integrity check in in-memory SQLite engine
        conn = sqlite3.connect(":memory:")
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.executescript(
            """
            CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, role TEXT, account_status TEXT, last_active_at TEXT);
            CREATE TABLE audit_log (id TEXT PRIMARY KEY, created_at TEXT);
            CREATE TABLE evaluations (id TEXT PRIMARY KEY);
            CREATE TABLE writing_grade_requests (id TEXT PRIMARY KEY);
            CREATE TABLE speaking_prompts (id TEXT PRIMARY KEY);
            CREATE TABLE speaking_attempts (id TEXT PRIMARY KEY, transcript_origin TEXT);
            """
        )
        for name in (
            "0075_riwi_core_and_governance.sql",
            "0076_riwi_assessments_and_security_signals.sql",
            "0077_riwi_speaking_sessions_and_activity_indexes.sql",
        ):
            sql = (DRIZZLE_DIR / name).read_text(encoding="utf-8")
            for m in re.finditer(
                r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([a-zA-Z0-9_]+)"\s*\(([\s\S]*?)^\);',
                sql,
                re.M,
            ):
                tbl = m.group(1)
                body = m.group(2)
                cols = []
                for raw_line in body.splitlines():
                    line = raw_line.strip().rstrip(",")
                    if not line or line.upper().startswith("CONSTRAINT"):
                        continue
                    col_m = re.match(
                        r'^"([a-zA-Z0-9_]+)"\s+(?:uuid|varchar|text|integer|smallint|boolean|jsonb|timestamp|"riwi_|"role"|"speaking_)',
                        line,
                        re.I,
                    )
                    if col_m:
                        col_name = col_m.group(1)
                        pk = "PRIMARY KEY" if "PRIMARY KEY" in line.upper() else ""
                        not_null = "NOT NULL" if "NOT NULL" in line.upper() and not pk else ""
                        cols.append(f'"{col_name}" TEXT {pk} {not_null}'.strip())
                conn.execute(f'CREATE TABLE "{tbl}" ({", ".join(cols)});')

        created_riwi_tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        self.assertTrue(
            {
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
            }
            <= created_riwi_tables
        )
        conn.close()


if __name__ == "__main__":
    unittest.main()
