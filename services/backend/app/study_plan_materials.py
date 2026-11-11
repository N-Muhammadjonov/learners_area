"""Bind generic plan slots to published, reachable Learners Area activities.

The catalogue is read only when creating/regenerating a plan. Entries that are
currently locked or unavailable are not promised as actionable daily work.
"""
from __future__ import annotations

from dataclasses import replace
import logging
from typing import Any
from urllib.parse import urlencode

from .browser_common import live
from .browser_listening import catalogue as listening_catalogue
from .browser_reading import academic_catalogue

LOG=logging.getLogger(__name__)


def assign_materials(schedule: list[dict], pools: dict[str, list[dict]],
                     *, revision: int = 1) -> list[dict]:
    """Produce 30 days with distinct real material where available, otherwise
    retain existing module catalogue shortcuts. No fabricated content IDs.
    """
    result: list[dict] = []
    for day in schedule:
        tasks = list(day["tasks"])
        for slot, task in enumerate(tasks):
            if slot == 0 or task.kind == "vocabulary":
                continue
            materials = pools.get(task.kind) or []
            index = day["day"] - 1 + (revision - 1) * 3
            if not 0 <= index < len(materials):
                continue
            item = materials[index]
            if not all(isinstance(item.get(key), str) and item[key]
                       for key in ("title", "href", "source_key")):
                continue
            if not item["href"].startswith("/app/") or len(item["source_key"]) > 200:
                continue
            tasks[slot] = replace(task, title=item["title"][:350],
                                  href=item["href"], source_key=item["source_key"])
        result.append({**day, "tasks": tasks})
    return result


async def load_material_pools(con, user: dict) -> dict[str, list[dict]]:
    pools: dict[str, list[dict]] = {
        "reading": [], "listening": [], "writing": [], "speaking": [],
    }
    try:
        reading = await academic_catalogue(con, user)
        for row in reading:
            if (row.get("locked") or row.get("assessmentStatus")=="completed" or
                    not row.get("id") or not row.get("title")):
                continue
            test_id = str(row["id"])
            pools["reading"].append({
                "source_key": "reading:" + test_id,
                "title": "Reading — " + str(row["title"]),
                "href": "/app/reading/academic/" + test_id,
            })
    except Exception:
        # If a module cannot be queried, its task stays a working module entry.
        LOG.exception('Reading plan catalogue was unavailable')
    try:
        listening = await listening_catalogue(con, user, "academic_full_test", {})
        for row in listening.get("cards", []):
            if row.get("locked") or row.get("exam") or not row.get("testId"):
                continue
            test_id = str(row["testId"])
            pools["listening"].append({
                "source_key": "listening:" + test_id,
                "title": "Listening — " + str(row.get("title") or "Academic practice"),
                "href": "/app/listening/tests/" + test_id + "/1",
            })
    except Exception:
        LOG.exception('Listening plan catalogue was unavailable')
    writing = await con.fetch(f"""SELECT p.id,p.category,p.task_type
        FROM writing_prompts p
        WHERE {live('p')} AND p.is_active
          AND NOT EXISTS(SELECT 1 FROM activity_events e
            WHERE e.id=md5('deleted-content:'||p.id::text)::uuid
              AND e.type='CONTENT_DELETED')
          AND NOT EXISTS(SELECT 1 FROM writing_submissions s
            WHERE s.user_id=$1 AND s.prompt_id=p.id AND s.submitted_at IS NOT NULL)
        ORDER BY p.created_at,p.id LIMIT 40""", user["id"])
    for row in writing:
        prompt_id = str(row["id"])
        pools["writing"].append({
            "source_key": "writing:" + prompt_id,
            "title": "Writing — " + str(row["category"] or row["task_type"] or "Task"),
            "href": "/app/writing/prompts/" + prompt_id,
        })
    speaking = await con.fetch(f"""SELECT p.id,p.part,p.prompt_text
        FROM speaking_prompts p
        WHERE {live('p')} AND p.is_active AND p.part IN ('part1','part2','part3')
          AND (p.available_in @> '["ai"]'::jsonb
               OR p.available_in @> '["practice_alone"]'::jsonb)
          AND NOT EXISTS(SELECT 1 FROM activity_events e
            WHERE e.id=md5('deleted-content:'||p.id::text)::uuid
              AND e.type='CONTENT_DELETED')
          AND NOT EXISTS(SELECT 1 FROM speaking_attempts s
            WHERE s.user_id=$1 AND s.prompt_id=p.id AND s.submitted_at IS NOT NULL)
        ORDER BY p.part,p.created_at,p.id LIMIT 40""", user["id"])
    for row in speaking:
        prompt_id = str(row["id"])
        pools["speaking"].append({
            "source_key": "speaking:" + prompt_id,
            "title": "Speaking — " + str(row["prompt_text"] or "IELTS response"),
            "href": "/app/speaking/ai?" + urlencode({
                "part": row["part"], "promptId": prompt_id,
            }),
        })
    return pools
