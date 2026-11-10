from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = REPO_ROOT / "services" / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.riwi_capabilities import ROLE_CAPABILITIES, RiwiActor, authorize_capability
from app.riwi_contracts import FORBIDDEN_REQUEST_KEYS, RiwiContractError, validate_riwi_chat_request
from app.riwi_cursor import RiwiOwnerHistoryCursorError, encode_owner_history_cursor
from app.riwi_gateway import RiwiGatewayError, handle_riwi_chat
from app.riwi_outbound_guard import contains_secret_material, guard_external_payload
from app.riwi_portability import RiwiPortabilityError, create_portable_archive
from app.riwi_role_surface import RiwiTargetScopeError, encode_riwi_target_cursor
from app.riwi_rollout import riwi_enabled_for_role


class RiwiPhase8SecurityQATest(unittest.TestCase):
    def test_no_hardcoded_signing_secrets_exist_in_riwi_modules(self) -> None:
        app_dir = BACKEND_ROOT / "app"
        for py_file in sorted(app_dir.glob("riwi_*.py")):
            text = py_file.read_text(encoding="utf-8")
            self.assertNotIn(
                "riwi-offline-deterministic-cursor-secret",
                text,
                f"Hardcoded cursor secret found in {py_file.name}",
            )
            self.assertNotIn(
                "riwi-portable-manifest-secret",
                text,
                f"Hardcoded portable manifest secret found in {py_file.name}",
            )

        owner = RiwiActor(id="44444444-4444-4444-8444-444444444444", role="owner", account_status="active")
        with patch.dict(
            os.environ,
            {
                "RIWI_CURSOR_SECRET": "",
                "RIWI_PORTABLE_SIGNING_SECRET": "",
                "AUTH_SECRET": "short",
                "JWT_SECRET": "",
            },
            clear=False,
        ):
            with self.assertRaises(RiwiOwnerHistoryCursorError):
                encode_owner_history_cursor(
                    actor=owner,
                    collection="audit_events",
                    after={"sort_at": datetime.now(timezone.utc), "id": owner.id},
                )
            with self.assertRaises(RiwiTargetScopeError):
                encode_riwi_target_cursor(owner, "student", owner.id)
            with self.assertRaises(RiwiPortabilityError):
                create_portable_archive(mode="A", tables_data={})

    def test_forbidden_override_fields_rejected_on_chat_request(self) -> None:
        for field in sorted(FORBIDDEN_REQUEST_KEYS):
            with self.assertRaises(RiwiContractError) as ctx:
                validate_riwi_chat_request({"message": "Hello", field: "override"})
            self.assertEqual(ctx.exception.code, "forbidden_override_field")

    def test_role_escalation_and_inactive_accounts_blocked_everywhere(self) -> None:
        for status in ("pending", "rejected", "suspended"):
            actor = RiwiActor(id="11111111-1111-4111-8111-111111111111", role="owner", account_status=status)
            for cap in ROLE_CAPABILITIES["owner"]:
                self.assertFalse(authorize_capability(actor, cap).allowed)

        student = RiwiActor(id="11111111-1111-4111-8111-111111111111", role="student", account_status="active")
        owner_only_caps = (
            "riwi.knowledge.review",
            "riwi.knowledge.approve",
            "riwi.knowledge.promote",
            "riwi.provider.read_status",
            "riwi.provider.configure",
            "riwi.provider.live_test",
            "riwi.audit.read_all",
        )
        for cap in owner_only_caps:
            self.assertFalse(authorize_capability(student, cap).allowed)

    def test_kill_switch_and_role_rollout_flags_enforced(self) -> None:
        student = RiwiActor(id="11111111-1111-4111-8111-111111111111", role="student", account_status="active")
        self.assertFalse(riwi_enabled_for_role("student", {"RIWI_ENABLED": "false"}))
        self.assertFalse(riwi_enabled_for_role("student", {"RIWI_STUDENT_ENABLED": "false"}))

        async def check_kill_switch():
            with self.assertRaises(RiwiGatewayError) as ctx:
                await handle_riwi_chat(
                    None,
                    student,
                    {"message": "Hello"},
                    env={"RIWI_ENABLED": "false"},
                    now=datetime(2026, 10, 29, 11, 0, tzinfo=timezone.utc),
                )
            self.assertEqual(ctx.exception.status_code, 503)

        asyncio.run(check_kill_switch())

    def test_outbound_guard_blocks_all_secret_patterns_and_redacts_pii(self) -> None:
        self.assertTrue(contains_secret_material("sk-proj-1234567890abcdefghijklmnop"))
        self.assertTrue(contains_secret_material("postgresql://user:pass@localhost:5432/db"))
        res = guard_external_payload(
            "chat",
            {"message": "Contact me at student@example.com or +998901234567", "language": "en", "knowledge": []},
        )
        self.assertTrue(res.ok)
        self.assertNotIn("student@example.com", res.payload["message"])
        self.assertNotIn("+998901234567", res.payload["message"])

    def test_fastapi_main_app_mounts_riwi_routes_with_auth_and_csrf_protection(self) -> None:
        from fastapi.testclient import TestClient
        from app.main import app
        from app.riwi_port import RIWI_API_ROUTES

        client = TestClient(app)
        registered = {(m, r.path) for r in app.routes for m in getattr(r, "methods", ())}
        for method, path, _ in RIWI_API_ROUTES:
            self.assertIn((method, path), registered, f"Missing route {method} {path} on app.main")

        r_unauth = client.post("/api/riwi/chat", json={"message": "Hello"})
        self.assertEqual(r_unauth.status_code, 401)

        r_csrf = client.post(
            "/api/riwi/chat",
            json={"message": "Hello"},
            headers={"Origin": "https://attacker.invalid"},
        )
        self.assertEqual(r_csrf.status_code, 403)


if __name__ == "__main__":
    unittest.main()
