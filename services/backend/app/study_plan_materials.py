"""Bind plan slots to published lessons and test material, in cycle order.

Past attempts do not skip Test 1 in a newly created plan. A test is advanced
only after its scheduled day has been verified by the sequence engine.
"""
from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import replace
from datetime import date
from urllib.parse import urlencode

from .browser_common import live
from .browser_listening import catalogue as listening_catalogue
from .browser_reading import academic_catalogue
from .study_plan_thirty import level_range, read_grammar_catalog
from .vocabulary_packs_port import built_in_summaries

LOG = logging.getLogger(__name__)

WRITING_PATTERN = (
    ("writing_lesson", "typing", "writing_lesson", "writing_exam", "typing", "writing_lesson", "writing_exam"),
    ("writing_lesson", "writing_exam", "typing", "writing_exam", "writing_lesson", "typing", "writing_exam"),
    ("writing_exam", "writing_lesson", "writing_exam", "typing", "writing_exam", "writing_exam", "writing_lesson"),
    ("writing_exam", "writing_exam", "writing_lesson", "writing_exam", "typing", "writing_exam", "writing_exam"),
)
SPEAKING_PATTERN = (
    ("speaking_lesson", "speaking_part1", "speaking_lesson", "speaking_part1", "speaking_lesson", "speaking_part1", "speaking_lesson"),
    ("speaking_part1", "speaking_lesson", "speaking_part1", "speaking_part2", "speaking_lesson", "speaking_part2", "speaking_part1"),
    ("speaking_part2", "speaking_lesson", "speaking_part2", "speaking_part2", "speaking_lesson", "speaking_part3", "speaking_part2"),
    ("speaking_part2", "speaking_part3", "speaking_part2", "speaking_lesson", "speaking_part3", "speaking_part3", "speaking_part2"),
)


def _test_order(item: dict) -> tuple[int, str, str]:
    """Use exam numbers, never UUIDs or old completion history, to order tests."""
    title = str(item.get("title") or "")
    found = re.search(r"\btest\s*#?\s*(\d+)\b", title, re.IGNORECASE)
    return (int(found.group(1)) if found else 10_000,
            title.casefold(), item["source_key"])


def _usable(item: dict) -> bool:
    return (all(isinstance(item.get(key), str) and item[key]
                for key in ("title", "href", "source_key"))
            and item["href"].startswith("/app/")
            and not item["href"].startswith("//")
            and len(item["source_key"]) <= 200)


def _general_order(item: dict) -> tuple[int, int, str]:
    return (int(item.get("question_count") or 0),
            int(item.get("minutes") or 20), item["source_key"])


def _stable_mix(items: list[dict], seed: str) -> list[dict]:
    return sorted(items, key=lambda item: hashlib.sha256(
        (seed + ":" + item["source_key"]).encode("utf-8")).hexdigest())


def listening_plan_materials(cards: list[dict]) -> list[dict]:
    """Preserve the authoritative catalogue order, including source ordinals.

    browser_listening.catalogue sorts via listening_order.material_order,
    which knows original source IDs and the numbered test manifest. Re-sorting
    titles here previously broke order for renamed and unnumbered tests.
    """
    result = []
    seen = set()
    for card in cards:
        test_id = str(card.get("testId") or "")
        if not test_id or test_id in seen:
            continue
        seen.add(test_id)
        result.append({
            "source_key": "listening:" + test_id,
            "title": "Listening — " + str(card.get("title") or "Academic Test"),
            "href": "/app/listening/tests/" + test_id + "/1",
        })
    return result


def owner_writing_order(items: list[dict]) -> list[dict]:
    """Interleave two Task 2 prompts for each Task 1, where available.

    Task 2 counts twice in the official IELTS Writing score. Unknown metadata
    remains usable without an invented classification.
    """
    part1 = [item for item in items
             if re.search(r"task[\s_-]*1\b", str(item.get("task_type") or ""), re.I)]
    part2 = [item for item in items
             if re.search(r"task[\s_-]*2\b", str(item.get("task_type") or ""), re.I)]
    known = {id(item) for item in part1 + part2}
    other = [item for item in items if id(item) not in known]
    if not part1 or not part2:
        return items
    result = []
    while part1 or part2:
        for bucket in (part2, part2, part1):
            if bucket:
                result.append(bucket.pop(0))
    return result + other


