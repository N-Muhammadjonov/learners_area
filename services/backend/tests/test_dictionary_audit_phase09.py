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


def test_phase09_cefr_edits_have_exact_sense_evidence() -> None:
    data = load("audit-20261112-phase09-reviewed-corrections.json")
    edits = data["source_verified_cefr_edits"]
    assert len(edits) == 16
    by_lemma = {row["lemma"]: row for row in edits}
    assert set(by_lemma) == {"itself", "nowadays", "cake", "hysterical", "demonstrate", "beep", "chatty", "bribe", "baguette", "caregiver", "annoyance", "brilliance", "blackberry"}
    assert (by_lemma["itself"]["original"], by_lemma["itself"]["proposed"]) == (None, "A2")
    assert (by_lemma["nowadays"]["original"], by_lemma["nowadays"]["proposed"]) == ("A2", "B1")
    assert (by_lemma["cake"]["original"], by_lemma["cake"]["proposed"]) == ("B1", "A1")
    assert (by_lemma["hysterical"]["original"], by_lemma["hysterical"]["proposed"]) == ("C2", "C1")
    assert (by_lemma["demonstrate"]["original"], by_lemma["demonstrate"]["proposed"]) == ("B1", "C1")
    assert (by_lemma["beep"]["original"], by_lemma["beep"]["proposed"]) == ("C2", "C1")
    assert sum(edit["lemma"] == "chatty" for edit in edits) == 2
    assert sum(edit["lemma"] == "annoyance" for edit in edits) == 2
    assert sum(edit["lemma"] == "brilliance" for edit in edits) == 2
    assert {edit["proposed"] for edit in edits if edit["lemma"] == "blackberry"} == {"C1"}
    assert {edit["proposed"] for edit in edits if edit["lemma"] in {"baguette"}} == {"B2"}
    assert {edit["proposed"] for edit in edits if edit["lemma"] in {"caregiver", "annoyance"}} == {"C1"}
    assert {edit["proposed"] for edit in edits if edit["lemma"] in {"chatty", "bribe"}} == {"C1"}
    assert len({edit["sense_id"] for edit in edits}) == len(edits)
    for edit in edits:
        UUID(edit["lexeme_id"])
        UUID(edit["sense_id"])
        assert edit["source"].startswith(("https://dictionary.cambridge.org/", "https://www.oxfordlearnersdictionaries.com/"))
        assert edit["scope"].strip()
        assert edit["proposed"] in {"A1", "A2", "B1", "B2", "C1", "C2"}
    assert data["publication_state"] == "not_published"


def test_phase09_exact_example_readback_receipt() -> None:
    report = load("audit-20261112-phase09-correction-receipt.json")
    assert report["phase"] == 9
    assert report["source_release"] == RELEASE
    assert report["scope"]["senses"] == 5521
    assert report["scope"]["examples_in_source"] == 4095
    checked = report["reviewed_integrity"]
    assert checked["r2_shards"] == 14
    assert checked["presentation_stale_hashes"] == 0
    assert checked["source_verified_example_replacements"] == 233
    assert checked["phase09_example_replacements"] == 225
    assert checked["out_of_phase_example_replacements"] == 8
    assert checked["source_readback_matched"] == 233
    assert checked["source_readback_failed"] == 0
    assert report["editorial_changes"]["cefr_source_verified_edits"] == 4
    assert report["editorial_changes"]["synonym_exclusions"] == 4
    assert report["editorial_changes"]["attested_collocation_phrases"] == 5
    assert report["signoff"]["all_5521_senses_semantically_certified"] is False
    assert report["signoff"]["all_4095_examples_linguistically_certified"] is False
    assert report["signoff"]["production_changed"] is False
    assert report["signoff"]["main_merged"] is False


def test_phase09_semantic_delta_matches_verified_r2_source() -> None:
    data = load("audit-20261112-phase09-semantic-delta.json")
    assert data["phase"] == 9
    assert data["source_release"] == RELEASE
    edits = data["edits"]
    assert edits == {
        "lexemes": 12,
        "senses": 18,
        "cefr_updates": 4,
        "english_definition_updates": 2,
        "uzbek_definition_updates": 2,
        "uzbek_translation_updates": 2,
        "removed_incorrect_synonym_edges": 19,
        "added_exact_synonym_edges": 1,
        "added_exact_antonym_edges": 9,
        "added_attested_collocations": 7,
    }
    source = data["integrity"]["original_r2_readback"]
    assert source["source_shards"] == ["65", "66", "67", "68"]
    assert source["lexemes"] == source["senses"] - 6 == 12
    assert source["meaning_sha_verified"] == 18
    assert source["cefr_original_matches"] == 4
    assert source["definition_original_matches"] == 2
    assert source["definition_uz_original_matches"] == 2
    assert source["translation_original_matches"] == 2
    assert source["canonical_synonym_exclusions_confirmed"] == 15
    assert source["presentation_only_synonym_exclusions_confirmed"] == 4
    assert source["missing_lexemes"] == 0
    assert source["unexpected_mismatches"] == 0
    assert data["integrity"]["examples_modified_in_this_pass"] is False
    dry = data["integrity"]["candidate_dry_run"]
    assert dry["entries"] == 12
    assert dry["patched_senses"] == 18
    assert dry["removed_canonical_relations"] == 15
    assert dry["added_scoped_relations"] == 10
    assert dry["added_scoped_collocations"] == 7
    assert dry["preserved_number_of_senses"] is True
    assert dry["preserved_examples"] is True
    assert dry["invalid_relation_source_ids"] == 0
    assert dry["invalid_collocation_source_ids"] == 0
    assert dry["errors"] == []
    assert data["limits"]["production_published"] is False
    assert data["limits"]["main_merged"] is False


def test_phase09_semantic_continuation_is_exact_source_verified() -> None:
    receipt = load("audit-20261112-phase09-semantic-continuation.json")
    assert receipt["phase"] == 9
    assert receipt["source_release"] == RELEASE
    assert receipt["scope"]["source_senses"] == 5521
    assert receipt["scope"]["source_lexemes"] == 3279
    deltas = receipt["editorial"]
    assert deltas["exact_lexeme_deltas"] == 31
    assert deltas["exact_sense_deltas"] == 49
    assert deltas["source_verified_cefr_edits"] == 16
    assert deltas["excluded_misattributed_senses_from_future_candidate"] == 4
    assert deltas["added_exact_synonym_edges"] == 20
    assert deltas["added_exact_antonym_edges"] == 10
    assert deltas["added_attested_collocations"] == 42
    source = receipt["r2_readback"]
    assert source["senses"] == source["meaning_sha_matched"] == 49
    assert source["cefr_originals_matched"] == 16
    assert source["excluded_glosses_matched"] == 4
    assert source["mismatches"] == 0
    assert source["missing_lexemes"] == 0
    assert receipt["graph_integrity"]["incoming_exact_synonym_edges_to_excluded_senses_in_phase09_shards"] == 8
    assert receipt["graph_integrity"]["example_texts_untouched"] is True
    assert receipt["publication"]["candidate_only"] is True
    assert receipt["publication"]["live_release_mutated"] is False
    assert receipt["publication"]["main_merged"] is False
    assert receipt["publication"]["full_linguistic_signoff"] is False
