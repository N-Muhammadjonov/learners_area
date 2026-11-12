"""Phase-02 immutable dictionary audit receipt checks, without production writes."""
import json
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[3]
FLAGS = ROOT / "content/dictionary/audit-20261112-phase02-flagged-records.json"
PRESENTATION = ROOT / "content/dictionary/audit-20261112-phase02-presentation-coverage.json"
RELEASE = "rel-v1-1fa06d8d41d8ff701632573e"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_phase02_frozen_source_boundary_and_counts():
    data = load(FLAGS)
    assert data["schema"] == 1 and data["phase"] == 2
    assert data["source_release"] == RELEASE
    assert data["rank_first"] == 5522 and data["rank_last"] == 11041
    assert data["first"] == "0ca8f62d-84ca-5d83-a276-8ff8477c0888/9870a7a9-c521-4713-a09c-b51d45c670b1"
    assert data["last"] == "18f0e448-7b84-55ae-a190-c5b3c44ba1f3/e7e72f4b-07ac-43cf-9aca-e64addeab2d7"
    assert data["stats"]["senses"] == 5520
    assert data["stats"]["uniquePhaseEntries"] == 3222
    assert data["stats"]["missingCefr"] == 461
    assert data["stats"]["levels"]["C2"] == 2334
    assert sum(data["stats"]["levels"].values()) + data["stats"]["missingCefr"] == 5520
    assert data["stats"]["missingTranslation"] == 0
    assert data["stats"]["invalidCefr"] == 0
    assert data["stats"]["invalidRelationSourceSense"] == 0
    assert data["stats"]["invalidCollocationSense"] == 0
    assert data["stats"]["duplicateSourceSenseIds"] == 0


def test_phase02_provenance_hashes_and_review_queue_unique():
    data = load(FLAGS)
    shards = data["checksums"]
    assert [v["shard"] for v in shards] == [f"{i:02x}" for i in range(12, 25)]
    assert [v["entries"] for v in shards] == [295, 260, 248, 287, 281, 256, 254, 266, 255, 273, 258, 244, 245]
    assert all(len(v["sha256"]) == 64 for v in shards)
    queued = data["flagged"]
    assert len(queued) == 2795
    ids = {(x["lexeme_id"], x["sense_id"]) for x in queued}
    assert len(ids) == len(queued)
    assert sum(x["cefr"] is None for x in queued) == 461
    assert sum(x["cefr"] == "C2" for x in queued) == 2334
    for row in queued:
        UUID(row["lexeme_id"])
        UUID(row["sense_id"])
        assert row["definition_en"].strip()
        assert row["translation_uz"].strip()
        assert row["issues"]


def test_phase02_presentation_scope_and_independent_totals():
    data = load(PRESENTATION)
    assert data["source_release"] == RELEASE
    assert data["phase"] == 2 and data["schema"] == 1
    assert len(data["by_shard"]) == 13
    assert sum(x["senses"] for x in data["by_shard"]) == 5520
    counts = data["counts"]
    fields = {
        "missing_presentation_sense_rows": "missing_presentation",
        "presentation_synonym_senses": "presentation_synonym_senses",
        "presentation_collocation_senses": "presentation_collocation_senses",
        "combined_synonym_senses": "combined_synonym_senses",
        "combined_collocation_senses": "combined_collocation_senses",
    }
    for field, key in fields.items():
        assert counts[field] == sum(x[key] for x in data["by_shard"])
    assert counts["without_synonyms"] == 5520 - counts["combined_synonym_senses"]
    assert counts["without_collocations"] == 5520 - counts["combined_collocation_senses"]
    assert data["semantic_review_completed"] is False
    assert data["production_published"] is False