def assign_materials(schedule: list[dict], pools: dict[str, list[dict]],
                     *, revision: int = 1,
                     intensive: bool = False) -> list[dict]:
    """Sunday: one Academic full Reading test. Other days: one General passage.

    Listening and Sunday Academic Reading start from Test 1 for each new cycle.
    A new numbered test is not offered on an unlocked day until prior-day work
    has been verified; the 30-day engine enforces that prerequisite.
    """
    cursors: dict[str, int] = {}
    owner_writing = owner_writing_order(pools.get("writing_exam") or []) if intensive else []
    result: list[dict] = []
    general = sorted((pools.get("general_reading") or []), key=_general_order)
    general_tiers = [
        _stable_mix(general[(len(general) * tier) // 4:
                            (len(general) * (tier + 1)) // 4],
                    str(revision))
        for tier in range(4)
    ]
    for day in schedule:
        day_date = date.fromisoformat(day["date"])
        offset = day["day"] - 1
        week = min(3, offset // 7)
        day_of_week = offset % 7
        writing_kind = "writing_exam" if intensive else WRITING_PATTERN[week][day_of_week]
        speaking_kind = (
            ("speaking_part1", "speaking_part2", "speaking_part3")[offset % 3]
            if intensive else SPEAKING_PATTERN[week][day_of_week]
        )
        choices = {
            "reading": "reading" if day_date.weekday() == 6 else "general_reading",
            "listening": "listening",
            "writing": writing_kind,
            "speaking": speaking_kind,
        }
        tasks = list(day["tasks"])
        for slot, task in enumerate(tasks):
            kind = choices.get(task.kind)
            if kind is None:
                continue
            if kind == "general_reading":
                available = general_tiers[week]
                if not available:
                    available = general
            elif intensive and kind == "writing_exam":
                available = owner_writing
            else:
                available = pools.get(kind) or []
            if not available and kind in ("writing_lesson", "typing"):
                available = pools.get("writing_exam") or []
                kind = "writing_exam"
            if not available and kind == "speaking_lesson":
                kind = "speaking_part1"
                available = pools.get(kind) or []
            if not available and kind.startswith("speaking_part"):
                available = pools.get("speaking_part1") or pools.get("speaking_part2") or pools.get("speaking_part3") or []
            index = cursors.get(kind, 0)
            if kind == "typing" and available:
                # Typing drills repeat on separate days; only a fresh,
                # server-graded run can complete the currently opened day.
                chosen = available[min(week, len(available) - 1)]
            elif index < len(available):
                chosen = available[index]
                cursors[kind] = index + 1
            elif intensive and available and kind in (
                "listening", "reading", "general_reading", "writing_exam",
                "speaking_part1", "speaking_part2", "speaking_part3"
            ):
                # Never silently fall back to generic proof after published
                # material is exhausted. A fresh, verified repeat attempt
                # for this exact source is still required by the plan engine.
                chosen = available[index % len(available)]
                cursors[kind] = index + 1
            else:
                continue
            if not _usable(chosen):
                continue
            title = chosen["title"]
            if intensive and index >= len(available):
                title = "Repeat for retention — " + title
            if intensive:
                coaching = {
                    "reading": "Timed practice, then analyse wrong answers",
                    "listening": "Transcript, distractors and spelling review",
                    "writing": "Task 1/2 timed, rubric analysis, then rewrite",
                    "speaking": "Record, self-transcribe, correct and re-record",
                }.get(task.kind)
                if coaching:
                    title = f"{title} · {coaching}"
            tasks[slot] = replace(task, title=title[:350],
                                  href=chosen["href"], source_key=chosen["source_key"])
        if day_date.weekday() != 6 and tasks[1].source_key == "reading":
            tasks[1] = replace(tasks[1], title="General Reading — one passage",
                               href="/app/reading/general")
        elif day_date.weekday() == 6 and tasks[1].source_key == "reading":
            tasks[1] = replace(tasks[1], title="Academic Reading — full test",
                               href="/app/reading/academic")
        result.append({**day, "tasks": tasks})
    return result


async def load_owner_pack_pool(con) -> list[dict[str, str]]:
    """Schedule only published topics, with the original built-in fallback."""
    rows = await con.fetch("""SELECT slug,label_en FROM vocabulary_topic_packs
        WHERE publication_state='published'
        ORDER BY position ASC,label_en ASC""")
    packs = [{"slug": row["slug"], "title": row["label_en"]} for row in rows]
    builtins = built_in_summaries()
    if not rows:
        packs = [{"slug": item["id"], "title": item["label"]}
                 for item in builtins]
    else:
        existing = {item["slug"] for item in packs}
        for item in builtins:
            if item["id"] in ("art", "environment") and item["id"] not in existing:
                packs.append({"slug": item["id"], "title": item["label"]})
    return packs


def assign_owner_vocabulary(schedule: list[dict],
                            packs: list[dict[str, str]]) -> list[dict]:
    """One published topic over two days, with verified SRS recall every day.

    Newly published topics can be incorporated in untouched future days.
    Completion stays tied to at least 10 real VOCAB_REVIEWED events.
    """
    if not packs:
        return schedule
    result = []
    for day in schedule:
        index = (day["day"] - 1) // 2
        pack = packs[index % len(packs)]
        activity = ("Learn the pack, then complete 10+ real SRS reviews"
                    if day["day"] % 2 else
                    "Retrieve yesterday's words, then complete 10+ SRS reviews")
        retention = "Retain previous errors (days 1, 3, 7 and 14)"
        tasks = [
            replace(task,
                    title=f"Topic {index + 1}: {pack['title']} · {activity} · {retention}"[:350],
                    href="/app/vocabulary")
            if task.kind == "vocabulary" else task
            for task in day["tasks"]
        ]
        result.append({**day, "tasks": tasks})
    return result


async def load_material_pools(con, user: dict, level: str = "B1") -> dict[str, list[dict]]:
    pools: dict[str, list[dict]] = {
        "reading": [], "general_reading": [], "listening": [],
        "writing_exam": [], "writing_lesson": [], "typing": [
            {"source_key": "typing:30", "title": "Writing — Typing (30 seconds)",
             "href": "/app/writing?tab=typing"},
            {"source_key": "typing:60", "title": "Writing — Typing (60 seconds)",
             "href": "/app/writing?tab=typing&preset=60"},
            {"source_key": "typing:120", "title": "Writing — Typing (2 minutes)",
             "href": "/app/writing?tab=typing&preset=120"},
            {"source_key": "typing:180", "title": "Writing — Typing (3 minutes)",
             "href": "/app/writing?tab=typing&preset=180"},
        ],
        "speaking_lesson": [], "speaking_part1": [], "speaking_part2": [],
        "speaking_part3": [],
    }
    try:
        reading = await academic_catalogue(con, user)
        for row in reading:
            if not row.get("id") or not row.get("title"):
                continue
            test_id = str(row["id"])
            pools["reading"].append({
                "source_key": "reading:" + test_id,
                "title": "Academic Reading — " + str(row["title"]),
                "href": "/app/reading/academic/" + test_id,
            })
        pools["reading"].sort(key=_test_order)
    except Exception:
        LOG.exception("Academic Reading plan catalogue unavailable")
    try:
        passages = await con.fetch(f"""SELECT g.set_id,g.passage_id,g.passage_no,
               p.title,p.suggested_minutes,
               (SELECT count(*) FROM reading_questions q WHERE q.passage_id=g.passage_id) AS question_count
            FROM general_reading_passages g
            JOIN general_reading_sets s ON s.id=g.set_id
            JOIN reading_passages p ON p.id=g.passage_id
            WHERE g.reading_mode='general_practice'
              AND {live('s')} AND {live('p')}
              AND NOT EXISTS(SELECT 1 FROM activity_events e
                 WHERE e.id=md5('deleted-content:'||s.id::text)::uuid
                   AND e.type='CONTENT_DELETED')
              AND EXISTS(SELECT 1 FROM reading_questions q WHERE q.passage_id=g.passage_id)
            ORDER BY g.set_id,g.passage_no""")
        for row in passages:
            passage_id = str(row["passage_id"])
            pools["general_reading"].append({
                "source_key": "reading-practice:" + passage_id,
                "title": "General Reading — " + str(row["title"] or "Passage"),
                "href": "/app/reading/general/" + str(row["set_id"]) +
                        "?passage=" + str(row["passage_no"]),
                "minutes": row["suggested_minutes"] or 20,
                "question_count": row["question_count"],
            })
    except Exception:
        LOG.exception("General Reading plan catalogue unavailable")
    try:
        listening = await listening_catalogue(con, user, "academic_full_test", {})
        pools["listening"] = listening_plan_materials(listening.get("cards", []))
    except Exception:
        LOG.exception("Listening plan catalogue unavailable")
    try:
        writing = await con.fetch(f"""SELECT p.id,p.category,p.task_type
            FROM writing_prompts p WHERE {live('p')} AND p.is_active
              AND NOT EXISTS(SELECT 1 FROM activity_events e
                WHERE e.id=md5('deleted-content:'||p.id::text)::uuid
                  AND e.type='CONTENT_DELETED')
            ORDER BY CASE WHEN lower(coalesce(p.task_type::text,'')) LIKE '%task 1%' THEN 0
                          WHEN lower(coalesce(p.task_type::text,'')) LIKE '%task 2%' THEN 2
                          ELSE 1 END,p.created_at,p.id LIMIT 100""")
        for row in writing:
            prompt_id = str(row["id"])
            pools["writing_exam"].append({
                "source_key": "writing:" + prompt_id,
                "title": "Writing — " + str(row["category"] or row["task_type"] or "Task"),
                "href": "/app/writing/prompts/" + prompt_id,
                "task_type": str(row["task_type"] or ""),
            })
    except Exception:
        LOG.exception("Writing plan catalogue unavailable")
    try:
        speaking = await con.fetch(f"""SELECT p.id,p.part,p.prompt_text
            FROM speaking_prompts p WHERE {live('p')} AND p.is_active
              AND p.part IN ('part1','part2','part3')
              AND (p.available_in @> '["ai"]'::jsonb
                   OR p.available_in @> '["practice_alone"]'::jsonb)
              AND NOT EXISTS(SELECT 1 FROM activity_events e
                WHERE e.id=md5('deleted-content:'||p.id::text)::uuid
                  AND e.type='CONTENT_DELETED')
            ORDER BY p.part,p.created_at,p.id LIMIT 400""")
        for row in speaking:
            prompt_id = str(row["id"])
            pools["speaking_" + str(row["part"])].append({
                "source_key": "speaking:" + prompt_id,
                "title": "Speaking — " + str(row["prompt_text"] or "IELTS response"),
                "href": "/app/speaking/ai?" + urlencode({
                    "part": row["part"], "promptId": prompt_id,
                }),
            })
    except Exception:
        LOG.exception("Speaking plan catalogue unavailable")
    try:
        allowed = level_range(level)
        for unit in read_grammar_catalog():
            if unit["level"] not in allowed or unit["source"] not in ("writing", "speaking"):
                continue
            kind = str(unit["source"]) + "_lesson"
            pools[kind].append({
                "source_key": "skill-grammar:" + ":".join((
                    unit["source"], unit["group"], unit["id"], "0")),
                "title": ("Writing lesson — " if kind == "writing_lesson"
                          else "Speaking lesson — ") + str(unit["title"]),
                "href": unit["href"],
                "level": unit["level"],
            })
        for kind in ("writing_lesson", "speaking_lesson"):
            pools[kind].sort(key=lambda unit: (
                allowed.index(unit["level"]), unit["title"].casefold()))
    except Exception:
        LOG.exception("Skill lesson plan catalogue unavailable")
    return pools
