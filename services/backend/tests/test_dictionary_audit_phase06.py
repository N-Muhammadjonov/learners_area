"""Phase 06 frozen dictionary audit receipts; no production writes."""
import json
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "content/dictionary/audit-20261112-phase06-flagged-records.json"
PRESENTATION = ROOT / "content/dictionary/audit-20261112-phase06-presentation-coverage.json"
RELEASE = "rel-v1-1fa06d8d41d8ff701632573e"


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_phase06_frozen_source_integrity():
    data = read(SOURCE)
    assert (data["schema"], data["phase"]) == (1, 6)
    assert data["source_release"] == RELEASE
    assert (data["rank_first"], data["rank_last"]) == (27604, 33123)
    assert data["first"] == "3f2003bb-0b6e-5938-a2cb-ee1cbae1979c/90bafdf3-d0c8-4ce4-bdd0-6e79a468c3b9"
    assert data["last"] == "4ba2d9e5-ebd2-5313-a245-e68416f58975/02f585f9-fedb-5e59-9a29-738f88ca170c"
    assert data["stats"]["senses"] == 5520
    assert data["stats"]["phaseEntries"] == 3204
    shards = data["checksums"]
    assert [s["shard"] for s in shards] == [f"{n:02x}" for n in range(63, 76)]
    assert [s["entries"] for s in shards] == [
        255, 263, 269, 261, 274, 260, 244, 252, 261, 224, 251, 246, 270
    ]
    assert all(len(s["sha256"]) == 64 and s["bytes"] > 0 for s in shards)


def test_phase06_review_queue_and_structural_invariants():
    audit = read(SOURCE)
    stats = audit["stats"]
    assert stats["missingCefr"] == 428
    assert stats["levels"]["C2"] == 2302
    assert sum(stats["levels"].values()) + stats["missingCefr"] == 5520
    for field in ("missingTranslation", "missingDefinitionEn", "missingDefinitionUz",
                  "invalidCefr", "invalidRelationSourceSense", "invalidCollocationSense",
                  "duplicateSourceSenseIds", "duplicateTranslations"):
        assert stats[field] == 0
    queue = audit["flagged"]
    assert len(queue) == 2730
    unique = {(r["lexeme_id"], r["sense_id"]) for r in queue}
    assert len(unique) == len(queue)
    assert sum(r["cefr"] is None for r in queue) == 428
    assert sum(r["cefr"] == "C2" for r in queue) == 2302
    for item in queue:
        UUID(item["lexeme_id"])
        UUID(item["sense_id"])
        assert item["lemma"].strip()
        assert item["definition_en"].strip()
        assert item["translation_uz"].strip()
        assert item["issues"]


def test_phase06_presentation_receipt_is_consistent_and_pending_signoff():
    report = read(PRESENTATION)
    assert (report["schema"], report["phase"], report["source_release"]) == (1, 6, RELEASE)
    rows = report["by_shard"]
    assert [r["shard"] for r in rows] == [f"{n:02x}" for n in range(63, 76)]
    assert sum(r["senses"] for r in rows) == 5520
    counts = report["counts"]
    for field in ("senses", "missing_presentation", "presentation_synonyms",
                  "presentation_collocations", "combined_synonyms", "combined_collocations",
                  "canonical_synonyms", "canonical_collocations"):
        assert counts[field] == sum(r[field] for r in rows)
    assert counts["missing_presentation"] == 51
    assert counts["combined_synonyms"] == 3176
    assert counts["combined_collocations"] == 168
    assert counts["without_synonyms"] == 5520 - counts["combined_synonyms"]
    assert counts["without_collocations"] == 5520 - counts["combined_collocations"]
    assert report["semantic_review_completed"] is False
    assert report["production_published"] is False
