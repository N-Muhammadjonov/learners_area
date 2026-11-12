"""Phase 09 lexical correction tests; never publish or alter active R2."""
from __future__ import annotations

import copy
from uuid import UUID

import pytest

from app.dictionary_sense_curation import (
    curate_candidate_entry,
    load_corrections,
    original_meaning_hash,
)

RELEASE = "rel-v1-1fa06d8d41d8ff701632573e"


def entry(
    lexeme_id: str,
    lemma: str,
    part_of_speech: str,
    senses: list[tuple[str, str, str, str | None]],
    relations: list[dict] | None = None,
) -> dict:
    return {
        "release_id": RELEASE,
        "lexeme_id": lexeme_id,
        "display_lemma": lemma,
        "part_of_speech": part_of_speech,
        "senses": [
            {
                "sense_id": sid,
                "definition_en": definition,
                "translations": [{"text": translation, "order": 0}],
                **({"cefr": cefr} if cefr is not None else {}),
                "examples": [],
            }
            for sid, definition, translation, cefr in senses
        ],
        "relations": relations or [],
        "collocations": [],
    }


def test_replacement_of_mistranslated_specialist_terms_is_exact_and_immutable() -> None:
    terzetto = entry(
        "670b7b89-7e98-59f2-a02f-890028ec5165",
        "terzetto",
        "n",
        [(
            "aad9fee0-fbbc-5565-92ef-858166eb4920",
            "the cardinal number that is the sum of one and one and one",
            "uch",
            None,
        )],
        [{
            "relation_type": "synonym",
            "display_lemma": "three",
            "target_lexeme_id": "c343f3d2-5553-5418-8d63-2678f40831a5",
            "target_sense_id": "2ced960e-58db-498d-a92c-42dd6982aeaf",
        }],
    )
    original = copy.deepcopy(terzetto)
    updated = curate_candidate_entry(terzetto)
    assert original_meaning_hash(original, original["senses"][0]) == (
        "a255e654f2214077518764e1fd4af8ab29b0a4a4414ed8e678e7c1b1e17fdc2a"
    )
    assert updated["senses"][0]["definition_en"] == (
        "a musical composition for three voices, or a vocal trio"
    )
    assert updated["senses"][0]["translations"][0]["text"].startswith("tersetto")
    assert updated["senses"][0].get("cefr") is None
    assert [(r["display_lemma"], r["target_sense_id"]) for r in updated["relations"]] == [
        ("trio", "24087232-6200-4e00-98d9-3212c842bf3b")
    ]
    assert terzetto == original

    actus = entry(
        "660bb696-af24-52eb-bb78-ed1c4a74a1e3",
        "actus reus",
        "n",
        [(
            "9dc9e4dd-a4dc-5068-8541-654b596fc748",
            "activity that transgresses moral or civil law",
            "huquqbuzarlik harakati",
            "C2",
        )],
    )
    updated_actus = curate_candidate_entry(actus)
    assert "physical element of a criminal offence" in updated_actus["senses"][0]["definition_en"]
    assert "harakatsizlik" in updated_actus["senses"][0]["translations"][0]["text"]
    assert updated_actus["senses"][0]["cefr"] == "C2"
    assert actus["senses"][0]["definition_en"] != updated_actus["senses"][0]["definition_en"]


def test_cefr_changes_are_sense_specific_without_blanket_null_fills() -> None:
    cake = entry(
        "65a67e1f-758a-5461-a706-e2e07dbdeff6",
        "cake",
        "n",
        [
            (
                "4d245a0c-9a49-457b-a9e5-6a3d045caac1",
                "food made from or based on a mixture of flour, sugar, eggs, and fat, typically cooked in an oven",
                "tort",
                "B1",
            ),
            (
                "8e641b23-55e5-4511-ab1d-e0433df0c93d",
                "a block of solid substance (such as soap or wax)",
                "sovun yoki mum bo‘lagi",
                "A2",
            ),
        ],
    )
    original = copy.deepcopy(cake)
    result = curate_candidate_entry(cake)
    assert [s["cefr"] for s in result["senses"]] == ["A1", "A2"]
    assert cake == original
    assert {row["sense_id"] for row in result["collocations"]} == {
        "4d245a0c-9a49-457b-a9e5-6a3d045caac1"
    }
    assert {row["text"] for row in result["collocations"]} == {
        "birthday cake",
        "chocolate cake",
    }

    itself = entry(
        "657d05d9-7940-5fe6-9e0d-13f5f665a19e",
        "itself",
        "pronoun",
        [(
            "a09f14e9-8dde-5753-974e-67540f06f258",
            "Refers back to the same subject.",
            "o‘zi; o‘zini (narsa yoki hayvon)",
            None,
        )],
    )
    assert curate_candidate_entry(itself)["senses"][0]["cefr"] == "A2"
    assert "cefr" not in itself["senses"][0]


