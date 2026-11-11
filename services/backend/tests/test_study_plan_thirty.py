"""Contract and regression coverage for the 30-day sequential plan."""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app import main as core
from app.study_plan_thirty import (
    DAYS, TARGET_MINUTES, eligible_grammar, level_range,
    make_thirty_day_schedule, normalize_level, read_grammar_catalog,
)
from app.study_plan_thirty_port import _event_kind, _score_skill_stage, _skill_answer_bank

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
