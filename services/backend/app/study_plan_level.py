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
QUESTION_COUNT = 15
PASS_SCORE = 10


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
                not isinstance(options, list) or len(options) != 4 or
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
    if level not in LEVELS:
        raise ValueError("invalid_level")
    owned = read_bank() if bank is None else bank
    picked: list[str] = []
    rng = secrets.SystemRandom()
    for skill in SKILLS:
        candidates = [question["id"] for question in owned.values()
                      if question["level"] == level and question["skill"] == skill]
        if len(candidates) < QUESTIONS_PER_SKILL:
            raise ValueError("incomplete_level_bank")
        picked.extend(rng.sample(candidates, QUESTIONS_PER_SKILL))
    rng.shuffle(picked)
    rows = []
    for question_id in picked:
        order = [0, 1, 2, 3]
        rng.shuffle(order)
        rows.append({"id": question_id, "options": order})
    return rows


def public_questions(rows: object, bank: dict[str, dict] | None = None) -> list[dict]:
    owned = read_bank() if bank is None else bank
    if not isinstance(rows, list) or len(rows) != QUESTION_COUNT:
        raise ValueError("invalid_level_attempt")
    result = []
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"id", "options"}:
            raise ValueError("invalid_level_attempt")
        question = owned.get(row["id"])
        order = row.get("options")
        if question is None or not isinstance(order, list) or sorted(order) != [0, 1, 2, 3]:
            raise ValueError("invalid_level_attempt")
        result.append({
            "id": question["id"], "skill": question["skill"],
            "q": question["q"], "options": [question["options"][i] for i in order],
            **({"passage": question["passage"]} if question.get("passage") else {}),
            **({"audio": question["audio"]} if question.get("audio") else {}),
        })
    return result


def score_attempt(rows: object, answers: object,
                  bank: dict[str, dict] | None = None) -> dict[str, Any] | None:
    try:
        displayed = public_questions(rows, bank)
    except (ValueError, TypeError, KeyError):
        return None
    owned = read_bank() if bank is None else bank
    if (not isinstance(answers, list) or len(answers) != QUESTION_COUNT or
            any(type(value) is not int or not 0 <= value < 4 for value in answers)):
        return None
    correct = 0
    by_skill = {name: {"correct": 0, "total": 0} for name in SKILLS}
    review = []
    for row, answer, shown in zip(rows, answers, displayed):
        question = owned[row["id"]]
        choice = row["options"][answer]
        passed = choice == question["answer"]
        correct += int(passed)
        by_skill[question["skill"]]["correct"] += int(passed)
        by_skill[question["skill"]]["total"] += 1
        review.append({
            "id": question["id"], "correct": passed,
            "selected": shown["options"][answer],
            "answer": question["options"][question["answer"]],
            "explanation": question.get("explanation", ""),
        })
    return {"correct": correct, "total": QUESTION_COUNT,
            "passed": correct >= PASS_SCORE, "skills": by_skill, "review": review}


def interpretation(level: str, correct: int) -> dict[str, str | None]:
    if level not in LEVELS or type(correct) is not int or not 0 <= correct <= 15:
        raise ValueError("invalid_level_score")
    index = LEVELS.index(level)
    below = LEVELS[max(0, index - 1)]
    if correct >= 13:
        return {"label": "strong", "suggestedLevel": level, "nextLevel": None}
    if correct >= PASS_SCORE:
        return {"label": "approaching", "suggestedLevel": level, "nextLevel": None}
    if correct >= 7:
        return {"label": "borderline", "suggestedLevel": below, "nextLevel": below}
    return {"label": "needs_practice", "suggestedLevel": below, "nextLevel": below}
