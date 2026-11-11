"""Contract and regression coverage for the 30-day sequential plan."""
import asyncio
import json
from pathlib import Path
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import main as core
from app.study_plan_thirty import (
    DAYS, TARGET_MINUTES, eligible_grammar, level_range,
    make_thirty_day_schedule, normalize_level, read_grammar_catalog,
)
from app.study_plan_materials import assign_materials
from app.study_plan_thirty_port import (
    _event_kind, _present, _score_skill_stage, _skill_answer_bank, _sync,
)

START = date(2026, 11, 12)


def test_requires_a_real_cefr_level_from_the_profile():
    assert normalize_level("B2") == "B2"
    assert normalize_level("upper-intermediate") == "B2"
    assert normalize_level("advanced") == "C1"
    assert normalize_level("B2/C1") is None
    assert normalize_level("IELTS 7.5") is None
    assert normalize_level(None) is None
    assert level_range("B2") == ("B2", "C1")
    assert level_range("C2") == ("C2",)
    with pytest.raises(ValueError, match="level_required"):
        level_range("unspecified")


def test_grammar_catalog_reuses_authored_lessons_and_their_real_links():
    content = read_grammar_catalog()
    assert len(content) == 277
    assert len({(unit["source"], unit["id"]) for unit in content}) == len(content)
    assert sum(unit["source"] == "legacy" for unit in content) == 80
    assert sum(unit["source"] == "speaking" for unit in content) == 77
    assert sum(unit["source"] == "writing" for unit in content) == 120
    for unit in content:
        assert unit["href"].startswith("/app/grammar")
        if unit["source"] != "legacy":
            assert unit["group"] in ("pre","inter","upper","advanced","academic","general","task2")
        assert all(len(stage) == 3 for stage in unit["weights"])


def test_b2_to_c1_grammar_is_interleaved_across_old_and_new_lessons():
    chosen = eligible_grammar("B2", read_grammar_catalog())
    assert len(chosen) >= 30
    assert {unit["level"] for unit in chosen} == {"B2", "C1"}
    assert {"legacy","speaking","writing"} <= {unit["source"] for unit in chosen}


def test_thirty_days_each_have_six_exercises_and_120_minute_budget():
    catalog = read_grammar_catalog()
    plan = make_thirty_day_schedule("B2", START, catalog)
    assert plan == make_thirty_day_schedule("B2", START, catalog)
    assert len(plan) == DAYS == 30
    for index, day in enumerate(plan):
        assert day["day"] == index + 1
        assert day["date"] == (START + timedelta(days=index)).isoformat()
        assert len(day["tasks"]) == 6
        assert sum(task.minutes for task in day["tasks"]) == TARGET_MINUTES == 120
        assert {task.kind for task in day["tasks"]} == {
            "grammar", "reading", "listening", "writing", "speaking", "vocabulary"
        }
        assert [task.slot for task in day["tasks"]] == list(range(6))
        assert all(task.href.startswith("/app/") for task in day["tasks"])
    changed = make_thirty_day_schedule("B2", START, catalog, revision=2)
    assert [day["tasks"][0].source_key for day in plan] != [
        day["tasks"][0].source_key for day in changed
    ]


def test_small_curriculum_uses_additional_verified_legacy_stages():
    plan = make_thirty_day_schedule("C2", START)
    assert len(plan) == 30
    assert {day["tasks"][0].stage for day in plan} == {0, 1, 2}
    assert all(day["tasks"][0].source_key.startswith("grammar-book:c2:")
               for day in plan)


def test_server_scores_skill_grammar_answer_keys_not_client_reported_scores():
    bank = _skill_answer_bank()
    assert len(bank) == 197
    track, group, unit = next(key for key in bank if key[0] == "speaking" and key[1] == "upper")
    source = f"skill-grammar:{track}:{group}:{unit}:0"
    perfect = [list(items) for items in bank[track,group,unit]]
    result = _score_skill_stage(source, perfect)
    assert result["passed"]
    assert sum(result["correct"]) == sum(result["total"])
    wrong = [["not in the answer key"] * len(items) for items in perfect]
    assert _score_skill_stage(source, wrong)["passed"] is False
    assert _score_skill_stage(source, perfect[:2]) is None
    assert _score_skill_stage(source.replace(":0", ":1"), perfect) is None
    assert _score_skill_stage(source, [[] for _ in range(3)]) is None


