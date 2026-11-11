"""Backend-only regression tests for the sequenced, level-aware 60-day plan."""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app import main as core
from app.study_plan_sixty import (
    DAYS, TARGET_MINUTES, eligible_grammar, eligible_to_open, level_range,
    make_sixty_day_schedule, normalize_level, read_grammar_catalog,
)
from app.study_plan_sixty_port import _event_kind

START = date(2026, 11, 12)


def test_profile_levels_are_explicit_and_not_inferred_from_a_target_band():
    assert normalize_level("b2") == "B2"
    assert normalize_level("upper-intermediate") == "B2"
    assert normalize_level("advanced") == "C1"
    assert normalize_level("beginner") == "A1"
    assert normalize_level("B2 / C1") is None
    assert normalize_level("IELTS 8") is None
    assert normalize_level(None) is None
    assert level_range("B2") == ("B2", "C1")
    assert level_range("C2") == ("C2",)
    with pytest.raises(ValueError, match="level_required"):
        level_range("unknown")


def test_existing_grammar_catalog_is_complete_and_has_working_route_types():
    catalog = read_grammar_catalog()
    assert len(catalog) == 277
    assert len({(row["source"], row["id"]) for row in catalog}) == 277
    assert sum(row["source"] == "legacy" for row in catalog) == 80
    assert sum(row["source"] == "speaking" for row in catalog) == 77
    assert sum(row["source"] == "writing" for row in catalog) == 120
    for row in catalog:
        if row["source"] == "legacy":
            assert row["href"].startswith("/app/grammar/lessons?book=")
        else:
            assert row["href"].startswith("/app/grammar?tab=")
        assert len(row["weights"]) == 4 and all(len(stage) == 3 for stage in row["weights"])


def test_b2_student_only_receives_b2_and_c1_and_all_three_grammar_tracks():
    catalog = read_grammar_catalog()
    approved = eligible_grammar("B2", catalog)
    assert len(approved) >= 15
    assert {unit["level"] for unit in approved} == {"B2", "C1"}
    assert {"legacy", "speaking", "writing"} <= {unit["source"] for unit in approved}


def test_sixty_day_schedule_has_reachable_links_stable_sequence_and_two_hour_budget():
    catalog = read_grammar_catalog()
    days = make_sixty_day_schedule("B2", START, catalog)
    assert len(days) == DAYS == 60
    assert days == make_sixty_day_schedule("B2", START, catalog)
    for index, day in enumerate(days):
        assert day["day"] == index + 1
        assert day["date"] == (START + timedelta(days=index)).isoformat()
        assert len(day["tasks"]) == 6
        assert sum(task.minutes for task in day["tasks"]) == TARGET_MINUTES == 120
        assert {task.kind for task in day["tasks"]} == {
            "grammar", "reading", "listening", "writing", "speaking", "vocabulary"
        }
        assert [task.slot for task in day["tasks"]] == list(range(6))
        assert all(task.href.startswith("/app/") for task in day["tasks"])
    for offset in range(0, DAYS, 4):
        stages = [days[offset + stage]["tasks"][0] for stage in range(4)]
        assert [task.stage for task in stages] == [0, 1, 2, 3]
        assert len({task.source_key.rsplit(":", 1)[0] for task in stages}) == 1
        assert all(len(task.blocks) == 3 for task in stages)


def test_unavailable_grammar_is_not_fabricated():
    with pytest.raises(ValueError, match="insufficient_grammar_content"):
        make_sixty_day_schedule("C2", START, [])


def test_strict_day_unlock_requires_previous_completed_and_next_date():
    assert eligible_to_open(1, START, START, False)
    assert not eligible_to_open(2, START, START, True)
    assert not eligible_to_open(2, START, START + timedelta(days=5), False)
    assert eligible_to_open(2, START, START + timedelta(days=5), True)
    assert not eligible_to_open(61, START, START + timedelta(days=70), True)


def test_event_proofs_only_accept_server_completed_module_activity():
    assert _event_kind("reading:exam") == "reading"
    assert _event_kind("reading-practice:passage") == "reading"
    assert _event_kind("listening:exam") == "listening"
    assert _event_kind("writing:submission") == "writing"
    assert _event_kind("speaking:attempt") == "speaking"
    assert _event_kind("vocab") == "vocabulary"
    assert _event_kind("grammar:unverified") is None
    assert _event_kind("page_view:abc") is None
    assert _event_kind("typing:run") is None


@pytest.mark.parametrize("path,verb", [
    ("/api/study-plan/sixty", "get"),
    ("/api/study-plan/sixty/start", "post"),
    ("/api/study-plan/sixty/regenerate", "post"),
    ("/api/study-plan/sixty/grammar/complete", "post"),
])
def test_sixty_day_api_rejects_anonymous_before_db(monkeypatch, path, verb):
    async def anonymous(*args, **kwargs):
        return None

    async def no_db():
        raise AssertionError("Anonymous calls must not reach the database")

    monkeypatch.setattr(core, "current_user", anonymous)
    monkeypatch.setattr(core, "pool", no_db)
    client = TestClient(core.app)
    result = getattr(client, verb)(path, json={} if verb == "post" else None)
    assert result.status_code == 401
