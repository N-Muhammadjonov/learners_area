"""Phase-04 dictionary audit receipts; read-only, deterministic QA."""
import json
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "content/dictionary/audit-20261112-phase04-flagged-records.json"
PRESENTATION = ROOT / "content/dictionary/audit-20261112-phase04-presentation-coverage.json"
RELEASE = "rel-v1-1fa06d8d41d8ff701632573e"
FIRST = "25fca45a-601e-5b98-b17f-fd9bef012da0/f381fcb1-d76b-46a3-a262-ece299b45b43"
LAST = "329dc7e9-b414-514a-8863-68431a0465ea/2d22652c-cb5e-4e09-b1ab-185e4e293aaa"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_phase04_source_integrity_and_boundaries():
    audit = load(SOURCE)
    assert audit["schema"] == 1 and audit["phase"] == 4
    assert audit["source_release"] == RELEASE
    assert (audit["rank_first"], audit["rank_last"]) == (16563, 22082)
    assert (audit["first"], audit["last"]) == (FIRST, LAST)
    assert audit["stats"]["senses"] == 5520
    assert audit["stats"]["phaseEntries"] == 3322
    shards = audit["checksums"]
    assert [row["shard"] for row in shards] == [f"{n:02x}" for n in range(37, 51)]
    assert [row["entries"] for row in shards] == [
        235, 268, 268, 279, 266, 250, 254, 267, 268, 272, 260, 271, 261, 246
    ]
    assert all(len(row["sha256"]) == 64 and row["bytes"] > 0 for row in shards)


def test_phase04_review_queue_is_exact_and_has_no_mass_cefr_assumptions():
    audit = load(SOURCE)
    stats = audit["stats"]
    assert stats["missingCefr"] == 456
    assert stats["levels"]["C2"] == 2393
    assert sum(stats["levels"].values()) + stats["missingCefr"] == 5520
    for name in ("missingTranslation", "missingDefinitionEn", "missingDefinitionUz",
                 "invalidCefr", "invalidRelationSourceSense", "invalidCollocationSense",
                 "duplicateSourceSenseIds", "duplicateTranslations"):
        assert stats[name] == 0
    records = audit["flagged"]
    assert len(records) == 2849
    identities = {(r["lexeme_id"], r["sense_id"]) for r in records}
    assert len(identities) == len(records)
    assert sum(r["cefr"] is None for r in records) == 456
    assert sum(r["cefr"] == "C2" for r in records) == 2393
    for record in records:
        UUID(record["lexeme_id"])
        UUID(record["sense_id"])
        assert record["lemma"] and record["definition_en"] and record["translation_uz"]
        assert record["issues"]


def test_phase04_presentation_receipt_coverage_and_pending_signoff():
    data = load(PRESENTATION)
    assert data["phase"] == 4 and data["source_release"] == RELEASE
    rows = data["by_shard"]
    assert [row["shard"] for row in rows] == [f"{n:02x}" for n in range(37, 51)]
    assert sum(row["senses"] for row in rows) == 5520
    totals = data["counts"]
    for field in ("senses", "missing_presentation", "presentation_synonyms",
                  "presentation_collocations", "combined_synonyms", "combined_collocations",
                  "canonical_synonyms", "canonical_collocations"):
        assert totals[field] == sum(row[field] for row in rows)
    assert totals["missing_presentation"] == 42
    assert totals["combined_synonyms"] == 3077
    assert totals["combined_collocations"] == 157
    assert totals["without_synonyms"] == 5520 - totals["combined_synonyms"]
    assert totals["without_collocations"] == 5520 - totals["combined_collocations"]
    assert data["semantic_review_completed"] is False
    assert data["production_published"] is False
