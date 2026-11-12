"""Server-graded reuse of the public landing diagnostic question bank.

A 15-question self-check is useful to choose study material, not an official
CEFR or IELTS certificate. The server owns scoring and randomized option maps.
"""
from __future__ import annotations

import json
import secrets
from pathlib import Path
from typing import Any

LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
SKILLS = ("grammar", "vocabulary", "reading", "listening", "use")
BANK_FILE = Path(__file__).with_name("data") / "plan_level_bank.json"
QUESTIONS_PER_SKILL = 3
QUESTION_COUNT = 17
PASS_SCORE = 11
BASE_QUESTIONS = QUESTIONS_PER_SKILL * len(SKILLS)
BASE_THRESHOLDS = {'A1': 11, 'A2': 11, 'B1': 11, 'B2': 12, 'C1': 13, 'C2': 14}


def read_bank(path: Path = BANK_FILE) -> dict[str, dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    questions = payload.get("questions") if payload.get("version") == 1 else None
    if not isinstance(questions, list) or len(questions) != 150:
        raise ValueError("invalid_level_bank")
    bank: dict[str, dict] = {}
    counts = {(level, skill): 0 for level in LEVELS for skill in SKILLS}
    for question in questions:
        if not isinstance(question, dict) or question.get("id") in bank:
            raise ValueError("invalid_level_question")
        level, skill = question.get("level"), question.get("skill")
        options = question.get("options")
        answer = question.get("answer")
        if ((level, skill) not in counts or
                not isinstance(options, list) or len(options) not in ((3, 4) if skill == 'listening' else (4,)) or
                not all(isinstance(option, str) and option.strip() for option in options) or
                type(answer) is not int or answer not in range(4) or
                not isinstance(question.get("q"), str)):
            raise ValueError("invalid_level_answer")
        bank[question["id"]] = question
        counts[level, skill] += 1
    if any(count != 5 for count in counts.values()):
        raise ValueError("incomplete_level_bank")
    return bank


def new_attempt(level: str, bank: dict[str, dict] | None = None) -> list[dict]:
    """Three items per skill, plus harder Reading/Use anchors.

    A C2 candidate receives two additional, non-overlapping C2 anchors.
    The order and answer permutation never come from the client.
    """
    if level not in LEVELS:
        raise ValueError("invalid_level")
    owned = read_bank() if bank is None else bank
    rng = secrets.SystemRandom()
    selected: list[tuple[str, bool]] = []
    for skill in SKILLS:
        candidates = [question["id"] for question in owned.values()
                      if question["level"] == level and question["skill"] == skill]
        if len(candidates) < QUESTIONS_PER_SKILL:
            raise ValueError("incomplete_level_bank")
        selected.extend((question_id, False)
                        for question_id in rng.sample(candidates, QUESTIONS_PER_SKILL))
    next_level = LEVELS[min(len(LEVELS) - 1, LEVELS.index(level) + 1)]
    for skill in ("reading", "use"):
        pool = [question["id"] for question in owned.values()
                if question["level"] == next_level and question["skill"] == skill
                and question["id"] not in {item[0] for item in selected}]
        if not pool:
            raise ValueError("missing_anchor_question")
        selected.append((rng.choice(pool), True))
    rng.shuffle(selected)
    result: list[dict] = []
    for question_id, anchor in selected:
        order = list(range(len(owned[question_id]["options"])))
        rng.shuffle(order)
        result.append({"id": question_id, "options": order, "anchor": anchor})
    return result


def public_questions(rows: object, bank: dict[str, dict] | None = None) -> list[dict]:
    owned = read_bank() if bank is None else bank
    if not isinstance(rows, list) or len(rows) != QUESTION_COUNT:
        raise ValueError("invalid_level_attempt")
    ids: set[str] = set()
    result = []
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"id", "options", "anchor"}:
            raise ValueError("invalid_level_attempt")
        question = owned.get(row["id"])
        order = row.get("options")
        if (question is None or question["id"] in ids or
                type(row["anchor"]) is not bool or
                not isinstance(order, list) or
                sorted(order) != list(range(len(question["options"])))):
            raise ValueError("invalid_level_attempt")
        ids.add(question["id"])
        result.append({
            "id": question["id"], "skill": question["skill"],
            "q": question["q"], "options": [question["options"][i] for i in order],
            **({"passage": question["passage"]} if question.get("passage") else {}),
            **({"audio": question["audio"]} if question.get("audio") else {}),
        })
    if sum(bool(row["anchor"]) for row in rows) != 2:
        raise ValueError("invalid_level_attempt")
    if any(sum(1 for row in rows if not row["anchor"]
               and owned[row["id"]]["skill"] == skill) != QUESTIONS_PER_SKILL
           for skill in SKILLS):
        raise ValueError("invalid_level_attempt")
    return result


