"""Exercise immutable Mock Speaking loading without database or app startup."""

from __future__ import annotations

import ast
import copy
import json
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / "app" / "mock_system_port.py"


def load_functions(path: Path) -> dict[str, Any]:
    names = {
        "_question_has_answer_key",
        "_valid_auto_speaking_pool",
        "select_attempt_speaking_material",
        "_verify_section_material_integrity",
        "_load_section_questions_from_version",
    }
    tree = ast.parse(path.read_text())
    nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names]
    namespace: dict[str, Any] = {"Any": Any, "json": json}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), "exec"), namespace)
    return namespace


APP = load_functions(SOURCE)


def pool() -> dict[str, Any]:
    def question(part: str, identifier: str) -> dict[str, str]:
        return {"part": part, "questionId": identifier, "promptText": "Question " + identifier}

    return {
        "speakingMode": "auto",
        "part1Pool": [
            {"topic": "Home", "parts": [question("P1", "home-1")]},
            {"topic": "Work", "parts": [question("P1", "work-1")]},
        ],
        "part2Pairs": [
            {"part2": question("P2", "book-2"), "part3": [question("P3", "book-3")]},
            {"part2": question("P2", "trip-2"), "part3": [question("P3", "trip-3")]},
        ],
    }


class VersionConnection:
    def __init__(self, snapshot: dict[str, Any], *, encoded: bool = False) -> None:
        self.snapshot = json.dumps(snapshot) if encoded else snapshot
        self.queries: list[str] = []

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any]:
        self.queries.append(query)
        if "FROM content_versions" not in query:
            raise AssertionError("A bound version must never fall back to the live practice bank.")
        return {"content_snapshot": self.snapshot, "title": "Synthetic Mock", "track": "academic", "publication_state": "published", "id": args[0]}

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        raise AssertionError("A bound version must never read live practice questions.")


class MockAutoSpeakingLoaderTests(unittest.IsolatedAsyncioTestCase):
    def section(self, skill: str = "speaking") -> dict[str, Any]:
        return {"skill": skill, "content_version_id": "immutable-version", "source_ref": "mock-upload:immutable-version"}

    async def test_auto_pool_uses_immutable_version_without_practice_fallback(self) -> None:
        snapshot = pool()
        for encoded in (False, True):
            with self.subTest(encoded=encoded):
                connection = VersionConnection(snapshot, encoded=encoded)
                loaded = await APP["_load_section_questions_from_version"](connection, self.section(), reveal_keys=True)
                self.assertEqual(loaded, snapshot)
                self.assertEqual(len(connection.queries), 1)

    async def test_auto_pool_passes_publication_integrity(self) -> None:
        snapshot = pool()
        result = await APP["_verify_section_material_integrity"](VersionConnection(snapshot), self.section(), expected_track="academic")
        self.assertTrue(result[0], result[1:3])
        self.assertEqual(result[3], snapshot)

    async def test_invalid_auto_pool_is_rejected_without_fallback(self) -> None:
        snapshot = pool()
        snapshot["part2Pairs"][0]["part3"] = []
        result = await APP["_verify_section_material_integrity"](VersionConnection(snapshot), self.section(), expected_track="academic")
        self.assertFalse(result[0])
        self.assertEqual(result[1], "invalid_speaking_pool")

    async def test_fixed_speaking_snapshot_is_unchanged(self) -> None:
        snapshot = {"parts": [pool()["part2Pairs"][0]["part2"]]}
        loaded = await APP["_load_section_questions_from_version"](VersionConnection(snapshot), self.section(), reveal_keys=True)
        self.assertEqual(loaded, snapshot)

    async def test_other_bound_materials_keep_their_original_snapshots(self) -> None:
        cases = (
            ("listening", {"questions": [{"id": "1", "correctAnswer": "yes"}], "audioUrl": "/private/audio"}),
            ("reading", {"questions": [{"id": "1", "correctAnswer": "no"}], "passages": [{"bodyText": "Original passage"}]}),
            ("writing", {"prompt": "Original Task 2 prompt."}),
        )
        for skill, snapshot in cases:
            with self.subTest(skill=skill):
                loaded = await APP["_load_section_questions_from_version"](VersionConnection(snapshot), self.section(skill), reveal_keys=True)
                self.assertEqual(loaded, snapshot)

    async def test_attempt_selection_preserves_part2_part3_pair(self) -> None:
        snapshot = pool()
        original = copy.deepcopy(snapshot)
        loaded = await APP["_load_section_questions_from_version"](VersionConnection(snapshot), self.section(), reveal_keys=True)
        with patch("secrets.choice", side_effect=lambda values: values[-1]):
            selected = APP["select_attempt_speaking_material"](loaded)
        self.assertEqual([question["questionId"] for question in selected["parts"]], ["work-1", "home-1", "trip-2", "trip-3"])
        self.assertEqual(snapshot, original)

    def test_part1_selects_three_distinct_complete_topics_before_part2(self) -> None:
        snapshot = pool()
        snapshot['part1Pool'] = [
            {'topic': topic, 'parts': [
                {'part': 'P1', 'questionId': f'{topic}-{n}', 'promptText': f'Question {n}'}
                for n in (1, 2)
            ]} for topic in ('Home', 'Work', 'Books', 'Travel')
        ]
        original = copy.deepcopy(snapshot)
        with patch('secrets.choice', side_effect=lambda values: values[0]):
            selected = APP['select_attempt_speaking_material'](snapshot)['parts']
        self.assertEqual([q['topic'] for q in selected[:6]], ['Home', 'Home', 'Work', 'Work', 'Books', 'Books'])
        self.assertEqual([q['part'] for q in selected], ['P1'] * 6 + ['P2', 'P3'])
        self.assertEqual([q['questionId'] for q in selected[-2:]], ['book-2', 'book-3'])
        self.assertEqual(snapshot, original)


if __name__ == "__main__":
    unittest.main()

