"""Bounded local evaluation with explicit evidence limits.

Subjective feedback reuses the baseline pattern detector. Numeric IELTS bands
and calibrated confidence are withheld until independent reference validation
exists. Objective answers use a trusted, caller-supplied server-side key.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import re
import unicodedata

from . import VERSION
from ..step31_riwi_evaluators import sval
from ..step32_writing_riwi import wval


def _text(value: str, *, max_chars: int = 30_000) -> str:
    if not isinstance(value, str) or len(value) > max_chars or "\x00" in value:
        raise ValueError("invalid_evaluation_text")
    return value


def normalize_answer(value: str) -> str:
    # Preserve punctuation, articles and accents: accepted alternatives belong
    # in the official key, not in an undocumented fuzzy matching rule.
    return " ".join(unicodedata.normalize("NFC", _text(value, max_chars=2000)).casefold().split())


@dataclass(frozen=True)
class ObjectiveKey:
    accepted_answers: tuple[str, ...]
    max_words: int | None = None

    def __post_init__(self):
        if not isinstance(self.accepted_answers, tuple) or not 1 <= len(self.accepted_answers) <= 30:
            raise ValueError("invalid_answer_key")
        if any(not normalize_answer(answer) for answer in self.accepted_answers):
            raise ValueError("empty_accepted_answer")
        if self.max_words is not None and (type(self.max_words) is not int or not 1 <= self.max_words <= 100):
            raise ValueError("invalid_word_limit")


def evaluate_objective(answer: str, key: ObjectiveKey) -> dict:
    normalized = normalize_answer(answer)
    # Whitespace-delimited answer tokens keep decimal numbers and hyphenated
    # compounds intact. Symbol-only tokens do not count as words.
    words = sum(any(char.isalnum() for char in token) for token in normalized.split())
    over_limit = key.max_words is not None and words > key.max_words
    correct = bool(normalized) and not over_limit and normalized in {normalize_answer(a) for a in key.accepted_answers}
    return {"correct": correct, "reason": "word_limit_exceeded" if over_limit else "accepted_answer" if correct else "answer_mismatch",
            "word_count": words, "provenance": "trusted_answer_key", "evaluator_version": VERSION}


def _withhold_bands(evaluation: dict) -> dict:
    result = deepcopy(evaluation)
    result["overallEstimate"] = None
    result["confidence"] = 0.0
    for criterion in result["criteria"]:
        criterion["band"] = None
        criterion["limited"] = True
    result["nextActions"] = ["Use these pattern observations for practice. IELTS band scoring has not been independently validated.",
                             *result["nextActions"]][:5]
    return result


def evaluate_writing(*, task_type: str, prompt: str, content: str, target_words: int = 250,
                     general_training: bool = False) -> dict:
    _text(prompt)
    _text(content)
    if task_type not in {"task1", "task2"} or type(target_words) is not int or not 1 <= target_words <= 2000:
        raise ValueError("invalid_writing_task")
    if general_training and task_type != "task1":
        raise ValueError("invalid_general_training_task")
    # GT letters must not inherit Academic Task 1 overview/data heuristics.
    if general_training:
        words = len(content.split())
        result = {"overallEstimate": None, "confidence": 0.0, "verdict": None,
                  "criteria": [{"key": "task_achievement", "label": "Task Achievement", "band": None,
                                "limited": True, "note": "Letter purpose, register and bullet coverage require semantic evaluation."}],
                  "strengths": [], "weaknesses": [], "issues": [], "nextActions": [], "recommendedExercises": []}
        if words < target_words:
            result["weaknesses"].append(f"Response contains {words} words against the {target_words}-word target.")
        if not re.search(r"\bdear\b", content[:100], re.I):
            result["nextActions"].append("Check the letter opening and the relationship with the recipient.")
        result["nextActions"].append("Check that you address each requested point using a suitable register.")
    else:
        result = wval(task_type, prompt, content, target_words)
    return {"evaluation": _withhold_bands(result), "status": "pattern_feedback_only",
            "model_version": VERSION, "subjective_band_validation": "not_available",
            "limitations": ["semantic_relevance_unverified", "rubric_quality_unverified", "confidence_uncalibrated"]}


def evaluate_speaking(*, transcript: str, part: str, duration_ms: int | None = None,
                      prompt: str = "", origin: str = "manual") -> dict:
    _text(transcript)
    _text(prompt)
    if part not in {"part1", "part2", "part3", "general", "mock"} or origin not in {"manual", "stt"}:
        raise ValueError("invalid_speaking_task")
    if duration_ms is not None and (type(duration_ms) is not int or not 1 <= duration_ms <= 3_600_000):
        raise ValueError("invalid_duration")
    result = sval(transcript, part, duration_ms, prompt, origin, False)
    return {"evaluation": _withhold_bands(result), "status": "transcript_pattern_feedback_only",
            "model_version": VERSION, "subjective_band_validation": "not_available",
            "limitations": ["semantic_relevance_unverified", "audio_not_analyzed", "pronunciation_not_assessed", "confidence_uncalibrated"]}