def score_attempt(rows: object, answers: object,
                  bank: dict[str, dict] | None = None) -> dict[str, Any] | None:
    try:
        shown = public_questions(rows, bank)
    except (ValueError, TypeError, KeyError):
        return None
    owned = read_bank() if bank is None else bank
    if (not isinstance(answers, list) or len(answers) != QUESTION_COUNT or
            any(type(answer) is not int or not 0 <= answer < len(
                owned[row["id"]]["options"]) for row, answer in zip(rows, answers))):
        return None
    by_skill = {skill: {"correct": 0, "total": 0} for skill in SKILLS}
    review: list[dict] = []
    base_correct = anchor_correct = 0
    base_levels = [owned[row["id"]]["level"] for row in rows if not row["anchor"]]
    if len(set(base_levels)) != 1:
        return None
    level = base_levels[0]
    next_level = LEVELS[min(len(LEVELS) - 1, LEVELS.index(level) + 1)]
    if sorted(owned[row["id"]]["skill"] for row in rows if row["anchor"]) != ["reading", "use"]:
        return None
    if any(owned[row["id"]]["level"] != next_level for row in rows if row["anchor"]):
        return None
    for row, answer, item in zip(rows, answers, shown):
        question = owned[row["id"]]
        original_index = row["options"][answer]
        correct = original_index == question["answer"]
        if row["anchor"]:
            anchor_correct += int(correct)
        else:
            base_correct += int(correct)
            by_skill[question["skill"]]["correct"] += int(correct)
            by_skill[question["skill"]]["total"] += 1
        review.append({"id": question["id"], "correct": correct,
                       "selected": item["options"][answer],
                       "answer": question["options"][question["answer"]],
                       "explanation": question.get("explanation", "")})
    coverage = all(by_skill[skill]["correct"] >= 2 for skill in
                   ("reading", "listening", "use"))
    passed = (base_correct >= BASE_THRESHOLDS[level]
              and (level != "C1" or anchor_correct >= 1)
              and (level != "C2" or anchor_correct == 2)
              and (level not in ("C1", "C2") or coverage))
    return {"correct": base_correct + anchor_correct, "baseCorrect": base_correct,
            "anchorCorrect": anchor_correct, "total": QUESTION_COUNT,
            "passed": passed, "skills": by_skill, "review": review}


def interpretation(level: str, correct: int, passed: bool | None = None) -> dict[str, str | None]:
    if level not in LEVELS or type(correct) is not int or not 0 <= correct <= QUESTION_COUNT:
        raise ValueError("invalid_level_score")
    below = LEVELS[max(0, LEVELS.index(level) - 1)]
    approved = passed if passed is not None else (
        correct >= BASE_THRESHOLDS[level] + 2)
    if approved:
        label = "strong" if correct >= QUESTION_COUNT - 1 else "approaching"
        return {"label": label, "suggestedLevel": level, "nextLevel": None}
    label = "borderline" if correct >= QUESTION_COUNT // 2 else "needs_practice"
    return {"label": label, "suggestedLevel": below, "nextLevel": below}