def test_exact_antonyms_are_scoped_to_the_meaning() -> None:
    decry = entry(
        "65a09564-3f7a-57c4-87c3-b49a18a891c5",
        "decry",
        "v",
        [(
            "e5759095-9273-503f-a480-76eef49235a3",
            "express strong disapproval of",
            "qattiq qoralamoq",
            "C2",
        )],
    )
    result = curate_candidate_entry(decry)
    relation = result["relations"][0]
    assert relation["relation_type"] == "antonym"
    assert relation["display_lemma"] == "praise"
    assert relation["part_of_speech"] == "v"
    assert relation["source_sense_id"] == decry["senses"][0]["sense_id"]
    assert relation["target_sense_id"] == "4045aec2-5b1d-438d-a03c-f86296e73b72"
    assert decry["relations"] == []

    deflate = entry(
        "68081d76-e460-519a-9ded-28b8bbb621a5",
        "deflate",
        "v",
        [
            (
                "54ed6100-67bf-4b1c-8fd8-2ea7a7aea8de",
                "release contained air or gas from",
                "havosini chiqarmoq",
                "C2",
            ),
            (
                "17b8964d-d13f-5fed-828f-b4858b0eac26",
                "become deflated or flaccid, as by losing air",
                "havosi chiqmoq",
                "C2",
            ),
        ],
    )
    result = curate_candidate_entry(deflate)
    assert len(result["relations"]) == 2
    mapping = {r["source_sense_id"]: r["target_sense_id"] for r in result["relations"]}
    assert mapping["54ed6100-67bf-4b1c-8fd8-2ea7a7aea8de"] == (
        "433a08d2-fbf7-4e12-b223-dad63d3aa205"
    )
    assert mapping["17b8964d-d13f-5fed-828f-b4858b0eac26"] == (
        "d0068dd8-15b1-4f59-ab68-b1ebc2427ea5"
    )


def test_stale_semantics_cannot_silently_modify_entries() -> None:
    original = entry(
        "670b7b89-7e98-59f2-a02f-890028ec5165",
        "terzetto",
        "n",
        [(
            "aad9fee0-fbbc-5565-92ef-858166eb4920",
            "the cardinal number that is the sum of one and one and one",
            "uch",
            None,
        )],
    )
    bad = copy.deepcopy(original)
    bad["senses"][0]["definition_en"] = "already editorially changed"
    with pytest.raises(ValueError, match="meaning_sha_mismatch"):
        curate_candidate_entry(bad)

    bad = copy.deepcopy(original)
    bad["senses"][0]["translations"][0]["text"] = "other translation"
    with pytest.raises(ValueError, match="source_mismatch"):
        curate_candidate_entry(bad)

    other_release = {**original, "release_id": "unrelated-release"}
    assert curate_candidate_entry(other_release) == other_release


def test_every_correction_links_to_uuid_and_has_exact_meaning_hash() -> None:
    data = load_corrections()
    assert data["source_release"] == RELEASE
    assert len(data["entries"]) >= 10
    for lexeme_id, senses in data["entries"].items():
        UUID(lexeme_id)
        for sense_id, correction in senses.items():
            UUID(sense_id)
            assert len(correction["meaning_sha"]) == 64
            for kind in ("add_synonyms", "add_antonyms"):
                for relation in correction.get(kind, []):
                    UUID(relation["lexemeId"])
                    UUID(relation["senseId"])
                    assert relation["partOfSpeech"] in {"n", "v", "a", "r"}
                    assert relation["source"].startswith("https://")
            for relation in correction.get("add_collocations", []):
                assert relation["text"].strip()
                assert relation["source"].startswith("https://")
