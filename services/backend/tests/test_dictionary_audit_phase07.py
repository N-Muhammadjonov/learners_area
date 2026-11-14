"""Frozen phase-seven dictionary audit receipt checks, without production writes."""
import json
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "content/dictionary/audit-20261112-phase07-flagged-records.json"
PRESENTATION = ROOT / "content/dictionary/audit-20261112-phase07-presentation-coverage.json"
RELEASE = "rel-v1-1fa06d8d41d8ff701632573e"


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_phase07_source_receipt_and_immutable_boundaries():
    source = read(SOURCE)
    assert (source["schema"], source["phase"], source["source_release"]) == (1, 7, RELEASE)
    assert (source["rank_first"], source["rank_last"]) == (33124, 38644)
    assert source["first"] == "4ba2d9e5-ebd2-5313-a245-e68416f58975/15cf27b8-bdf9-4a46-bf49-aaf80b7b8fcb"
    assert source["last"] == "587ecb96-74e6-58b7-a2e6-c1b58eeaccb6/fd52d057-3dbd-530a-bafe-7186bfc85153"
    assert source["stats"]["senses"] == 5521
    assert source["stats"]["phaseEntries"] == 3251
    shards = source["checksums"]
    assert [r["shard"] for r in shards] == [f"{i:02x}" for i in range(75, 89)]
    assert [r["entries"] for r in shards] == [
        270, 231, 266, 257, 224, 255, 282, 262, 245, 227, 276, 254, 260, 241
    ]
    assert all(len(r["sha256"]) == 64 and r["bytes"] > 0 for r in shards)


def test_phase07_review_queue_is_exact_and_structurally_valid():
    source = read(SOURCE)
    stats = source["stats"]
    assert stats["missingCefr"] == 460
    assert stats["levels"]["C2"] == 2280
    assert sum(stats["levels"].values()) + stats["missingCefr"] == 5521
    for key in ("missingTranslation", "missingDefinitionEn", "missingDefinitionUz",
                "invalidCefr", "invalidRelationSourceSense", "invalidCollocationSense",
                "duplicateSourceSenseIds", "duplicateTranslations"):
        assert stats[key] == 0
    flagged = source["flagged"]
    assert len(flagged) == 2740
    keys = {(r["lexeme_id"], r["sense_id"]) for r in flagged}
    assert len(keys) == len(flagged)
    assert sum(r["cefr"] is None for r in flagged) == 460
    assert sum(r["cefr"] == "C2" for r in flagged) == 2280
    for row in flagged:
        UUID(row["lexeme_id"])
        UUID(row["sense_id"])
        assert row["lemma"].strip()
        assert row["definition_en"].strip()
        assert row["translation_uz"].strip()
        assert row["issues"]


def test_phase07_presentation_coverage_and_meaning_hash_integrity():
    data = read(PRESENTATION)
    assert (data["schema"], data["phase"], data["source_release"]) == (1, 7, RELEASE)
    rows = data["by_shard"]
    assert [r["shard"] for r in rows] == [f"{i:02x}" for i in range(75, 89)]
    counts = data["counts"]
    for key in ("senses", "missing_presentation", "presentation_synonyms",
                "presentation_collocations", "combined_synonyms", "combined_collocations",
                "canonical_synonyms", "canonical_collocations", "stale_meaning_sha"):
        assert counts[key] == sum(r[key] for r in rows)
    assert counts["senses"] == 5521
    assert counts["missing_presentation"] == 64
    assert counts["combined_synonyms"] == 3078
    assert counts["combined_collocations"] == 164
    assert counts["stale_meaning_sha"] == 0
    assert counts["without_synonyms"] == 5521 - counts["combined_synonyms"]
    assert counts["without_collocations"] == 5521 - counts["combined_collocations"]
    assert data["semantic_review_completed"] is False
    assert data["production_published"] is False
