"""Frozen production dictionary audit receipts, validated without live credentials."""
import json
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[3]
AUDIT = ROOT / "content" / "dictionary" / "audit-20261112-phase01-flagged-records.json"
PROPOSALS = ROOT / "content" / "dictionary" / "audit-20261112-phase01-proposals.json"
RELEASE = "rel-v1-1fa06d8d41d8ff701632573e"
PHASE_START = "0002bc35-2330-48c7-94a9-586795f6dd47/7dfa47a0-83db-4f2c-8758-cd8f3d57da61"
PHASE_END = "0ca8f62d-84ca-5d83-a276-8ff8477c0888/25ab56d1-774c-4a97-8b18-801e9d3a9519"


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_phase01_source_provenance_and_frozen_boundaries():
    data = _read(AUDIT)
    assert data["schema"] == 1
    assert data["phase"] == 1
    assert data["source_release"] == RELEASE
    assert data["records"] == 5521
    assert data["first"] == PHASE_START
    assert data["last"] == PHASE_END
    shards = data["checksums"]
    assert [s["shard"] for s in shards] == [f"{i:02x}" for i in range(13)]
    assert [s["entries"] for s in shards] == [
        252, 259, 251, 256, 288, 276, 288, 250, 217, 264, 257, 255, 295
    ]
    assert all(len(s["sha256"]) == 64 for s in shards)


def test_flagged_review_queue_has_unique_exact_senses():
    data = _read(AUDIT)
    missing = data["missing_cefr"]
    review = data["needs_c2_level_review"]
    assert len(missing) == 436
    assert len(review) == 2377
    missing_ids = {(r["lexeme_id"], r["sense_id"]) for r in missing}
    review_ids = {(r["lexeme_id"], r["sense_id"]) for r in review}
    assert len(missing_ids) == len(missing)
    assert len(review_ids) == len(review)
    assert not missing_ids & review_ids
    for record in missing + review:
        UUID(record["lexeme_id"])
        UUID(record["sense_id"])
        assert record["lemma"].strip()
        assert record["definition_en"].strip()
    assert all(r["reason"] == "cefr_unassigned" for r in missing)
    assert all(r["reason"] == "cefr_C2_review_not_automatic_error" for r in review)


def test_proposals_are_source_qualified_and_not_accidentally_published():
    data = _read(PROPOSALS)
    assert data["source_release"] == RELEASE
    keys = set()
    for change in data["changes"]:
        key = (change["lexeme_id"], change["sense_id"], change["field"])
        assert key not in keys
        keys.add(key)
        UUID(change["lexeme_id"])
        UUID(change["sense_id"])
        assert change["source_urls"]
        assert change["production_applied"] is False
        assert change["before"] != change["proposed"]
    assert ("020757cc-ce98-5cdd-b24a-4f53d9e4171a",
            "b4977bce-739a-59e9-b6f8-252cc1e6ac07", "cefr") in keys
