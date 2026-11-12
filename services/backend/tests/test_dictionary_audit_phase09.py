"""Frozen Phase 09 audit receipts and semantic change proposals."""
from __future__ import annotations

import json
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / "content" / "dictionary"
RELEASE = "rel-v1-1fa06d8d41d8ff701632573e"


def load(name: str) -> dict:
    return json.loads((BASE / name).read_text(encoding="utf-8"))


def test_phase09_frozen_scope_and_shards() -> None:
    source = load("audit-20261112-phase09-structural-receipt.json")
    assert source["phase"] == 9
    assert source["source_release"] == RELEASE
    assert source["scope"]["rank_start"] == 44165
    assert source["scope"]["rank_end"] == 49685
    assert source["counts"]["senses"] == 5521
    assert source["counts"]["lexemes"] == 3279
    shards = source["shards"]
    assert [s["shard"] for s in shards] == [f"{i:02x}" for i in range(101, 115)]
    assert sum(s["senses"] for s in shards) == 5521
    assert all(len(s["sha256"]) == 64 and s["compressed_bytes"] > 0 for s in shards)
    assert all(s["entry_members"] > 0 for s in shards)


def test_phase09_cefr_review_scope_exact() -> None:
    source = load("audit-20261112-phase09-structural-receipt.json")
    queue = load("audit-20261112-phase09-flagged-records.json")
    assert queue["source_release"] == RELEASE
    assert queue["phase"] == 9
    assert queue["stats"]["senses"] == 5521
    assert queue["stats"]["phaseEntries"] == 3279
    assert queue["stats"]["missingCefr"] == 459
    assert queue["stats"]["levels"]["C2"] == 2414
    assert sum(queue["stats"]["levels"].values()) + 459 == 5521
    assert len(queue["flagged"]) == 2873
    assert sum(row["cefr"] is None for row in queue["flagged"]) == 459
    assert sum(row["cefr"] == "C2" for row in queue["flagged"]) == 2414
    identities = {(r["lexeme_id"], r["sense_id"]) for r in queue["flagged"]}
    assert len(identities) == 2873
    for row in queue["flagged"]:
        UUID(row["lexeme_id"])
        UUID(row["sense_id"])
        assert row["definition_en"].strip()
        assert row["translation_uz"].strip()
        assert row["review_state"] == "pending_independent_source"


def test_phase09_presentation_hashes_and_links() -> None:
    report = load("audit-20261112-phase09-presentation-coverage.json")
    assert report["source_release"] == RELEASE
    assert report["phase"] == 9
    rows = report["by_shard"]
    assert [row["shard"] for row in rows] == [f"{i:02x}" for i in range(101, 115)]
    counts = report["counts"]
    for field in (
        "senses", "missing_presentation", "stale_meaning_sha",
        "presentation_synonyms", "presentation_collocations",
        "combined_synonyms", "combined_collocations",
        "canonical_synonyms", "canonical_collocations",
        "unscoped_polysemous_synonym_edges", "pronominal_synonyms"
    ):
        assert counts[field] == sum(row[field] for row in rows)
    assert counts["senses"] == 5521
    assert counts["missing_presentation"] == 36
    assert counts["stale_meaning_sha"] == 0
    assert counts["combined_synonyms"] == 3122
    assert counts["combined_collocations"] == 110
    assert counts["without_synonyms"] == 5521 - counts["combined_synonyms"]
    assert counts["without_collocations"] == 5521 - counts["combined_collocations"]
    assert counts["unscoped_polysemous_synonym_edges"] == 4474
    assert report["semantic_review_completed"] is False
    assert report["production_published"] is False


def test_phase09_editorial_proposals_remain_unpublished() -> None:
    report = load("audit-20261112-phase09-reviewed-corrections.json")
    assert report["source_release"] == RELEASE
    assert report["publication_state"] == "not_published"
    assert report["quality_gates"]["automated_mass_cefr_downgrade"] is False
    assert report["quality_gates"]["automatic_relation_invention"] is False
    assert report["quality_gates"]["production_changes"] is False
    itself = next(
        item for item in report["interventions"]
        if item["lemma"] == "itself"
    )
    assert itself["sense_id"] == "a09f14e9-8dde-5753-974e-67540f06f258"
    assert itself["cefr"]["original"] is None
    assert itself["cefr"]["proposed"] == "A2"
    assert itself["synonyms"]["proposed"] == []
    assert itself["cefr"]["evidence"].startswith("https://dictionary.cambridge.org/")
