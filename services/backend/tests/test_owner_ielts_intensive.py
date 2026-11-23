"""Owner-only IELTS intensive and public Vocabulary publication contracts."""
import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import main as core
from app.study_plan_thirty import (
    TARGET_MINUTES, OWNER_LIGHT_MINUTES, OWNER_HEAVY_MINUTES,
    OWNER_SUNDAY_MINUTES, owner_total_minutes, make_thirty_day_schedule,
)
from app.study_plan_materials import (
    assign_owner_vocabulary, owner_writing_order,
    listening_plan_materials, assign_materials,
)
from app.listening_order import material_order
from app.step19_vocab_srs_port import DAYS as SRS_INTERVALS
from app.study_plan_thirty_port import _present, _sync
from app.vocabulary_packs_port import validate_public_pack

START = date(2026, 11, 22)


def test_owner_schedule_retains_all_six_verified_tasks_for_30_days():
    from app.study_plan_thirty import owner_study_date, owner_total_minutes_step
    days = make_thirty_day_schedule("B2", START, intensive=True)
    assert len(days) == 30
    for index, day in enumerate(days):
        tasks = {task.kind: task for task in day["tasks"]}
        assert len(tasks) == 6
        assert sum(task.minutes for task in tasks.values()) == owner_total_minutes_step(index + 1)
        assert sum(task.minutes for task in tasks.values()) == (180 if index % 2 == 0 else 420)
        assert date.fromisoformat(day["date"]) == owner_study_date(START, index)
        assert date.fromisoformat(day["date"]).weekday() != 6
        assert tasks["writing"].minutes >= 40
        assert tasks["speaking"].minutes >= 20
        assert 15 <= tasks["vocabulary"].minutes <= 60
        assert all(0 < task.minutes <= 90 for task in tasks.values())
        assert tasks["grammar"].source_key.startswith(("grammar-book:", "skill-grammar:"))
    assert days == make_thirty_day_schedule("B2", START, intensive=True)


def test_student_schedule_remains_unchanged():
    for days in (7, 30):
        standard = make_thirty_day_schedule("B2", START, days=days)
        assert len(standard) == days
        assert all(sum(task.minutes for task in d["tasks"]) == TARGET_MINUTES for d in standard)


def test_owner_vocabulary_two_day_topic_windows_with_only_published_packs():
    plan = make_thirty_day_schedule("B2", START, intensive=True)
    packs = [{"slug": f"topic_{i}", "title": f"Topic {i}"} for i in range(11)]
    result = assign_owner_vocabulary(plan, packs)
    assert len(result) == 30
    for window in range(15):
        first = next(t for t in result[window * 2]["tasks"] if t.kind == "vocabulary")
        second = next(t for t in result[window * 2 + 1]["tasks"] if t.kind == "vocabulary")
        expected = f"Topic {min(window, 10)}"
        assert expected in first.title and expected in second.title
        assert "10+ verified" in first.title or "10+ verified" in second.title
        assert first.source_key == second.source_key == "vocab"
        assert first.href == second.href == "/app/vocabulary"
    assert assign_owner_vocabulary(plan, []) == plan


def test_listening_order_uses_original_manifest_instead_of_title_sorting():
    cards = [
        {"source_id": "listening-test-2", "id": "test2",
         "title": "Test 2", "testId": "test2"},
        {"source_id": "listening-test-1", "id": "test1",
         "title": "Unnumbered foundation", "testId": "test1"},
        {"source_id": "listening-test-3", "id": "test3",
         "title": "Test 3", "testId": "test3"},
    ]
    ordered = sorted(cards, key=material_order)
    pool = listening_plan_materials(ordered)
    assert [material["source_key"] for material in pool] == [
        "listening:test1", "listening:test2", "listening:test3",
    ]
    days = make_thirty_day_schedule("B2", START, intensive=True)
    assigned = assign_materials(days, {"listening": pool}, intensive=True)
    assert [day["tasks"][2].source_key for day in assigned[:6]] == [
        "listening-mcq:1", "listening:test1",
        "listening-mcq:2", "listening:test2",
        "listening-mcq:3", "listening:test3",
    ]
    assert assigned[0]["tasks"][2].href == "/app/listening/mcq/day/1"
    assert "Intensive day" in assigned[1]["tasks"][2].title


def test_owner_server_retention_is_real_and_locked_links_are_hidden():
    schedule = assign_owner_vocabulary(
        make_thirty_day_schedule("B2", START, intensive=True),
        [{"slug": f"topic_{i}", "title": f"Pack {i}"} for i in range(15)],
    )

    class Fake:
        async def fetch(self, query, cycle_id):
            rows = []
            for day in schedule:
                for task in day["tasks"]:
                    rows.append({
                        "day_number": day["day"], "slot": task.slot,
                        "kind": task.kind, "title": task.title, "href": task.href,
                        "source_key": task.source_key, "minutes": task.minutes,
                        "stage_index": task.stage, "completed_at": None,
                    })
            return rows

    cycle = {
        "id": "fixture", "status": "active", "current_day": 1,
        "timezone": "Asia/Tashkent", "user_id": "fixture", "revision": 1,
        "cefr_level": "B2", "duration_days": 30, "started_on": START,
    }
    payload = asyncio.run(_present(
        Fake(), cycle, datetime(2026, 11, 22, 9, tzinfo=timezone.utc),
        owner=True))
    assert payload["days"][0]["retention"]["requiredReviews"] == 10
    assert tuple(SRS_INTERVALS[:4]) == (1, 3, 7, 16)
    assert payload["days"][0]["retention"]["href"] == "/app/vocabulary?tab=revision"
    assert payload["days"][0]["retention"]["gamesHref"] == "/app/vocabulary/games"
    for index, day in enumerate(payload["days"]):
        assert day["minutes"] == owner_total_minutes(
            date.fromisoformat(day["originalDate"].isoformat()))
        assert day["retention"]["minutesIncludedInVocabulary"] == day["tasks"][5]["minutes"]
        assert day["retention"]["reviewDays"] == [
            n for n in (1, 3, 7, 16) if index >= n
        ]
        if index:
            assert day["retention"]["href"] is None
            assert day["retention"]["gamesHref"] is None
            assert day["status"] == "locked"
    assert payload["days"][8]["retention"]["previousTopics"]


