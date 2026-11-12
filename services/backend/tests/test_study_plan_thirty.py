"""Contract and regression coverage for the 30-day sequential plan."""
import asyncio
import json
from pathlib import Path
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import main as core
from app.study_plan_thirty import (
    DAYS, SUPPORTED_DURATIONS, TARGET_MINUTES, eligible_grammar, level_range,
    make_thirty_day_schedule, normalize_level, read_grammar_catalog,
)
from app.study_plan_materials import assign_materials
from app.study_plan_port import plan_participant
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
            if "max(completed_at)" in query:
                return datetime(2026, 11, 12, 8, tzinfo=timezone.utc)
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


def test_assignment_materials_uses_general_passages_on_weekdays_and_full_reading_on_sunday():
    schedule = make_thirty_day_schedule("B2", START)
    pools = {
        "reading": [
            {"title": "Reading Test 1", "href": "/app/reading/academic/11",
             "source_key": "reading:11"},
            {"title": "Reading Test 2", "href": "/app/reading/academic/12",
             "source_key": "reading:12"},
        ],
        "general_reading": [
            {"title": f"General Passage {number}",
             "href": f"/app/reading/general/set?passage={number}",
             "source_key": f"reading-practice:{number}",
             "question_count": number * 2, "minutes": 20}
            for number in range(1, 29)
        ],
        "listening": [
            {"title": "Listening Test 1", "href": "/app/listening/tests/21/1",
             "source_key": "listening:21"},
            {"title": "Listening Test 2", "href": "/app/listening/tests/22/1",
             "source_key": "listening:22"},
        ],
        "writing_lesson": [
            {"title": "Writing grammar lesson",
             "href": "/app/grammar?tab=writing&book=unit1",
             "source_key": "skill-grammar:writing:general:unit1:0"}
        ],
        "writing_exam": [
            {"title": "Writing Task 1", "href": "/app/writing/prompts/31",
             "source_key": "writing:31"}
        ],
        "typing": [
            {"title": "Typing 30s", "href": "/app/writing?tab=typing",
             "source_key": "typing:30"}
        ],
        "speaking_lesson": [
            {"title": "Speaking grammar lesson",
             "href": "/app/grammar?tab=speaking&book=unit1",
             "source_key": "skill-grammar:speaking:upper:unit1:0"}
        ],
        "speaking_part1": [
            {"title": "Speaking Part 1",
             "href": "/app/speaking/ai?part=part1&promptId=33",
             "source_key": "speaking:33"}
        ],
    }
    enriched = assign_materials(schedule, pools)
    assert len(enriched) == DAYS
    assert enriched[0]["tasks"][1].source_key.startswith("reading-practice:")
    assert enriched[3]["tasks"][1].source_key == "reading:11"
    assert enriched[10]["tasks"][1].source_key == "reading:12"
    assert enriched[0]["tasks"][2].source_key == "listening:21"
    assert enriched[1]["tasks"][2].source_key == "listening:22"
    assert enriched[0]["tasks"][3].source_key.startswith("skill-grammar:writing:")
    assert enriched[1]["tasks"][3].source_key == "typing:30"
    assert enriched[0]["tasks"][4].source_key.startswith("skill-grammar:speaking:")
    assert enriched[1]["tasks"][4].source_key == "speaking:33"
    assert all(sum(task.minutes for task in day["tasks"]) == TARGET_MINUTES
               for day in enriched)
    assert schedule[0]["tasks"][1].source_key == "reading"


