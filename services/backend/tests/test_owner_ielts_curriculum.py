"""Regressions for the owner-only IELTS Band 8 accuracy curriculum."""
from __future__ import annotations

import asyncio
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone

import pytest

from app.study_plan_thirty import make_thirty_day_schedule, owner_total_minutes
from app.study_plan_owner_curriculum import (
    ARTICLES, MEDIA_MINUTES, OWNER_GRAMMAR_SEQUENCE, OWNER_MEDIA_DAYS,
    SRS_DELAYS, enrich_owner_plan, select_owner_grammar,
)
from app.study_plan_thirty_port import _owner_slots_valid, _sync


START = date(2026, 11, 22)


def video_pool():
    return {source: {"id": f"10000000-0000-4000-8000-{day:012d}",
                     "title": f"Published TED video {day}"}
            for day, (kind, source, _) in OWNER_MEDIA_DAYS.items()
            if kind == "video"}


def test_grammar_is_source_authored_and_exam_accuracy_first():
    curriculum = make_thirty_day_schedule("B2", START, intensive=True)
    assert len(OWNER_GRAMMAR_SEQUENCE) == 30
    ids = [day["tasks"][0].source_key.split(":")[-2] for day in curriculum]
    assert ids[:7] == ["b2-9", "wr-083", "wr-086", "b2-13",
                        "wr-082", "b2-1", "wr-085"]
    assert ids[20] == "c1-8"
    assert ids[29] == "c1-2"
    assert all("IELTS 7+ Grammar" in day["tasks"][0].title for day in curriculum)
    assert all(day["tasks"][0].stage == 0 for day in curriculum)
    assert select_owner_grammar("B1", 1, []) is None
    assert not any("IELTS 7+ Grammar" in day["tasks"][0].title
                   for day in make_thirty_day_schedule("B1", START))
    assert not any("IELTS 7+ Grammar" in day["tasks"][0].title
                   for day in make_thirty_day_schedule("B2", START))


def test_retention_article_ted_are_real_tasks_with_no_extra_time():
    baseline = make_thirty_day_schedule("B2", START, intensive=True)
    curated = enrich_owner_plan(baseline, video_pool(), level="B2")
    assert len(curated) == 30
    assert [d["day"] for d in curated] == list(range(1, 31))
    assert SRS_DELAYS == (1, 3, 7, 16)
    assert MEDIA_MINUTES == 20
    assert len(OWNER_MEDIA_DAYS) == 12
    assert all(len(d["tasks"]) == (8 if d["day"] in OWNER_MEDIA_DAYS else 7)
               for d in curated)
    assert all(_owner_slots_valid([asdict(task) for task in d["tasks"]])
               for d in curated)
    for before, after in zip(baseline, curated):
        assert len(before["tasks"]) == 6
        assert sum(task.minutes for task in after["tasks"]) == owner_total_minutes(
            date.fromisoformat(after["date"]))
        assert [task.source_key for task in before["tasks"]] == [
            task.source_key for task in after["tasks"][:6]]
        assert [task.href for task in before["tasks"]] == [
            task.href for task in after["tasks"][:6]]
        retention = after["tasks"][6]
        assert retention.kind == "retention"
        assert retention.href in (
            "/app/reading/retention?level=B2", "/app/reading/retention?level=C1")
        if after["day"] < 21:
            assert retention.source_key == "retention:B2"
        else:
            assert retention.source_key == "retention:C1"
        if after["day"] in OWNER_MEDIA_DAYS:
            media = after["tasks"][7]
            kind, source, objective = OWNER_MEDIA_DAYS[after["day"]]
            assert media.kind == kind
            assert objective in media.title
            assert media.minutes == MEDIA_MINUTES
            if kind == "article":
                assert source in ARTICLES
                assert media.source_key == "article:" + source
                assert media.href == "/app/reading/articles/" + source
            else:
                assert media.href.startswith("/app/video-lessons/")
                assert media.source_key == "video:" + video_pool()[source]["id"]


def test_owner_supplements_are_not_fabricated_when_video_is_unpublished():
    base = make_thirty_day_schedule("B2", START, intensive=True)
    plan = enrich_owner_plan(base, {}, level="B2")
    for day in plan:
        video_day = OWNER_MEDIA_DAYS.get(day["day"])
        if video_day and video_day[0] == "video":
            assert len(day["tasks"]) == 7
            assert day["tasks"][2].minutes > 0
            assert sum(task.minutes for task in day["tasks"]) == owner_total_minutes(
                date.fromisoformat(day["date"]))
    assert enrich_owner_plan(base, {}, level="C1") is base


@pytest.mark.parametrize("kind,source_key", [
    ("retention", "retention:B2"),
    ("article", "article:advertising"),
    ("video", "video:10000000-0000-4000-8000-000000000005"),
])
def test_daily_completion_demands_server_evidence(kind, source_key):
    now = datetime(2026, 11, 23, 8, tzinfo=timezone.utc)
    tasks = make_thirty_day_schedule("B2", START, intensive=True)[0]["tasks"]
    rows = [
        {"kind": task.kind, "source_key": task.source_key, "minutes": task.minutes,
         "completed_at": None}
        for task in tasks
    ]
    rows[1]["minutes"] -= 7
    rows[2]["minutes"] -= 8
    rows.append({"kind": kind, "source_key": source_key, "minutes": 15,
                 "completed_at": None})
    # Article and video supplements ordinarily occupy slot 7 after Retention.
    # For this proof-focused fake, only the pending verification path matters.
    async def run(eligible: bool):
        class Connection:
            def __init__(self):
                self.writes = []

            async def fetch(self, query, *args):
                return rows if "FROM study_plan_30_tasks" in query else []

            async def fetchrow(self, query, *args):
                if "VOCAB_GAME_PRACTICED" in query:
                    return {"completed": 0, "at": None}
                return None

            async def fetchval(self, query, *args):
                if "retention_attempts" in query or (
                    "READING_ARTICLE_PLAN_COMPLETED" in query) or (
                    "FROM video_lesson_progress" in query):
                    return now if eligible else None
                if "count(*)::int FROM study_plan_30_tasks" in query:
                    return 1
                return None

            async def execute(self, query, *args):
                self.writes.append((query, args))

        conn = Connection()
        cycle = {"status": "active", "id": "cycle", "user_id": "owner",
                 "current_day": 1, "opened_at": now - timedelta(hours=1),
                 "started_on": START, "timezone": "Asia/Tashkent"}
        await _sync(conn, cycle, now, owner=True)
        return [args[2] for query, args in conn.writes
                if "UPDATE study_plan_30_tasks" in query and len(args) >= 5]

    assert kind not in asyncio.run(run(False))
    assert kind in asyncio.run(run(True))