@pytest.mark.parametrize("correct_distinct,accepted", [(9, False), (10, True)])
def test_owner_retention_game_fallback_requires_ten_distinct_verified_correct_answers(
        correct_distinct, accepted):
    now = datetime(2026, 11, 22, 12, tzinfo=timezone.utc)
    tasks = make_thirty_day_schedule("B2", START, intensive=True)[0]["tasks"]

    class Fake:
        def __init__(self):
            self.writes = []

        async def fetch(self, sql, *args):
            if "FROM study_plan_30_tasks" in sql:
                return [
                    {"kind": task.kind, "minutes": task.minutes,
                     "source_key": task.source_key, "completed_at": None}
                    for task in tasks
                ]
            return []

        async def fetchrow(self, sql, *args):
            if "VOCAB_GAME_PRACTICED" in sql:
                assert "DISTINCT payload->>'entryId'" in sql
                assert "payload->>'verified'='true'" in sql
                assert "payload->>'correct'='true'" in sql
                return {"completed": correct_distinct, "at": now}
            return None

        async def fetchval(self, sql, *args):
            return 1

        async def execute(self, sql, *args):
            self.writes.append((sql, args))

    cycle = {
        "status": "active", "user_id": "user", "id": "cycle",
        "current_day": 1, "started_on": START,
        "timezone": "Asia/Tashkent", "opened_at": now - timedelta(hours=1),
    }
    con = Fake()
    asyncio.run(_sync(con, cycle, now, owner=True))
    proof = [
        args for sql, args in con.writes
        if "UPDATE study_plan_30_tasks" in sql and args[2] == "vocabulary"
    ]
    assert bool(proof) is accepted
    if accepted:
        assert proof[0][4]["source"] == "vocab_game_recall"


def test_student_budget_rejects_owner_intensive_rows():
    class Fake:
        async def fetch(self, *args):
            return [
                {"kind": task.kind, "minutes": task.minutes,
                 "completed_at": None}
                for task in make_thirty_day_schedule("B2", START, intensive=True)[0]["tasks"]
            ]
    cycle = {"status": "active", "user_id": "fixture", "id": "cycle",
             "current_day": 1, "started_on": START, "timezone": "Asia/Tashkent"}
    with pytest.raises(ValueError, match="invalid_current_day_tasks"):
        asyncio.run(_sync(Fake(), cycle, datetime.now(timezone.utc)))


def test_intensive_writing_favors_task_two_by_two_to_one():
    original = [
        *({"task_type": "task_1", "source_key": f"one:{i}"} for i in range(3)),
        *({"task_type": "Task 2", "source_key": f"two:{i}"} for i in range(6)),
    ]
    ordered = owner_writing_order(original)
    assert [item["source_key"].split(":")[0] for item in ordered] == [
        "two", "two", "one", "two", "two", "one", "two", "two", "one"
    ]
    assert len(original) == 9
    assert owner_writing_order(original[:3]) == original[:3]


def valid_input():
    return {
        "slug": "public_energy",
        "labelEn": "Public Energy",
        "labelUz": "Ommaviy energiya",
        "words": [
            {"term": f"term {i}", "partOfSpeech": "noun",
             "definitionEn": f"definition {i}", "translationUz": f"tarjima {i}",
             "example": f"Example sentence {i}."} for i in range(5)
        ],
    }


def test_public_publisher_validates_required_translations_and_deduplicates():
    good = valid_input()
    assert validate_public_pack(good)["slug"] == "public_energy"
    for mutant in (
        {**good, "slug": "../../unsafe"},
        {**good, "words": good["words"][:4]},
        {**good, "words": good["words"] + [good["words"][0]]},
        {**good, "extra": True},
        {**good, "words": [{**good["words"][0], "translationUz": ""}, *good["words"][1:]]},
    ):
        assert validate_public_pack(mutant) is None


@pytest.mark.parametrize("role,status", [(None, 401), ("student", 403), ("teacher", 403)])
def test_public_publisher_rejects_unauthorized_before_database(monkeypatch, role, status):
    async def user(*args, **kwargs):
        return {"role": role, "id": "user"} if role else None

    async def unavailable_pool():
        raise AssertionError("Unauthorized publisher accessed database")

    monkeypatch.setattr(core, "current_user", user)
    monkeypatch.setattr(core, "pool", unavailable_pool)
    result = TestClient(core.app).post("/api/vocabulary/packs/public", json=valid_input())
    assert result.status_code == status


def test_owner_invalid_pack_rejected_before_database(monkeypatch):
    async def owner(*args, **kwargs):
        return {"role": "owner", "id": "user"}

    async def unavailable_pool():
        raise AssertionError("Invalid pack accessed database")

    monkeypatch.setattr(core, "current_user", owner)
    monkeypatch.setattr(core, "pool", unavailable_pool)
    payload = valid_input()
    payload["words"][0]["translationUz"] = ""
    result = TestClient(core.app).post("/api/vocabulary/packs/public", json=payload)
    assert result.status_code == 400
