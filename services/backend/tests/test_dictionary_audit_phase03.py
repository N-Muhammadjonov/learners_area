"""Phase-03 frozen Dictionary QA receipts (no network or production mutations)."""
import json
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "content/dictionary/audit-20261112-phase03-flagged-records.json"
PRESENTATION = ROOT / "content/dictionary/audit-20261112-phase03-presentation-coverage.json"
RELEASE = "rel-v1-1fa06d8d41d8ff701632573e"
LOWER = "18f4667e-c981-50c0-9d3f-b326809e8125/40032209-2653-4b19-b802-114c2aa9112c"
UPPER = "25fca45a-601e-5b98-b17f-fd9bef012da0/ed254d73-34c8-41ea-a247-126043257211"


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_phase03_immutable_source_and_exact_boundaries():
    audit = read(SOURCE)
    assert audit["schema"] == 1
    assert audit["phase"] == 3
    assert audit["source_release"] == RELEASE
    assert (audit["rank_first"], audit["rank_last"]) == (11042, 16562)
    assert (audit["first"], audit["last"]) == (LOWER, UPPER)
    assert audit["stats"]["senses"] == 5521
    assert audit["stats"]["phaseEntries"] == 3343
    shards = audit["checksums"]
    assert [row["shard"] for row in shards] == [f"{n:02x}" for n in range(24, 38)]
    assert [row["entries"] for row in shards] == [
        245, 243, 229, 257, 275, 251, 246, 277, 283, 257, 236, 283, 259, 235
    ]
    assert all(len(row["sha256"]) == 64 and row["bytes"] > 0 for row in shards)


def test_phase03_cefr_review_queue_and_no_silent_corrections():
    audit = read(SOURCE)
    stats = audit["stats"]
    assert stats["missingCefr"] == 444
    assert stats["levels"]["C2"] == 2450
    assert sum(stats["levels"].values()) + stats["missingCefr"] == 5521
    assert stats["emptyTranslations"] == 0
    assert stats["invalidCefr"] == 0
    assert stats["invalidRelationSourceSense"] == 0
    assert stats["invalidCollocationSense"] == 0
    assert stats["duplicateSourceSenseIds"] == 0
    flagged = audit["flagged"]
    assert len(flagged) == 2894
    ids = {(row["lexeme_id"], row["sense_id"]) for row in flagged}
    assert len(ids) == len(flagged)
    assert sum(row["cefr"] is None for row in flagged) == 444
    assert sum(row["cefr"] == "C2" for row in flagged) == 2450
    for row in flagged:
        UUID(row["lexeme_id"])
        UUID(row["sense_id"])
        assert row["definition_en"].strip() and row["translation_uz"].strip()
        assert row["issues"]


def test_phase03_presentation_coverage_totals_and_signoff_guard():
    audit = read(PRESENTATION)
    assert audit["schema"] == 1
    assert audit["phase"] == 3
    assert audit["source_release"] == RELEASE
    rows = audit["by_shard"]
    assert [row["shard"] for row in rows] == [f"{n:02x}" for n in range(24, 38)]
    assert sum(row["senses"] for row in rows) == 5521
    totals = audit["counts"]
    for key in (
        "senses",
        "missing_presentation",
        "presentation_synonyms",
        "presentation_collocations",
        "combined_synonyms",
        "combined_collocations",
        "canonical_synonyms",
        "canonical_collocations",
    ):
        assert totals[key] == sum(row[key] for row in rows)
    assert totals["without_synonyms"] == 5521 - totals["combined_synonyms"]
    assert totals["without_collocations"] == 5521 - totals["combined_collocations"]
    assert totals["missing_presentation"] == 33
    assert totals["combined_synonyms"] == 3059
    assert totals["combined_collocations"] == 118
    assert audit["semantic_review_completed"] is False
    assert audit["production_published"] is False
