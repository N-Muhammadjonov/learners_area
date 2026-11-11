"""Deterministic 30-day learning schedule built from authentic Grammar catalogues.

The daily workload is exactly 120 estimated minutes. Completion is never inferred
from opening a link, spending time on the website, or a client-side checkbox.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

DAYS = 30
TARGET_MINUTES = 120
STAGE_NAMES = ("Tushunish", "Mustahkamlash", "Qo‘llash", "Erkin qo‘llash")
LEVELS = ("A0", "A1", "A2", "B1", "B2", "C1", "C2")
LEVEL_ALIASES = {
    "beginner": "A1", "elementary": "A1", "pre-intermediate": "A2",
    "preintermediate": "A2", "intermediate": "B1",
    "upper-intermediate": "B2", "upperintermediate": "B2",
    "advanced": "C1", "proficient": "C2", "proficiency": "C2",
}
# Six achievable pieces of actual site practice, varying the relative emphasis.
WORKLOADS = (
    {"grammar": 25, "reading": 30, "listening": 25, "writing": 20,
     "speaking": 10, "vocabulary": 10},
    {"grammar": 30, "reading": 25, "listening": 25, "writing": 20,
     "speaking": 10, "vocabulary": 10},
    {"grammar": 25, "reading": 25, "listening": 30, "writing": 20,
     "speaking": 10, "vocabulary": 10},
)
PRACTICE = {
    "reading": ("Reading — complete a passage and submit answers",
                "/app/reading", "reading"),
    "listening": ("Listening — finish a test and submit answers",
                  "/app/listening/tests", "listening"),
    "writing": ("Writing — submit a completed response",
                "/app/writing", "writing"),
    "speaking": ("Speaking — submit a recorded answer",
                 "/app/speaking/ai", "speaking"),
    "vocabulary": ("Vocabulary — review saved words",
                   "/app/vocabulary?tab=revision", "vocab"),
}
CATALOG_PATH = Path(__file__).with_name("data") / "study_plan_30_grammar_catalog.json"


@dataclass(frozen=True)
class PlanTask:
    day: int
    slot: int
    kind: str
    title: str
    href: str
    source_key: str
    minutes: int
    stage: int | None = None
    blocks: tuple[int, ...] = ()


def normalize_level(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    key = re.sub(r"\s+", " ", value.strip()).lower().replace("_", "-")
    if not key:
        return None
    upper = key.upper()
    if upper in LEVELS:
        return upper
    return LEVEL_ALIASES.get(key)


def level_range(value: str) -> tuple[str, ...]:
    level = normalize_level(value)
    if level is None:
        raise ValueError("level_required")
    index = LEVELS.index(level)
    return LEVELS[index:min(len(LEVELS), index + 2)]


def read_grammar_catalog(path: Path = CATALOG_PATH) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    units = payload.get("units") if payload.get("version") == 2 else None
    if not isinstance(units, list):
        raise ValueError("invalid_grammar_catalog")
    result = []
    seen = set()
    for unit in units:
        if not isinstance(unit, dict) or not all(unit.get(key) for key in
                                               ("id", "level", "source", "title", "href")):
            raise ValueError("invalid_grammar_unit")
        if unit["level"] not in LEVELS or not str(unit["href"]).startswith("/app/grammar"):
            raise ValueError("invalid_grammar_route")
        if not isinstance(unit.get("weights"), list) or len(unit["weights"]) != 4:
            raise ValueError("invalid_grammar_stages")
        if any(not isinstance(stage, list) or len(stage) != 3
               or any(type(weight) is not int or weight < 1 for weight in stage)
               for stage in unit["weights"]):
            raise ValueError("invalid_grammar_weights")
        key = (unit["source"], unit["id"])
        if key in seen:
            raise ValueError("duplicate_grammar_unit")
        seen.add(key)
        result.append(unit)
    return result


def eligible_grammar(level: str, catalog: list[dict]) -> list[dict]:
    """Interleave legacy lessons, Speaking grammar and Writing grammar at CEFR levels."""
    allowed = level_range(level)
    buckets = {(difficulty, source): [] for difficulty in allowed
               for source in ("legacy", "speaking", "writing")}
    for unit in catalog:
        key = (unit["level"], unit["source"])
        if key in buckets:
            buckets[key].append(unit)
    for units in buckets.values():
        units.sort(key=lambda item: item["id"])
    result = []
    while any(buckets.values()):
        for difficulty in allowed:
            for source in ("legacy", "speaking", "writing"):
                items = buckets[difficulty, source]
                if items:
                    result.append(items.pop(0))
    return result


def make_thirty_day_schedule(level: str, start: date,
                            catalog: list[dict] | None = None,
                            revision: int = 1) -> list[dict]:
    if not isinstance(start, date):
        raise ValueError("invalid_start")
    if type(revision) is not int or revision < 1:
        raise ValueError("invalid_revision")
    units = eligible_grammar(level, catalog if catalog is not None else read_grammar_catalog())
    if not units:
        raise ValueError("insufficient_grammar_content")
    result = []
    for offset in range(DAYS):
        day_number = offset + 1
        # New lesson each day while the level has enough units. Shorter
        # curricula (e.g. C2) progress through successive practice stages.
        position = offset + (revision - 1) * DAYS
        unit = units[position % len(units)]
        stage = (position // len(units)) % 4
        if unit["source"] != "legacy" and stage != 0:
            raise ValueError("unsupported_skill_stage")
        minutes = WORKLOADS[offset % len(WORKLOADS)]
        grammar = PlanTask(
            day=day_number, slot=0, kind="grammar",
            title=f"Grammar — {unit['title']} · {STAGE_NAMES[stage]}",
            href=unit["href"],
            source_key=(f"grammar-book:{unit['level'].lower()}:{unit['id']}:{stage}"
                        if unit['source'] == 'legacy'
                        else f"skill-grammar:{unit['source']}:{unit['group']}:{unit['id']}:{stage}"),
            minutes=minutes["grammar"], stage=stage,
            blocks=tuple(unit["weights"][stage]),
        )
        tasks = [grammar]
        for slot, kind in enumerate(("reading", "listening", "writing", "speaking", "vocabulary"), 1):
            title, href, event_kind = PRACTICE[kind]
            tasks.append(PlanTask(day_number, slot, kind, title, href, event_kind,
                                  minutes[kind]))
        if sum(task.minutes for task in tasks) != TARGET_MINUTES:
            raise ValueError("invalid_daily_budget")
        result.append({"day": day_number, "date": (start + timedelta(days=offset)).isoformat(),
                       "tasks": tasks})
    return result


def eligible_to_open(day: int, started_on: date, today: date,
                     previous_completed: bool) -> bool:
    """No unlocking from a passed calendar date unless the previous day is complete."""
    return 1 <= day <= DAYS and (day == 1 or
                                  (previous_completed and
                                   today >= started_on + timedelta(days=day - 1)))