def test_client_cannot_pass_off_page_views_as_verified_exercises():
    assert _event_kind("reading:any-verified-attempt") == "reading"
    assert _event_kind("reading-practice:passage") == "reading"
    assert _event_kind("listening:attempt") == "listening"
    assert _event_kind("writing:submission") == "writing"
    assert _event_kind("speaking:attempt") == "speaking"
    assert _event_kind("vocab") == "vocabulary"
    assert _event_kind("grammar:unverified") is None
    assert _event_kind("page-view:reading") is None
    assert _event_kind("typing:run") is None


@pytest.mark.parametrize("path,verb", [
    ("/api/study-plan/monthly/sequence", "get"),
    ("/api/study-plan/monthly/sequence/start", "post"),
    ("/api/study-plan/monthly/sequence/regenerate", "post"),
    ("/api/study-plan/monthly/sequence/grammar/verify", "post"),
])
def test_plan_api_rejects_anonymous_without_database_access(monkeypatch, path, verb):
    async def anonymous(*args, **kwargs):
        return None

    async def unavailable_database():
        raise AssertionError("Unauthenticated requests must never query private plans")

    monkeypatch.setattr(core, "current_user", anonymous)
    monkeypatch.setattr(core, "pool", unavailable_database)
    client = TestClient(core.app)
    result = client.get(path) if verb == "get" else client.post(path, json={})
    assert result.status_code == 401


def test_calendar_hides_all_future_task_links_until_day_is_unlocked():
    class FakeConnection:
        async def fetch(self, query, cid):
            return [
                {"day_number": day, "slot": slot, "kind": kind,
                 "title": kind, "href": "/app/" + kind, "source_key": kind,
                 "minutes": minutes, "stage_index": 0 if slot == 0 else None,
                 "completed_at": None}
                for day in range(1, 31) for slot, (kind, minutes) in enumerate((
                    ("grammar",25), ("reading",30), ("listening",25),
                    ("writing",20), ("speaking",10), ("vocabulary",10)
                ))
            ]

    cycle = {"id": "fixture", "status": "active", "current_day": 1,
             "timezone": "Asia/Tashkent", "user_id": "fixture", "revision": 1,
             "cefr_level": "B2", "started_on": START}
    payload = asyncio.run(_present(FakeConnection(), cycle,
                                   datetime(2026, 11, 12, 8, tzinfo=timezone.utc)))
    assert len(payload["days"]) == 30
    assert payload["totalDays"] == 30
    assert payload["days"][0]["status"] == "active"
    assert all(item["href"] for item in payload["days"][0]["tasks"])
    assert all(day["status"] == "locked" for day in payload["days"][1:])
    assert all(item["href"] is None for day in payload["days"][1:]
               for item in day["tasks"])


def test_next_day_never_unlocks_before_previous_completion_or_calendar_date():
    class FakeConnection:
        def __init__(self, remaining):
            self.remaining = remaining
            self.executed = []

        async def fetch(self, query, *args):
            assert "study_plan_30_tasks" in query
            return [{"kind": kind, "minutes": minutes, "completed_at": START}
                    for kind, minutes in (("grammar",25), ("reading",30),
                    ("listening",25), ("writing",20), ("speaking",10), ("vocabulary",10))]

        async def fetchval(self, query, *args):
            return self.remaining

        async def execute(self, query, *args):
            self.executed.append(query)

    row = {"status": "active", "user_id": "user", "id": "cycle",
           "current_day": 1, "started_on": START, "timezone": "Asia/Tashkent"}
    tomorrow = datetime(2026, 11, 13, 8, tzinfo=timezone.utc)
    pending = FakeConnection(1)
    assert asyncio.run(_sync(pending, row, tomorrow))["current_day"] == 1
    assert pending.executed == []
    early = FakeConnection(0)
    today = datetime(2026, 11, 12, 8, tzinfo=timezone.utc)
    assert asyncio.run(_sync(early, row, today))["current_day"] == 1
    assert early.executed == []
    finished = FakeConnection(0)
    assert asyncio.run(_sync(finished, row, tomorrow))["current_day"] == 2
    assert len(finished.executed) == 1


