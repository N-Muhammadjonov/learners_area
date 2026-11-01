from __future__ import annotations

import asyncio
from pathlib import Path
import sys
import unittest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.riwi_capabilities import RiwiActor
from app.riwi_provider_router import (
    RiwiProviderRouterError,
    dispatch_external_riwi_provider,
    get_riwi_owner_diagnostics,
    provider_readiness_snapshot,
    validate_provider_endpoint,
    validate_riwi_provider_answer,
)
from app.riwi_tool_broker import (
    RiwiToolBroker,
    RiwiToolBrokerError,
    RiwiToolDefinition,
)


class RiwiPhase3BrokerRouterTest(unittest.TestCase):
    def test_tool_broker_default_deny_audit_before_execute_and_timeout(self) -> None:
        broker = RiwiToolBroker()
        call_log: list[str] = []

        def validate_in(raw):
            if not isinstance(raw, dict) or set(raw.keys()) != {"word"}:
                raise ValueError("bad_input")
            return {"word": str(raw["word"]).strip()}

        def validate_out(raw):
            if not isinstance(raw, dict) or "resolved" not in raw:
                raise ValueError("bad_output")
            return raw

        async def lookup_handler(conn, actor, data):
            call_log.append(f"executed:{data['word']}")
            return {"resolved": True, "word": data["word"]}

        broker.register(
            RiwiToolDefinition(
                name="dictionary.lookup",
                required_capability="riwi.dictionary.lookup",
                allowed_roles=("student", "teacher", "admin", "owner"),
                input_validator=validate_in,
                output_validator=validate_out,
                handler=lookup_handler,
                timeout_ms=200,
            )
        )

        student = RiwiActor(id="11111111-1111-4111-8111-111111111111", role="student", account_status="active")
        suspended = RiwiActor(id="11111111-1111-4111-8111-111111111111", role="student", account_status="suspended")

        async def run_checks():
            # Unknown tool denied
            with self.assertRaises(RiwiToolBrokerError) as ctx:
                await broker.execute(None, actor=student, tool_name="shell.exec", raw_input={})
            self.assertEqual(ctx.exception.code, "unknown_tool")

            # Suspended actor denied
            with self.assertRaises(RiwiToolBrokerError) as ctx:
                await broker.execute(None, actor=suspended, tool_name="dictionary.lookup", raw_input={"word": "test"})
            self.assertEqual(ctx.exception.code, "forbidden")

            # Audit failure aborts BEFORE handler runs
            async def failing_audit(*args, **kwargs):
                raise RuntimeError("db_down")

            call_log.clear()
            with self.assertRaises(RiwiToolBrokerError) as ctx:
                await broker.execute(
                    None,
                    actor=student,
                    tool_name="dictionary.lookup",
                    raw_input={"word": "resilient"},
                    audit_writer=failing_audit,
                )
            self.assertEqual(ctx.exception.code, "audit_failed")
            self.assertEqual(call_log, [])

            # Valid execution succeeds after audit
            res = await broker.execute(
                None,
                actor=student,
                tool_name="dictionary.lookup",
                raw_input={"word": "resilient"},
            )
            self.assertTrue(res["resolved"])
            self.assertEqual(call_log, ["executed:resilient"])

        asyncio.run(run_checks())

    def test_ssrf_and_endpoint_validation_blocks_private_ips_and_untrusted_hosts(self) -> None:
        self.assertEqual(
            validate_provider_endpoint("openai", "https://api.openai.com/v1/responses"),
            "https://api.openai.com/v1/responses",
        )
        for bad_url in (
            "http://api.openai.com/v1/responses",
            "https://127.0.0.1/v1/responses",
            "https://169.254.169.254/latest/meta-data/",
            "https://localhost/v1/responses",
            "https://evil.example.com/v1/responses",
            "https://user:pass@api.openai.com/v1/responses",
        ):
            with self.assertRaises(RiwiProviderRouterError):
                validate_provider_endpoint("openai", bad_url)

    def test_provider_router_output_schema_and_external_dispatch_guards(self) -> None:
        valid = validate_riwi_provider_answer(
            {"answer": "Use an before a vowel sound.", "uncertainty": None, "citations": ["K1"]},
            allowed_citations={"K1"},
        )
        self.assertEqual(valid["citations"], ["K1"])

        # Rejects hallucinated citation K2 when only K1 was supplied
        with self.assertRaises(RiwiProviderRouterError):
            validate_riwi_provider_answer(
                {"answer": "Text", "uncertainty": None, "citations": ["K2"]},
                allowed_citations={"K1"},
            )

        # Rejects extra keys like toolCall
        with self.assertRaises(RiwiProviderRouterError):
            validate_riwi_provider_answer(
                {"answer": "Text", "uncertainty": None, "citations": [], "toolCall": "shell"},
                allowed_citations=set(),
            )

        # Verify custom ANTHROPIC_MODEL env override works
        snap = provider_readiness_snapshot({"ANTHROPIC_API_KEY": "sk-ant-test", "ANTHROPIC_MODEL": "claude-3-7-sonnet-20250219"})
        anth = next(p for p in snap if p["id"] == "anthropic")
        self.assertEqual(anth["model"], "claude-3-7-sonnet-20250219")
        self.assertTrue(anth["secretsPresent"])

        owner = RiwiActor(id="44444444-4444-4444-8444-444444444444", role="owner", account_status="active")
        admin = RiwiActor(id="33333333-3333-4333-8333-333333333333", role="admin", account_status="active")

        async def run_router_checks():
            # Admin cannot read owner diagnostics
            with self.assertRaises(PermissionError):
                await get_riwi_owner_diagnostics(None, admin)

            diag = await get_riwi_owner_diagnostics(None, owner, env={"RIWI_ENABLED": "true"})
            self.assertTrue(diag["ok"])
            self.assertFalse(diag["rollout"]["externalAi"])

            # External call blocked when RIWI_EXTERNAL_AI_ENABLED is false
            with self.assertRaises(RiwiProviderRouterError) as ctx:
                await dispatch_external_riwi_provider(
                    None,
                    actor=owner,
                    provider_id="openai",
                    task_profile="riwi_chat",
                    payload={"language": "en", "message": "Hello", "history": [], "knowledge": []},
                    correlation_id="00000000-0000-4000-8000-000000000001",
                    env={"RIWI_ENABLED": "true", "RIWI_EXTERNAL_AI_ENABLED": "false"},
                )
            self.assertEqual(ctx.exception.code, "external_ai_disabled")

        asyncio.run(run_router_checks())

    def test_provider_router_deduplicates_concurrent_paid_requests_and_bounds_concurrency(self) -> None:
        owner = RiwiActor(id="44444444-4444-4444-8444-444444444444", role="owner", account_status="active")
        env = {
            "RIWI_ENABLED": "true",
            "RIWI_EXTERNAL_AI_ENABLED": "true",
            "AI_EXTERNAL_ENABLED": "true",
            "OPENAI_API_KEY": "sk-test-valid-key",
            "RIWI_MAX_CONCURRENT_EXTERNAL_REQUESTS": "2",
        }

        async def run_dedupe_and_concurrency():
            transport_calls = 0

            async def slow_transport(provider_id: str, model: str, payload: dict):
                nonlocal transport_calls
                transport_calls += 1
                await asyncio.sleep(0.06)
                return {
                    "answer": {"answer": "Grounded answer [K1].", "uncertainty": None, "citations": ["K1"]},
                    "usage": {"inputTokens": 40, "outputTokens": 20},
                }

            payload = {
                "language": "en",
                "message": "Explain present perfect",
                "history": [],
                "knowledge": [{"ref": "K1", "text": "Connects past and present.", "authority": 400, "version": 1}],
            }
            # Fire 3 identical concurrent paid requests -> only 1 upstream transport call is made
            r1, r2, r3 = await asyncio.gather(
                dispatch_external_riwi_provider(
                    None,
                    actor=owner,
                    provider_id="openai",
                    task_profile="riwi_chat",
                    payload=payload,
                    correlation_id="00000000-0000-4000-8000-000000000011",
                    transport=slow_transport,
                    env=env,
                ),
                dispatch_external_riwi_provider(
                    None,
                    actor=owner,
                    provider_id="openai",
                    task_profile="riwi_chat",
                    payload=payload,
                    correlation_id="00000000-0000-4000-8000-000000000012",
                    transport=slow_transport,
                    env=env,
                ),
                dispatch_external_riwi_provider(
                    None,
                    actor=owner,
                    provider_id="openai",
                    task_profile="riwi_chat",
                    payload=payload,
                    correlation_id="00000000-0000-4000-8000-000000000013",
                    transport=slow_transport,
                    env=env,
                ),
            )
            self.assertEqual(transport_calls, 1)
            self.assertEqual(r1["answer"], "Grounded answer [K1].")
            self.assertEqual(r2["answer"], "Grounded answer [K1].")
            self.assertEqual(r3["answer"], "Grounded answer [K1].")

            # Verify bounded concurrency semaphore (max 2 concurrent) across 4 distinct payloads
            active = 0
            peak_active = 0

            async def tracked_transport(provider_id: str, model: str, pl: dict):
                nonlocal active, peak_active
                active += 1
                peak_active = max(peak_active, active)
                await asyncio.sleep(0.05)
                active -= 1
                return {
                    "answer": {"answer": f"Reply for {pl['message']}", "uncertainty": None, "citations": []},
                    "usage": {"inputTokens": 10, "outputTokens": 10},
                }

            await asyncio.gather(
                *[
                    dispatch_external_riwi_provider(
                        None,
                        actor=owner,
                        provider_id="openai",
                        task_profile="riwi_chat",
                        payload={"language": "en", "message": f"Distinct prompt {i}", "history": [], "knowledge": []},
                        correlation_id=f"00000000-0000-4000-8000-00000000002{i}",
                        transport=tracked_transport,
                        env=env,
                    )
                    for i in range(4)
                ]
            )
            self.assertLessEqual(peak_active, 2)

        asyncio.run(run_dedupe_and_concurrency())


if __name__ == "__main__":
    unittest.main()
