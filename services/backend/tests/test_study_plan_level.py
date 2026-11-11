"""Regression tests for the exact landing CEFR bank and secure 30-day gating."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main as core
from app.study_plan_level import (
    LEVELS, PASS_SCORE, QUESTIONS_PER_SKILL, SKILLS,
    interpretation, new_attempt, public_questions, read_bank, score_attempt,
)


def test_in_app_bank_stays_identical_to_landing_reference():
    source = Path(__file__).resolve().parents[3] / "frontend/vanilla/modules/premium-landing.js"
    content = source.read_text(encoding="utf-8")
    start = content.index("const LA_V5_BANK=") + len("const LA_V5_BANK=")
    end = content.index(";\n/* All diagnostic data", start)
    original = json.loads(content[start:end])
    imported = read_bank()
    assert len(imported) == 150
    for level in LEVELS:
        for skill in SKILLS:
            questions = original[level][skill]
            assert len(questions) == 5
            for question in questions:
                assert imported[question["id"]] == question


@pytest.mark.parametrize("level", LEVELS)
def test_each_level_has_exactly_fifteen_shuffled_questions(level):
    bank = read_bank()
    rows = new_attempt(level, bank)
    public = public_questions(rows, bank)
    assert len(rows) == len(public) == 15
    assert len({row["id"] for row in rows}) == 15
    assert {question["id"] for question in public} == {row["id"] for row in rows}
    assert all(sum(question["skill"] == skill for question in public) ==
               QUESTIONS_PER_SKILL for skill in SKILLS)
    assert all(question["id"] in bank and bank[question["id"]]["level"] == level
               for question in public)
    assert all("answer" not in question and "explanation" not in question
               for question in public)


@pytest.mark.parametrize("level", LEVELS)
def test_server_grades_permuted_options_and_never_trusts_client_score(level):
    bank = read_bank()
    rows = new_attempt(level, bank)
    answers = [row["options"].index(bank[row["id"]]["answer"]) for row in rows]
    best = score_attempt(rows, answers, bank)
    assert best["correct"] == 15 and best["passed"]
    assert sum(info["correct"] for info in best["skills"].values()) == 15
    assert len(best["review"]) == 15
    wrong = [(position + 1) % 4 for position in answers]
    bad = score_attempt(rows, wrong, bank)
    assert bad["correct"] == 0 and not bad["passed"]
    assert score_attempt(rows, [{"score": 15}] * 15, bank) is None
    assert score_attempt(rows, answers[:14], bank) is None
    assert score_attempt(rows, [True] * 15, bank) is None


@pytest.mark.parametrize("score,should_pass,label", [
    (0, False, "needs_practice"), (6, False, "needs_practice"),
    (7, False, "borderline"), (9, False, "borderline"),
    (10, True, "approaching"), (12, True, "approaching"),
    (13, True, "strong"), (15, True, "strong"),
])
def test_result_interpretation_is_consistent(score, should_pass, label):
    details = interpretation("B2", score)
    assert (score >= PASS_SCORE) == should_pass
    assert details["label"] == label
    assert details["suggestedLevel"] == ("B2" if should_pass else "B1")


def test_public_contract_refuses_malformed_attempt_maps():
    bank = read_bank()
    rows = new_attempt("B1", bank)
    rows[0]["options"] = [0, 0, 1, 2]
    with pytest.raises(ValueError, match="invalid_level_attempt"):
        public_questions(rows, bank)


@pytest.mark.parametrize("path,verb", [
    ("/api/study-plan/monthly/sequence/level", "get"),
    ("/api/study-plan/monthly/sequence/level/start", "post"),
    ("/api/study-plan/monthly/sequence/level/submit", "post"),
    ("/api/study-plan/monthly/sequence/level/manual", "post"),
])
def test_level_endpoints_are_student_only_and_no_anonymous_db_access(monkeypatch,path,verb):
    async def anonymous(*args, **kwargs):
        return None

    async def cannot_open_database():
        raise AssertionError("Anonymous request reached the database")

    monkeypatch.setattr(core, "current_user", anonymous)
    monkeypatch.setattr(core, "pool", cannot_open_database)
    with TestClient(core.app) as client:
        response = client.get(path) if verb == "get" else client.post(path,json={})
    assert response.status_code == 401
