"""Mode B integration uses the existing Coach schema and cannot call providers."""
from __future__ import annotations

import os
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import step31_coach as coach


class IndependentCoachTests(unittest.IsolatedAsyncioTestCase):
    async def test_mode_b_bypasses_external_provider_and_owner_provider_lookup(self):
        forbidden = AsyncMock(side_effect=AssertionError("external/provider lookup attempted"))
        with patch.dict(os.environ, {"RIWI_EVALUATION_MODE": "independent-v1"}), \
                patch.object(coach, "status", forbidden), patch.object(coach, "vendor", forbidden), \
                patch.object(socket.socket, "connect", side_effect=AssertionError("network attempted")):
            for kind, payload in [
                ("writing", {"taskType": "task2", "prompt": "Discuss city transport.", "content": "I prefer walking because it is quiet.", "targetWordCount": 250}),
                ("speaking", {"transcript": "I prefer walking because the park is peaceful.", "part": "part1", "durationMs": 5000}),
                ("grammar", {"promptText": "Write a present simple sentence.", "studentAnswer": "She walks to school every day."}),
                ("vocabulary", {"targetWord": "careful", "definition": "taking care", "studentSentence": "She is careful when she crosses the road."}),
            ]:
                evaluation, metadata = await coach.resolve(kind, payload, "en")
                self.assertTrue(coach.valid(evaluation))
                self.assertIsNone(evaluation["overallEstimate"])
                self.assertEqual(metadata["providerId"], "riwi")
                self.assertEqual(metadata["promptVersion"], "riwi-independent-evidence-v1")
        forbidden.assert_not_awaited()

    async def test_invalid_mode_b_payload_returns_unavailable_without_fallback(self):
        forbidden = AsyncMock(side_effect=AssertionError("fallback attempted"))
        with patch.dict(os.environ, {"RIWI_EVALUATION_MODE": "independent-v1"}), \
                patch.object(coach, "status", forbidden), patch.object(coach, "vendor", forbidden):
            evaluation, reason = await coach.resolve("writing", {"taskType": "task7"}, "en")
        self.assertIsNone(evaluation)
        self.assertEqual(reason, "evaluation_unavailable")
        forbidden.assert_not_awaited()

    async def test_mode_b_does_not_certify_an_unverified_vocabulary_sense(self):
        forbidden = AsyncMock(side_effect=AssertionError("external/provider lookup attempted"))
        with patch.dict(os.environ, {"RIWI_EVALUATION_MODE": "independent-v1"}), \
                patch.object(coach, "status", forbidden), patch.object(coach, "vendor", forbidden):
            for sentence in ["The bank is covered with grass beside the river.",
                             "She deposited her savings in the bank yesterday."]:
                with self.subTest(sentence=sentence):
                    result, _ = await coach.resolve("vocabulary", {
                        "targetWord": "bank", "definition": "a financial institution that holds money",
                        "studentSentence": sentence}, "en")
                    self.assertTrue(coach.valid(result))
                    self.assertIsNone(result["verdict"])
                    self.assertEqual(result["confidence"], 0)
                    self.assertTrue(all(c.get("limited") for c in result["criteria"]))
                    self.assertIn("requires semantic evaluation", result["criteria"][-1]["note"])
        forbidden.assert_not_awaited()

    async def test_mode_b_still_reports_a_missing_vocabulary_word(self):
        with patch.dict(os.environ, {"RIWI_EVALUATION_MODE": "independent-v1"}):
            result, _ = await coach.resolve("vocabulary", {
                "targetWord": "bank", "definition": "a financial institution that holds money",
                "studentSentence": "She deposited her savings yesterday."}, "en")
        self.assertTrue(coach.valid(result))
        self.assertEqual(result["verdict"], "needs_correction")
        self.assertEqual(result["strengths"], [])
        self.assertIn("not detected", next(c["note"] for c in result["criteria"] if c["key"] == "active_use"))

    def test_unconfigured_mode_preserves_existing_internal_path(self):
        with patch.dict(os.environ, {"RIWI_EVALUATION_MODE": ""}), \
                patch("app.step32_writing_riwi.wval", return_value={"sentinel": True}) as baseline:
            result = coach.internal("writing", {"taskType": "task2", "prompt": "A", "content": "B", "targetWordCount": 250})
        self.assertEqual(result, {"sentinel": True})
        baseline.assert_called_once()


if __name__ == "__main__":
    unittest.main()
