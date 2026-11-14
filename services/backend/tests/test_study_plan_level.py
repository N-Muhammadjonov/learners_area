"""Regression tests for the exact landing CEFR bank and secure 30-day gating."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main as core
from app.study_plan_level import (
    LEVELS, PASS_SCORE, QUESTION_COUNT, QUESTIONS_PER_SKILL, SKILLS,
    interpretation, new_attempt, public_questions, read_bank, score_attempt,
)


def test_in_app_bank_stays_identical_to_landing_reference():
    import re
    source = Path(__file__).resolve().parents[3] / 'frontend/vanilla/modules/landing-inline.js'
    content = json.JSONDecoder().raw_decode(re.split(r'export const LANDING_HTML\s*=', source.read_text(), maxsplit=1)[1].lstrip())[0]
    original = json.loads(re.search(r'const Q=(\[.*?\]);', content, re.S)[1])
    imported = read_bank()
    assert len(imported) == 150 and len(original) == 45
    skills = dict(g='grammar', v='vocabulary', r='reading', l='listening', u='use')
    counters = {}
    for question in original:
        level, skill = LEVELS[question['l']], skills[question['s']]
        counters[level, skill] = counters.get((level, skill), 0) + 1
        canonical = imported[f'{level}-{skill}-{counters[level, skill]}']
        assert (canonical['q'], canonical['options'], canonical['answer']) == (question['q'], question['opts'], question['answer'])
        assert canonical.get('audio', canonical.get('passage', '')) == question['x']
    assert len(counters) == 30
    assert all(count == (1 if LEVELS.index(level) < 3 else 2) for (level, skill), count in counters.items())


@pytest.mark.parametrize("level", LEVELS)
def test_each_level_has_seventeen_mixed_questions(level):
    bank = read_bank()
    rows = new_attempt(level, bank)
    public = public_questions(rows, bank)
    assert len(rows) == len(public) == QUESTION_COUNT == 17
    assert len({row["id"] for row in rows}) == 17
    assert {question["id"] for question in public} == {row["id"] for row in rows}
    regular = [row for row in rows if not row["anchor"]]
    anchors = [row for row in rows if row["anchor"]]
    assert len(regular) == 15 and len(anchors) == 2
    next_level = LEVELS[min(len(LEVELS) - 1, LEVELS.index(level) + 1)]
    assert {bank[row["id"]]["skill"] for row in anchors} == {"reading", "use"}
    assert all(bank[row["id"]]["level"] == next_level for row in anchors)
    assert all(bank[row["id"]]["level"] == level for row in regular)
    assert all(sum(bank[row["id"]]["skill"] == skill for row in regular) ==
               QUESTIONS_PER_SKILL for skill in SKILLS)
    assert all("answer" not in q and "explanation" not in q for q in public)
    assert all(len(q["options"]) in (3, 4) for q in public)


def test_harder_listening_comes_from_distinct_published_mcq_days():
    bank = read_bank()
    listening = [q for q in bank.values() if q["skill"] == "listening"
                 and q["level"] in ("B2", "C1", "C2")]
    assert len(listening) == 15
    assert len({q["sourceDay"] for q in listening}) == 15
    assert all(q["sourceQuestion"] == 1 and len(q["options"]) == 3
               and q["audio"].endswith(f"/{q['sourceDay']}")
               and q["answer"] in range(3) for q in listening)



@pytest.mark.parametrize("level", LEVELS)
def test_server_grades_permuted_options_and_rejects_incomplete_answers(level):
    bank = read_bank()
    rows = new_attempt(level, bank)
    answers = [row["options"].index(bank[row["id"]]["answer"]) for row in rows]
    best = score_attempt(rows, answers, bank)
    assert best["correct"] == 17 and best["passed"]
    assert best["baseCorrect"] == 15 and best["anchorCorrect"] == 2
    assert sum(info["correct"] for info in best["skills"].values()) == 15
    assert len(best["review"]) == 17
    wrong = [(answer + 1) % len(row["options"])
             for row, answer in zip(rows, answers)]
    bad = score_attempt(rows, wrong, bank)
    assert bad["correct"] == 0 and not bad["passed"]
    assert score_attempt(rows, [{"score": 17}] * 17, bank) is None
    assert score_attempt(rows, answers[:16], bank) is None
    assert score_attempt(rows, [True] * 17, bank) is None


def test_b2_pattern_is_not_misclassified_as_c2():
    bank = read_bank()
    rows = new_attempt("C2", bank)
    correct = [row["options"].index(bank[row["id"]]["answer"]) for row in rows]
    for row, answer in zip(rows, correct):
        if row["anchor"] or bank[row["id"]]["skill"] == "listening":
            continue
        # Even a high total cannot confirm C2 with a weak skill profile.
        break
    wrong = list(correct)
    for index, row in enumerate(rows):
        if bank[row["id"]]["skill"] == "listening" and not row["anchor"]:
            wrong[index] = (correct[index] + 1) % len(row["options"])
    grade = score_attempt(rows, wrong, bank)
    assert grade["correct"] == 14
    assert not grade["passed"]
    assert interpretation("C2", grade["correct"], grade["passed"])["suggestedLevel"] == "C1"


@pytest.mark.parametrize("score,passed,expected", [
    (0, False, "needs_practice"), (7, False, "needs_practice"),
    (9, False, "borderline"), (14, False, "borderline"),
    (15, True, "approaching"), (17, True, "strong"),
])
def test_result_interpretation_is_conservative(score, passed, expected):
    output = interpretation("C2", score, passed)
    assert output["label"] == expected
    assert output["suggestedLevel"] == ("C2" if passed else "C1")



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


def test_public_level_audio_rejects_unknown_day_without_db(monkeypatch):
    async def no_database():
        raise AssertionError("Unknown MCQ days must be rejected before database access")

    monkeypatch.setattr(core, "pool", no_database)
    with TestClient(core.app) as client:
        response = client.get("/api/study-plan/monthly/sequence/level/landing/audio/99")
    assert response.status_code == 404


def test_level_audio_checks_published_allowlist_without_reading_storage(monkeypatch):
    class Connection:
        async def fetchval(self, query, *args):
            assert "p.audio_object_key" in query
            assert args == (1, "listening/mcq/day-01/question-01.mp3")
            return False

    class Pool:
        async def __aenter__(self):
            return Connection()

        async def __aexit__(self, *args):
            return None

        def acquire(self):
            return self

    async def pool():
        return Pool()

    async def forbid_storage(*args):
        raise AssertionError("Unpublished media must not touch storage")

    from app import study_plan_level_port as port

    monkeypatch.setattr(core, "pool", pool)
    monkeypatch.setattr(port, "head_object", forbid_storage)
    with TestClient(core.app) as client:
        response = client.get("/api/study-plan/monthly/sequence/level/landing/audio/1")
    assert response.status_code == 404