def test_full_reading_only_on_sundays_and_general_passages_do_not_repeat():
    schedule = make_thirty_day_schedule("B1", START)
    pools = {
        "reading": [
            {"title": f"Reading Test {number}",
             "href": f"/app/reading/academic/{number}",
             "source_key": f"reading:{number}"}
            for number in range(1, 8)
        ],
        "general_reading": [
            {"title": f"General Passage {number}",
             "href": f"/app/reading/general/set?passage={number}",
             "source_key": f"reading-practice:{number}",
             "question_count": number, "minutes": 15}
            for number in range(1, 161)
        ],
    }
    enriched = assign_materials(schedule, pools)
    used = []
    sunday_tests = []
    for day in enriched:
        reading = day["tasks"][1]
        if date.fromisoformat(day["date"]).weekday() == 6:
            sunday_tests.append(reading.source_key)
            assert reading.href.startswith("/app/reading/academic/")
            assert reading.minutes == 60
        else:
            used.append(reading.source_key)
            assert reading.source_key.startswith("reading-practice:")
            assert reading.href.startswith("/app/reading/general/")
            assert reading.minutes < 60
    assert sunday_tests == ["reading:1", "reading:2", "reading:3", "reading:4"]
    assert len(used) == len(set(used))


def test_first_two_weeks_stay_at_the_learner_level():
    plan = make_thirty_day_schedule("B2", START)
    assert all(":b2:" in day["tasks"][0].source_key.lower()
               or day["tasks"][0].source_key.startswith("skill-grammar:")
               for day in plan[:14])
    assert all(day["tasks"][0].minutes == (10 if date.fromisoformat(day["date"]).weekday() == 6
                                          else day["tasks"][0].minutes)
               for day in plan[:14])


def test_plan_materials_rejects_unsafe_or_fake_routes():
    schedule = make_thirty_day_schedule("B2", START)
    bad = {
        "reading": [
            {"title": "Untrusted", "href": "https://foreign.invalid",
             "source_key": "reading:fake"}
        ],
        "general_reading": [
            {"title": "Untrusted", "href": "//foreign.invalid",
             "source_key": "reading-practice:fake"}
        ],
    }
    enriched = assign_materials(schedule, bad)
    assert enriched[0]["tasks"][1].source_key == "reading"
    assert enriched[0]["tasks"][1].href == "/app/reading/general"
    assert enriched[3]["tasks"][1].source_key == "reading"
    assert enriched[3]["tasks"][1].href == "/app/reading/academic"


@pytest.mark.parametrize("duration", (7, 30))
def test_user_selected_durations_generate_real_six_task_days(duration):
    schedule = make_thirty_day_schedule("B2", START, days=duration)
    assert duration in SUPPORTED_DURATIONS
    assert len(schedule) == duration
    assert [d["day"] for d in schedule] == list(range(1, duration + 1))
    for day in schedule:
        assert len(day["tasks"]) == 6
        assert sum(task.minutes for task in day["tasks"]) == TARGET_MINUTES
    with pytest.raises(ValueError, match="invalid_duration"):
        make_thirty_day_schedule("B2", START, days=60)
    with pytest.raises(ValueError, match="invalid_duration"):
        make_thirty_day_schedule("B2", START, days=True)


def test_seven_day_api_projection_has_no_eighth_day_or_unlocked_future_links():
    class FakeConnection:
        async def fetch(self, query, cid):
            return [
                {"day_number": day, "slot": slot, "kind": kind,
                 "title": kind, "href": "/app/" + kind, "source_key": kind,
                 "minutes": minutes, "stage_index": 0 if slot == 0 else None,
                 "completed_at": None}
                for day in range(1, 8)
                for slot, (kind, minutes) in enumerate((
                    ("grammar", 25), ("reading", 30), ("listening", 25),
                    ("writing", 20), ("speaking", 10), ("vocabulary", 10),
                ))
            ]

    cycle = {"id": "fixture", "status": "active", "current_day": 1,
             "timezone": "Asia/Tashkent", "user_id": "fixture",
             "revision": 1, "cefr_level": "B2", "duration_days": 7,
             "started_on": START}
    payload = asyncio.run(_present(
        FakeConnection(), cycle, datetime(2026, 11, 12, 8, tzinfo=timezone.utc)))
    assert payload["totalDays"] == 7
    assert len(payload["days"]) == 7
    assert all(day["status"] == "locked" for day in payload["days"][1:])
    assert all(task["href"] is None for day in payload["days"][1:]
               for task in day["tasks"])