def test_missing_task_rows_cannot_unlock_empty_days():
    class MissingTaskConnection:
        async def fetch(self, query, *args):
            return []

    row = {"status": "active", "user_id": "user", "id": "cycle",
           "current_day": 1, "started_on": START, "timezone": "Asia/Tashkent"}
    now = datetime(2026, 11, 13, 8, tzinfo=timezone.utc)
    with pytest.raises(ValueError, match="invalid_current_day_tasks"):
        asyncio.run(_sync(MissingTaskConnection(), row, now))


def test_grammar_answer_manifest_matches_authored_skill_curriculum():
    source_root = Path(__file__).resolve().parents[3] / "frontend" / "vanilla" / "modules" / "grammar"
    catalog = read_grammar_catalog()
    by_group = {}
    for unit in catalog:
        if unit["source"] != "legacy":
            by_group.setdefault((unit["source"], unit["group"]), []).append(unit)
    answers = _skill_answer_bank()
    for (track, group), metadata in by_group.items():
        original = json.loads((source_root / f"book-skill-source-{track}-{group}.json").read_text())
        source_units = {item["id"]: item for item in original["units"]}
        assert set(unit["id"] for unit in metadata) <= set(source_units)
        for unit in metadata:
            stages = source_units[unit["id"]]["stages"]
            actual_answers = [[item["answer"] for item in exercise["items"]]
                              for exercise in stages[0]["groups"]]
            assert answers[(track,group,unit["id"])] == actual_answers


def test_early_cefr_lessons_use_existing_b1_book_evidence_provider():
    for level in ("A0", "A1", "A2"):
        days = make_thirty_day_schedule(level, START)
        for day in days:
            task = day["tasks"][0]
            if task.source_key.startswith("grammar-book:"):
                assert task.source_key.startswith("grammar-book:b1:")
    for level in ("B2", "C1", "C2"):
        days = make_thirty_day_schedule(level, START)
        for day in days:
            task = day["tasks"][0]
            if task.source_key.startswith("grammar-book:"):
                assert not task.source_key.startswith("grammar-book:a")


def test_assignment_materials_uses_real_published_content_ids_and_falls_back_to_site_modules():
    schedule = make_thirty_day_schedule("B2", START)
    pools = {
        "reading": [
            {"title": "Academic Reading — Passage 1",
             "href": "/app/reading/academic/11",
             "source_key": "reading:11"},
        ],
        "listening": [
            {"title": "Academic Listening — Test 7",
             "href": "/app/listening/tests/22/1",
             "source_key": "listening:22"},
        ],
        "writing": [],
        "speaking": [
            {"title": "Speaking Part 2 — Hometown",
             "href": "/app/speaking/ai?part=part2&promptId=33",
             "source_key": "speaking:33"},
        ],
    }
    enriched = assign_materials(schedule, pools)
    assert len(enriched) == 30
    assert enriched[0]["tasks"][1].source_key == "reading:11"
    assert enriched[0]["tasks"][1].href == "/app/reading/academic/11"
    assert enriched[0]["tasks"][2].source_key == "listening:22"
    assert enriched[0]["tasks"][4].source_key == "speaking:33"
    assert enriched[1]["tasks"][1].source_key == "reading"
    assert enriched[1]["tasks"][1].href.startswith("/app/")
    assert enriched[0]["tasks"][3].source_key == "writing"
    assert all(sum(task.minutes for task in day["tasks"]) == 120 for day in enriched)
    assert schedule[0]["tasks"][1].source_key == "reading", "original plan stays immutable"


def test_plan_materials_rejects_unsafe_or_fake_routes():
    schedule = make_thirty_day_schedule("B2", START)
    bad = {"reading": [
        {"title": "Untrusted", "href": "https://foreign.invalid", "source_key": "reading:fake"},
    ]}
    enriched = assign_materials(schedule, bad)
    assert enriched[0]["tasks"][1].source_key == "reading"
    assert enriched[0]["tasks"][1].href == schedule[0]["tasks"][1].href
