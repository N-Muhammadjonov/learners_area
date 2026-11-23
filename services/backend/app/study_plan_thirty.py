"""Deterministic 30-day learning schedule built from authentic Grammar catalogues.

The standard daily workload is 120 estimated minutes; the owner IELTS intensive
track alternates 180-minute course days with 390/420-minute intensive days.
Completion is never inferred from opening a link or a client-side checkbox.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

DAYS = 30
SUPPORTED_DURATIONS = (7, DAYS)
TARGET_MINUTES = 120
OWNER_TARGET_MINUTES = 300  # Historical owner cycles remain readable.
OWNER_LIGHT_MINUTES = 180
OWNER_HEAVY_MINUTES = 390
OWNER_SUNDAY_MINUTES = 420
VALID_DAILY_TOTALS = frozenset((
    TARGET_MINUTES, OWNER_TARGET_MINUTES, OWNER_LIGHT_MINUTES,
    OWNER_HEAVY_MINUTES, OWNER_SUNDAY_MINUTES,
))
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
    {"grammar": 20, "reading": 25, "listening": 30, "writing": 20,
     "speaking": 15, "vocabulary": 10},
    {"grammar": 25, "reading": 25, "listening": 25, "writing": 20,
     "speaking": 15, "vocabulary": 10},
)
SUNDAY_WORKLOAD = {
    "grammar": 10, "reading": 60, "listening": 20, "writing": 10,
    "speaking": 10, "vocabulary": 10,
}
# Independent study only: Mon/Wed/Fri are in-person course days.
OWNER_COURSE_WORKLOAD = {
    "grammar": 15, "reading": 25, "listening": 40, "writing": 40,
    "speaking": 40, "vocabulary": 20,
}
OWNER_WORKLOAD = {
    "grammar": 20, "reading": 75, "listening": 75, "writing": 90,
    "speaking": 90, "vocabulary": 40,
}
OWNER_FULL_MOCK_WORKLOAD = {
    "grammar": 20, "reading": 80, "listening": 90, "writing": 90,
    "speaking": 90, "vocabulary": 50,
}
# Owner-only sequential workload. Day numbers refer to completed study slots,
# never the parity of a calendar date or the weekday.
OWNER_SEQUENCE_LIGHT = {
    "grammar": 25, "reading": 35, "listening": 25,
    "writing": 40, "speaking": 20, "vocabulary": 35,
}
OWNER_SEQUENCE_HEAVY = {
    "grammar": 25, "reading": 90, "listening": 85,
    "writing": 90, "speaking": 70, "vocabulary": 60,
}


def owner_study_date(start: date, offset: int) -> date:
    """Project an owner study slot onto Mon-Sat; Sunday is never consumed."""
    if offset < 0:
        raise ValueError("invalid_study_offset")
    current = start + timedelta(days=int(start.weekday() == 6))
    for _ in range(offset):
        current += timedelta(days=1)
        if current.weekday() == 6:
            current += timedelta(days=1)
    return current


def owner_workload_for_step(day_number: int) -> dict[str, int]:
    if not 1 <= day_number <= DAYS:
        raise ValueError("invalid_owner_day_number")
    return OWNER_SEQUENCE_LIGHT if day_number % 2 else OWNER_SEQUENCE_HEAVY


def owner_total_minutes_step(day_number: int) -> int:
    return sum(owner_workload_for_step(day_number).values())


def owner_workload_for_date(day: date) -> dict[str, int]:
    """Course days are lighter than independent-practice days."""
    if day.weekday() in (0, 2, 4):
        return OWNER_COURSE_WORKLOAD
    if day.weekday() == 6:
        return OWNER_FULL_MOCK_WORKLOAD
    return OWNER_WORKLOAD


def owner_total_minutes(day: date) -> int:
    return sum(owner_workload_for_date(day).values())

OWNER_PHASES = ("Diagnose and repair", "Build accuracy", "Timed performance",
                "Exam transfer", "Final consolidation")
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
    key = re.sub(r"\s+", " ", value.strip()).lower().replace("_", "-").replace(" ", "-")
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
    # Preserve the authored curriculum order within every CEFR/track bucket.
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
                            revision: int = 1,
                            days: int = DAYS,
                             intensive: bool = False) -> list[dict]:
    if not isinstance(start, date):
        raise ValueError("invalid_start")
    if type(revision) is not int or revision < 1:
        raise ValueError("invalid_revision")
    if type(days) is not int or days not in SUPPORTED_DURATIONS:
        raise ValueError("invalid_duration")
    if type(intensive) is not bool:
        raise ValueError("invalid_intensive_flag")
    sources = catalog if catalog is not None else read_grammar_catalog()
    units = eligible_grammar(level, sources)
    if not units:
        raise ValueError("insufficient_grammar_content")
    result = []
    base_level = level_range(level)[0]
    foundation = [unit for unit in units if unit["level"] == base_level]
    for offset in range(days):
        day_number = offset + 1
        # Start from the learner's own CEFR level. Introduce the harder
        # adjacent level from week three, never on the opening days.
        position = offset
        selection = foundation if offset < 14 and foundation else units
        unit = selection[(position + (revision - 1) * 7) % len(selection)]
        # The owner B2-to-C1 sequence follows examiner-relevant error priority,
        # never flashy patterns merely to display complex syntax.
        owner_focus = None
        if intensive and normalize_level(level) == "B2":
            from .study_plan_owner_curriculum import select_owner_grammar
            authored = select_owner_grammar("B2", day_number, sources)
            if authored:
                unit, owner_focus = authored
        # Keep the existing server-assessed stage for normal student plans.
        stage = 0 if owner_focus is not None else (position // len(units)) % 3
        if unit["source"] != "legacy" and stage != 0:
            # Skill-book server grading currently covers its first stage only.
            # Use an authored legacy Grammar unit for later stages instead.
            legacy = [candidate for candidate in units if candidate["source"] == "legacy"]
            if not legacy:
                raise ValueError("insufficient_verified_grammar")
            unit = legacy[(position + (revision - 1) * 7) % len(legacy)]
        calendar_day = owner_study_date(start, offset) if intensive else start + timedelta(days=offset)
        minutes = owner_workload_for_step(day_number) if intensive else (
            SUNDAY_WORKLOAD if calendar_day.weekday() == 6
            else WORKLOADS[offset % len(WORKLOADS)]
        )
        grammar = PlanTask(
            day=day_number, slot=0, kind="grammar",
            title=(f"IELTS 7+ Grammar — {unit['title']} · {owner_focus} · {STAGE_NAMES[stage]}"[:350]
                   if owner_focus else f"Grammar — {unit['title']} · {STAGE_NAMES[stage]}"),
            href=unit["href"],
            source_key=(f"grammar-book:{'b1' if unit['level'] in ('A0','A1','A2','B1') else unit['level'].lower()}:{unit['id']}:{stage}"
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
        if intensive:
            phase = OWNER_PHASES[min(offset // 7, len(OWNER_PHASES) - 1)]
            reminders = {
                "reading": "Timed accuracy; log every incorrect answer",
                "listening": "Review transcript, distractors and spelling",
                "writing": "Timed Task 1/2; assess four IELTS criteria and rewrite",
                "speaking": "Record, transcribe, correct and re-record",
                "vocabulary": "Learn, recall and use the assigned topic",
            }
            tasks = [
                task if task.kind == "grammar" else PlanTask(
                    day=task.day, slot=task.slot, kind=task.kind,
                    title=f"{task.title} · {phase}: {reminders[task.kind]}",
                    href=task.href, source_key=task.source_key,
                    minutes=task.minutes,
                )
                for task in tasks
            ]
        expected_minutes = owner_total_minutes_step(day_number) if intensive else TARGET_MINUTES
        if sum(task.minutes for task in tasks) != expected_minutes:
            raise ValueError("invalid_daily_budget")
        result.append({"day": day_number, "date": calendar_day.isoformat(),
                       "tasks": tasks})
    return result


def eligible_to_open(day: int, started_on: date, today: date,
                     previous_completed: bool, days: int = DAYS) -> bool:
    """No unlocking from a passed calendar date unless the previous day is complete."""
    return days in SUPPORTED_DURATIONS and 1 <= day <= days and (day == 1 or
                                  (previous_completed and
                                   today >= started_on + timedelta(days=day - 1)))