def test_seventh_completed_day_finishes_seven_day_cycle():
    class FakeConnection:
        def __init__(self):
            self.executed = []

        async def fetch(self, query, *args):
            return [{"kind": kind, "minutes": minutes, "completed_at": START}
                    for kind, minutes in (
                        ("grammar",25), ("reading",30), ("listening",25),
                        ("writing",20), ("speaking",10), ("vocabulary",10))]

        async def fetchval(self, query, *args):
            return 0

        async def execute(self, query, *args):
            self.executed.append(query)

    row = {"status": "active", "user_id": "user", "id": "cycle",
           "current_day": 7, "duration_days": 7,
           "started_on": START, "timezone": "Asia/Tashkent"}
    fake = FakeConnection()
    done = asyncio.run(_sync(
        fake, row, datetime(2026, 11, 18, 8, tzinfo=timezone.utc)))
    assert done["status"] == "completed"
    assert len(fake.executed) == 1
    assert "status='completed'" in fake.executed[0]


@pytest.mark.parametrize("role,allowed", [
    ("student", True), ("owner", True),
    ("teacher", False), ("admin", False),
])
def test_plan_access_is_scoped_without_widening_other_student_endpoints(
        monkeypatch, role, allowed):
    async def identity(req, active=True):
        return {"id": "fixture", "role": role}

    monkeypatch.setattr(core, "current_user", identity)
    user, error = asyncio.run(plan_participant(object()))
    assert (error is None) is allowed
    if allowed:
        assert user["role"] == role
    else:
        assert error.status_code == 403


@pytest.mark.parametrize("value", [60, 0, -7, True, "7", [], None])
def test_invalid_duration_is_rejected_before_database_reads(monkeypatch, value):
    async def authenticated(*args, **kwargs):
        return {"id": "fixture", "role": "owner"}

    async def database_not_needed():
        raise AssertionError("invalid duration must be rejected before opening database")

    monkeypatch.setattr(core, "current_user", authenticated)
    monkeypatch.setattr(core, "pool", database_not_needed)
    with TestClient(core.app) as client:
        result = client.post("/api/study-plan/monthly/sequence/start",
                             json={"days": value})
    assert result.status_code == 400
    assert result.json()["error"] == "invalid_duration"


def test_production_asgi_dispatch_exposes_sequenced_plan_and_level_check(monkeypatch):
    """The deployed launcher dispatches study-plan URLs to browser, not core.app."""
    from app.asgi import application, browser

    paths = {route.path for route in browser.routes}
    assert "/api/study-plan/monthly/sequence" in paths
    assert "/api/study-plan/monthly/sequence/start" in paths
    assert "/api/study-plan/monthly/sequence/regenerate" in paths
    assert "/api/study-plan/monthly/sequence/level" in paths
    assert "/api/study-plan/monthly/sequence/level/start" in paths

    async def anonymous(*args, **kwargs):
        return None

    async def db_not_needed():
        raise AssertionError("Anonymous plan routes must never connect to the DB")

    monkeypatch.setattr(core, "current_user", anonymous)
    monkeypatch.setattr(core, "pool", db_not_needed)
    with TestClient(application, raise_server_exceptions=False) as client:
        for path in ("/api/study-plan/monthly/sequence",
                     "/api/study-plan/monthly/sequence/level"):
            result = client.get(path)
            assert result.status_code == 401, (path, result.text)
            assert result.json()["error"] == "unauthenticated"


