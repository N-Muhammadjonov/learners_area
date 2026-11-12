"""Phase 05 frozen dictionary source and presentation audit regression."""
import json
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "content/dictionary/audit-20261112-phase05-flagged-records.json"
PRESENTATION = ROOT / "content/dictionary/audit-20261112-phase05-presentation-coverage.json"
RELEASE = "rel-v1-1fa06d8d41d8ff701632573e"


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_phase05_frozen_source_integrity():
    data = read(SOURCE)
    assert (data["schema"], data["phase"]) == (1, 5)
    assert data["source_release"] == RELEASE
    assert (data["rank_first"], data["rank_last"]) == (22083, 27603)
    assert data["first"] == "329dc7e9-b414-514a-8863-68431a0465ea/33fba906-c035-4212-b171-ce72dfe32bb6"
    assert data["last"] == "3f1fc4c2-d8eb-5215-b55e-65d411a89d3a/fa6db6c5-35d6-4090-b1a1-dfcf9a616b34"
    assert data["stats"]["senses"] == 5521
    assert data["stats"]["phaseEntries"] == 3176
    rows = data["checksums"]
    assert [x["shard"] for x in rows] == [f"{i:02x}" for i in range(50, 64)]
    assert [x["entries"] for x in rows] == [246, 251, 237, 255, 240, 254, 268, 236, 291, 237, 263, 263, 238, 255]
    assert all(len(x["sha256"]) == 64 and x["bytes"] > 0 for x in rows)


def test_phase05_cefr_flags_and_structural_invariants():
    data = read(SOURCE)
    s = data["stats"]
    assert s["missingCefr"] == 463
    assert s["levels"]["C2"] == 2269
    assert sum(s["levels"].values()) + s["missingCefr"] == 5521
    for name in ("missingTranslation", "missingDefinitionEn", "missingDefinitionUz",
                 "invalidCefr", "invalidRelationSourceSense", "invalidCollocationSense",
                 "duplicateSourceSenseIds", "duplicateTranslations"):
        assert s[name] == 0
    flags = data["flagged"]
    assert len(flags) == 2732
    identities = {(f["lexeme_id"], f["sense_id"]) for f in flags}
    assert len(identities) == len(flags)
    assert sum(f["cefr"] is None for f in flags) == 463
    assert sum(f["cefr"] == "C2" for f in flags) == 2269
    for record in flags:
        UUID(record["lexeme_id"])
        UUID(record["sense_id"])
        assert record["lemma"].strip() and record["definition_en"].strip()
        assert record["translation_uz"].strip() and record["issues"]


def test_phase05_presentation_coverage_and_signoff_gate():
    data = read(PRESENTATION)
    assert (data["schema"], data["phase"], data["source_release"]) == (1, 5, RELEASE)
    records = data["by_shard"]
    assert [r["shard"] for r in records] == [f"{i:02x}" for i in range(50, 64)]
    assert sum(r["senses"] for r in records) == 5521
    counts = data["counts"]
    for field in ("senses", "missing_presentation", "presentation_synonyms",
                  "presentation_collocations", "combined_synonyms", "combined_collocations",
                  "canonical_synonyms", "canonical_collocations"):
        assert counts[field] == sum(r[field] for r in records)
    assert counts["missing_presentation"] == 57
    assert counts["combined_synonyms"] == 3042
    assert counts["combined_collocations"] == 179
    assert counts["without_synonyms"] == 5521 - counts["combined_synonyms"]
    assert counts["without_collocations"] == 5521 - counts["combined_collocations"]
    assert data["semantic_review_completed"] is False
    assert data["production_published"] is False
