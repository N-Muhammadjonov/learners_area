"""Offline Gemini transport tests; never send learner data or live API calls."""
from __future__ import annotations

import asyncio
import json
import os
import unittest
from unittest.mock import AsyncMock, patch

from app.gemini_adapter import request_gemini_json
from app.owner_ai_control_port import registry
from app.step31_coach import meta, record


class GeminiAdapterTests(unittest.TestCase):
    def test_uses_backend_secret_and_existing_ai_meter(self) -> None:
        answer: dict[str, object] = {"answer": "Test feedback", "issues": []}
        response = {
            "candidates": [
                {
                    "finishReason": "STOP",
                    "content": {"parts": [{"text": json.dumps(answer)}]},
                }
            ]
        }
        request = AsyncMock(return_value=(200, response))
        with patch.dict(os.environ, {"GEMINI_API_KEY": "fake-test-key"}, clear=False):
            with patch("app.gemini_adapter.request_json", request):
                actual = asyncio.run(
                    request_gemini_json(
                        "test-actor",
                        "gemini-3.8-flash",
                        "Assessment instructions",
                        {"essay": "This is a test."},
                    )
                )
        self.assertEqual(actual, answer)
        args, kwargs = request.await_args
        self.assertEqual(args[0], "test-actor")
        self.assertEqual(args[2]["x-goog-api-key"], "fake-test-key")
        self.assertEqual(kwargs["payload"]["generationConfig"]["responseMimeType"], "application/json")
        self.assertEqual(kwargs["payload"]["generationConfig"]["thinkingConfig"]["thinkingLevel"], "low")
        self.assertTrue(kwargs["with_status"])
        self.assertNotIn("fake-test-key", json.dumps(kwargs["payload"]))
        self.assertEqual(args[1], "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent")

    def test_rejects_truncated_output_without_a_second_request(self) -> None:
        request = AsyncMock(return_value=(200, {
            "candidates": [{
                "finishReason": "MAX_TOKENS",
                "content": {"parts": [{"text": '{"answer": "partial"}'}]},
            }]
        }))
        with patch.dict(os.environ, {"GEMINI_API_KEY": "fake-test-key"}, clear=False):
            with patch("app.gemini_adapter.request_json", request):
                result = asyncio.run(
                    request_gemini_json("test-actor", "gemini-3.8-flash", "Grade", "Essay")
                )
        self.assertIsNone(result)
        self.assertEqual(request.await_count, 1)

    def test_rejects_invalid_model_without_network(self) -> None:
        request = AsyncMock()
        with patch.dict(os.environ, {"GEMINI_API_KEY": "fake-test-key"}, clear=False):
            with patch("app.gemini_adapter.request_json", request):
                result = asyncio.run(
                    request_gemini_json("test-actor", "gemini/../../admin", "Grade", "Essay")
                )
        self.assertIsNone(result)
        request.assert_not_awaited()

    def test_registry_and_public_assessment_brand_are_distinct(self) -> None:
        with patch.dict(os.environ, {"GEMINI_API_KEY": "fake-test-key"}, clear=False):
            providers, _ = registry()
        gemini = next(p for p in providers if p["id"] == "gemini")
        self.assertEqual(gemini["requiredSecrets"], ["GEMINI_API_KEY"])
        assessment = meta("writing", gemini, gemini["model"])
        self.assertEqual(assessment["providerId"], "gemini")
        self.assertEqual(assessment["providerDisplayName"], "RIWI")
        stored: dict[str, object] = {
            "id": "grade-1",
            "user_id": "student-1",
            "evaluation_type": "writing",
            "source_type": "writing_grade",
            "source_id": "essay-1",
            "provider_id": "gemini",
            "provider_display_name": "RIWI",
            "provider_type": "external",
            "provider_version": "1",
            "model": "gemini-3.8-flash",
            "prompt_version": "v1",
            "rubric_version": "ielts-public-criteria-v1",
            "fallback_used": False,
            "fallback_from": None,
            "overall_estimate": 7.0,
            "confidence": 0.8,
            "verdict": None,
            "criteria": [],
            "strengths": [],
            "weaknesses": [],
            "issues": [],
            "next_actions": [],
            "recommended_exercises": [],
            "processed_in_ms": 100,
            "created_at": "2026-11-15",
        }
        public = record(stored)
        self.assertEqual(public["providerId"], "riwi")
        self.assertEqual(public["providerDisplayName"], "RIWI")
        self.assertIsNone(public["model"])
        self.assertEqual(public["checkedBy"]["displayName"], "RIWI")
        self.assertNotIn("gemini", json.dumps(public).lower())


if __name__ == "__main__":
    unittest.main()
