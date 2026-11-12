"""Phase 08 frozen dictionary source and presentation receipts."""
import json
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "content/dictionary/audit-20261112-phase08-flagged-records.json"
PRESENTATION = ROOT / "content/dictionary/audit-20261112-phase08-presentation-coverage.json"
RELEASE = "rel-v1-1fa06d8d41d8ff701632573e"


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_phase08_source_integrity_and_frozen_boundaries():
    data = read(SOURCE)
    assert (data["schema"], data["phase"], data["source_release"]) == (1, 8, RELEASE)
    assert (data["rank_first"], data["rank_last"]) == (38645, 44164)
    assert data["first"] == "587f006c-30fa-5372-aacc-f577bd3f9295/43fdffbb-2041-5836-8503-7ea6f34e3376"
    assert data["last"] == "65686d9c-513c-5b56-9cc9-ee1a84c1c2b0/a5dc681d-f18e-5074-b1a1-a3d46d9ef606"
    assert data["stats"]["senses"] == 5520
    assert data["stats"]["phaseEntries"] == 3304
    shards = data["checksums"]
    assert [r["shard"] for r in shards] == [f"{i:02x}" for i in range(88, 102)]
    assert [r["entries"] for r in shards] == [
        241, 281, 274, 243, 230, 243, 264, 264, 264, 252, 246, 262, 250, 256
    ]
    assert all(len(r["sha256"]) == 64 and r["bytes"] > 0 for r in shards)


def test_phase08_cefr_queue_and_structural_validity():
    data = read(SOURCE)
    stats = data["stats"]
    assert stats["missingCefr"] == 456
    assert stats["levels"]["C2"] == 2386
    assert sum(stats["levels"].values()) + stats["missingCefr"] == 5520
    for field in ("missingTranslation", "missingDefinitionEn", "missingDefinitionUz",
                  "invalidCefr", "invalidRelationSourceSense", "invalidCollocationSense",
                  "duplicateSourceSenseIds", "duplicateTranslations"):
        assert stats[field] == 0
    records = data["flagged"]
    assert len(records) == 2842
    keys = {(row["lexeme_id"], row["sense_id"]) for row in records}
    assert len(keys) == len(records)
    assert sum(row["cefr"] is None for row in records) == 456
    assert sum(row["cefr"] == "C2" for row in records) == 2386
    for row in records:
        UUID(row["lexeme_id"])
        UUID(row["sense_id"])
        assert row["lemma"].strip()
        assert row["definition_en"].strip()
        assert row["translation_uz"].strip()
        assert row["issues"]


def test_phase08_presentation_and_meaning_hash_coverage():
    report = read(PRESENTATION)
    assert (report["schema"], report["phase"], report["source_release"]) == (1, 8, RELEASE)
    rows = report["by_shard"]
    assert [row["shard"] for row in rows] == [f"{i:02x}" for i in range(88, 102)]
    totals = report["counts"]
    for field in ("senses", "missing_presentation", "presentation_synonyms",
                  "presentation_collocations", "combined_synonyms", "combined_collocations",
                  "canonical_synonyms", "canonical_collocations", "stale_meaning_sha"):
        assert totals[field] == sum(row[field] for row in rows)
    assert totals["senses"] == 5520
    assert totals["missing_presentation"] == 48
    assert totals["stale_meaning_sha"] == 0
    assert totals["combined_synonyms"] == 3040
    assert totals["combined_collocations"] == 154
    assert totals["without_synonyms"] == 5520 - totals["combined_synonyms"]
    assert totals["without_collocations"] == 5520 - totals["combined_collocations"]
    assert report["semantic_review_completed"] is False
    assert report["production_published"] is False
