from __future__ import annotations

import asyncio
import base64
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = REPO_ROOT / "services" / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.riwi_portability import (
    RiwiPortabilityError,
    create_portable_archive,
    import_portable_archive,
)
from scripts.riwi_chat_retention_worker import run_retention_worker

TEST_SIGNING_SECRET = "riwi-test-portable-manifest-signing-secret-32b"


class RiwiPhase7PortabilityRetentionTest(unittest.TestCase):
    def test_portability_modes_a_b_c_encryption_tamper_detection_and_dry_run(self) -> None:
        sample_tables = {
            "riwi_knowledge_sources": [
                {"id": "k1", "title": "Approved Grammar", "state": "active", "scope": "global", "created_by_user_id": "u1"},
                {"id": "k2", "title": "Draft Unapproved", "state": "candidate", "scope": "global", "created_by_user_id": "u1"},
            ],
            "riwi_conversations": [
                {"id": "c1", "user_id": "u1", "locale": "uz"},
            ],
            "users": [
                {"id": "u1", "name": "Student One", "password_hash": "secret-hash-do-not-export"},
            ],
            "riwi_action_confirmations": [
                {"id": "conf1", "tool_name": "never_export"},
            ],
        }

        # Missing or short signing secret fails closed (no hardcoded default fallback)
        with patch.dict(os.environ, {"RIWI_PORTABLE_SIGNING_SECRET": "", "AUTH_SECRET": "", "JWT_SECRET": ""}, clear=False):
            with self.assertRaises(RiwiPortabilityError) as ctx_missing:
                create_portable_archive(mode="A", tables_data=sample_tables)
            self.assertEqual(ctx_missing.exception.code, "signing_secret_required")
            with self.assertRaises(RiwiPortabilityError) as ctx_short:
                create_portable_archive(mode="A", tables_data=sample_tables, signing_secret="too-short")
            self.assertEqual(ctx_short.exception.code, "signing_secret_required")

        # Mode A: only approved/active curriculum/knowledge, strips user IDs, excludes conversations & users
        arch_a = create_portable_archive(
            mode="A",
            tables_data=sample_tables,
            signing_secret=TEST_SIGNING_SECRET,
        )
        self.assertEqual(len(arch_a["tables"]["riwi_knowledge_sources"]), 1)
        self.assertIsNone(arch_a["tables"]["riwi_knowledge_sources"][0]["created_by_user_id"])
        self.assertNotIn("riwi_conversations", arch_a["tables"])
        self.assertNotIn("users", arch_a["tables"])
        self.assertNotIn("riwi_action_confirmations", arch_a["tables"])

        # Dry-run import validates without mutating target_store
        store: dict = {}
        dry_res = import_portable_archive(
            arch_a,
            dry_run=True,
            signing_secret=TEST_SIGNING_SECRET,
            target_store=store,
        )
        self.assertTrue(dry_res["dryRun"])
        self.assertFalse(dry_res["applied"])
        self.assertEqual(store, {})

        # Wrong signing secret is rejected on import
        with self.assertRaises(RiwiPortabilityError) as ctx_bad_sig:
            import_portable_archive(
                arch_a,
                dry_run=True,
                signing_secret="wrong-portable-manifest-signing-secret-32b",
                target_store=store,
            )
        self.assertEqual(ctx_bad_sig.exception.code, "manifest_signature_mismatch")

        # Apply import populates target_store
        apply_res = import_portable_archive(
            arch_a,
            dry_run=False,
            signing_secret=TEST_SIGNING_SECRET,
            target_store=store,
        )
        self.assertTrue(apply_res["applied"])
        self.assertIn("riwi_knowledge_sources", store)

        # Mode C requires 32-byte encryption key and produces LAP1 AES-256-GCM envelope
        with self.assertRaises(RiwiPortabilityError):
            create_portable_archive(
                mode="C",
                tables_data=sample_tables,
                encryption_key_b64=None,
                signing_secret=TEST_SIGNING_SECRET,
            )

        key_b64 = base64.b64encode(b"0123456789abcdef0123456789abcdef").decode("ascii")
        arch_c = create_portable_archive(
            mode="C",
            tables_data=sample_tables,
            encryption_key_b64=key_b64,
            signing_secret=TEST_SIGNING_SECRET,
        )
        self.assertTrue(arch_c["manifest"]["encrypted"])
        self.assertIn("envelopeB64", arch_c)

        store_c: dict = {}
        res_c = import_portable_archive(
            arch_c,
            dry_run=False,
            encryption_key_b64=key_b64,
            signing_secret=TEST_SIGNING_SECRET,
            target_store=store_c,
        )
        self.assertTrue(res_c["applied"])
        self.assertNotIn("password_hash", store_c["users"][0])

        # Tampered ciphertext is rejected by AES-GCM authentication tag
        bad_arch = dict(arch_c)
        raw_env = bytearray(base64.b64decode(bad_arch["envelopeB64"]))
        raw_env[-1] ^= 0xFF
        bad_arch["envelopeB64"] = base64.b64encode(bytes(raw_env)).decode("ascii")
        with self.assertRaises(RiwiPortabilityError):
            import_portable_archive(
                bad_arch,
                dry_run=True,
                encryption_key_b64=key_b64,
                signing_secret=TEST_SIGNING_SECRET,
            )

    def test_retention_worker_enforces_dry_run_unless_explicitly_enabled(self) -> None:
        async def run_worker_checks():
            # Even with execute=True, if RIWI_CHAT_RETENTION_DELETE_ENABLED is not true, dryRun remains True
            res_safe = await run_retention_worker(execute=True, conn=None, env={"RIWI_CHAT_RETENTION_DELETE_ENABLED": "false"})
            self.assertTrue(res_safe["dryRun"])
            self.assertFalse(res_safe["deleteEnabledGate"])

            res_enabled = await run_retention_worker(execute=True, conn=None, env={"RIWI_CHAT_RETENTION_DELETE_ENABLED": "true"})
            self.assertFalse(res_enabled["dryRun"])
            self.assertTrue(res_enabled["deleteEnabledGate"])

        asyncio.run(run_worker_checks())


if __name__ == "__main__":
    unittest.main()