@pytest.mark.parametrize("duration", [7, 30])
def test_overdue_plan_days_roll_forward_and_preserve_source_task_links(duration):
    class Fake:
        async def fetch(self, query, cycle_id):
            return [
                {"day_number": day, "slot": slot, "kind": kind,
                 "title": kind, "href": "/app/" + kind, "source_key": kind,
                 "minutes": minutes, "stage_index": 0 if slot == 0 else None,
                 "completed_at": None}
                for day in range(1, duration + 1)
                for slot, (kind, minutes) in enumerate((
                    ("grammar", 25), ("reading", 30), ("listening", 25),
                    ("writing", 20), ("speaking", 10), ("vocabulary", 10),
                ))
            ]

    cycle = {"id": "fixture", "status": "active", "current_day": 1,
             "timezone": "Asia/Tashkent", "user_id": "user",
             "cefr_level": "B2", "revision": 1, "duration_days": duration,
             "started_on": START}
    now = datetime(2026, 11, 16, 8, tzinfo=timezone.utc)
    plan = asyncio.run(_present(Fake(), cycle, now))
    assert plan["days"][0]["date"] == date(2026, 11, 16)
    assert plan["days"][0]["originalDate"] == START
    assert plan["days"][0]["rescheduled"] is True
    assert plan["days"][1]["date"] == date(2026, 11, 17)
    assert plan["days"][-1]["date"] == date(2026, 11, 16) + timedelta(days=duration-1)
    assert all(task["status"] == "ready" for task in plan["days"][0]["tasks"])
    assert all(task["href"] is None for day in plan["days"][1:] for task in day["tasks"])
    assert all(day["status"] == "locked" for day in plan["days"][1:])


def test_completed_days_keep_verified_dates_while_remaining_days_shift():
    class Fake:
        async def fetch(self, query, cycle_id):
            rows = []
            for day in range(1, 8):
                for slot, (kind, minutes) in enumerate((
                    ("grammar",25), ("reading",30), ("listening",25),
                    ("writing",20), ("speaking",10), ("vocabulary",10),
                )):
                    done = (datetime(2026, 11, 12 + day, 10, tzinfo=timezone.utc)
                            if day < 3 else None)
                    rows.append({"day_number": day, "slot": slot, "kind": kind,
                                 "title": kind, "href": "/app/" + kind,
                                 "source_key": kind, "minutes": minutes,
                                 "stage_index": 0 if slot == 0 else None,
                                 "completed_at": done})
            return rows

    cycle = {"id": "fixture", "status": "active", "current_day": 3,
             "timezone": "Asia/Tashkent", "started_on": START,
             "user_id": "user", "cefr_level": "B2", "revision": 1,
             "duration_days": 7}
    plan = asyncio.run(_present(Fake(), cycle,
                                datetime(2026, 11, 20, 8, tzinfo=timezone.utc)))
    assert [x["date"] for x in plan["days"][:4]] == [
        date(2026,11,13), date(2026,11,14),
        date(2026,11,20), date(2026,11,21),
    ]
    assert [x["status"] for x in plan["days"][:4]] == [
        "completed", "completed", "active", "locked"]
    assert plan["completedDays"] == 2
    assert all(x["status"] == "completed" for x in plan["days"][0]["tasks"])


def test_late_daily_completion_waits_until_the_following_real_calendar_day():
    class FakeConnection:
        def __init__(self):
            self.executed = []

        async def fetch(self, query, *args):
            return [{"kind": kind, "minutes": minutes,
                     "completed_at": datetime(2026, 11, 16, 10, tzinfo=timezone.utc)}
                    for kind, minutes in (
                        ("grammar",25), ("reading",30), ("listening",25),
                        ("writing",20), ("speaking",10), ("vocabulary",10))]

        async def fetchval(self, query, *args):
            if "max(completed_at)" in query:
                return datetime(2026, 11, 16, 10, tzinfo=timezone.utc)
            return 0

        async def execute(self, query, *args):
            self.executed.append(query)

    cycle = {"status": "active", "user_id": "user", "id": "cycle",
             "current_day": 1, "duration_days": 7,
             "started_on": START, "timezone": "Asia/Tashkent"}
    same_day = FakeConnection()
    outcome = asyncio.run(_sync(
        same_day, cycle, datetime(2026, 11, 16, 14, tzinfo=timezone.utc)))
    assert outcome["current_day"] == 1
    assert same_day.executed == []
    following = FakeConnection()
    opened = asyncio.run(_sync(
        following, cycle, datetime(2026, 11, 17, 8, tzinfo=timezone.utc)))
    assert opened["current_day"] == 2
    assert len(following.executed) == 1
