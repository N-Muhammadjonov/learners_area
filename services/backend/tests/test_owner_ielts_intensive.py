"""Owner-only IELTS intensive and public Vocabulary publication contracts."""
from datetime import date
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app import main as core
from app.study_plan_thirty import (
    OWNER_TARGET_MINUTES, TARGET_MINUTES, make_thirty_day_schedule,
)
from app.study_plan_materials import assign_owner_vocabulary
from app.vocabulary_packs_port import validate_public_pack

START = date(2026, 11, 22)


def test_owner_schedule_retains_all_six_verified_tasks_for_30_days():
    days = make_thirty_day_schedule("B2", START, intensive=True)
    assert len(days) == 30
    assert OWNER_TARGET_MINUTES == 300
    for day in days:
        tasks = {task.kind: task for task in day["tasks"]}
        assert len(tasks) == 6
        assert sum(task.minutes for task in tasks.values()) == OWNER_TARGET_MINUTES
        assert tasks["writing"].minutes >= 90
        assert tasks["speaking"].minutes >= 70
        assert tasks["vocabulary"].minutes == 25
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
        assert f"Topic {window % 11}" in first.title
        assert f"Topic {window % 11}" in second.title
        assert "Learn" in first.title and "Spaced recall" in second.title
        assert first.source_key == second.source_key == "vocab"
        assert first.href == second.href == "/app/vocabulary"
    assert assign_owner_vocabulary(plan, []) == plan


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
