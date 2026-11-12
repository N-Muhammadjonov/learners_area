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
    definition_uz_by_sense: dict[str, str] | None = None,
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
                "definition_uz": (definition_uz_by_sense or {}).get(sid, "Default definition."),
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
        definition_uz_by_sense={
            "aad9fee0-fbbc-5565-92ef-858166eb4920": "Birga qo'shilgan bir va bir va birga teng natural son.",
        },
    )
    original = copy.deepcopy(terzetto)
    updated = curate_candidate_entry(terzetto)
    assert original_meaning_hash(original, original["senses"][0]) == (
        "a255e654f2214077518764e1fd4af8ab29b0a4a4414ed8e678e7c1b1e17fdc2a"
    )
    assert updated["senses"][0]["definition_en"] == (
        "a musical composition for three voices, or a vocal trio"
    )
    assert updated["senses"][0]["translations"][0]["text"].startswith("terzetto")
    assert "Uch ovoz" in updated["senses"][0]["definition_uz"]
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
        definition_uz_by_sense={
            "9dc9e4dd-a4dc-5068-8541-654b596fc748": "Axloqiy yoki fuqarolik qonunini buzadigan faoliyat.",
        },
    )
    updated_actus = curate_candidate_entry(actus)
    assert "physical element of a criminal offence" in updated_actus["senses"][0]["definition_en"]
    assert "harakatsizlik" in updated_actus["senses"][0]["translations"][0]["text"]
    assert "Jinoyat tarkibining" in updated_actus["senses"][0]["definition_uz"]
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
            (
                "71b31415-0ad2-4d8e-98b0-59760874c45d",
                "reduce or cut back the amount or availability of, creating a decline in value or prices",
                "muomaladagi miqdorni qisqartirmoq",
                "C2",
            ),
            (
                "c8d85a0a-0ef8-4704-8743-207b3fabf642",
                "collapse by releasing contained air or gas",
                "havosini chiqarib so‘ndirmoq",
                "C1",
            ),
            (
                "d8dba130-d8c4-42b7-abec-798769b9b578",
                "reduce or lessen the size or importance of",
                "pasaytirmoq",
                "C2",
            ),
            (
                "ef931b65-4577-420a-9770-e68ef9d6c697",
                "produce deflation in",
                "deflyatsiyaga olib kelmoq",
                "C2",
            ),
        ],
    )
    result = curate_candidate_entry(deflate)
    assert len(result["relations"]) == 6
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
        definition_uz_by_sense={
            "aad9fee0-fbbc-5565-92ef-858166eb4920": "Birga qo'shilgan bir va bir va birga teng natural son.",
        },
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


def test_phase09_deduplicates_canonical_relation_tuples_without_touching_examples() -> None:
    unique = {
        "relation_type": "synonym",
        "display_lemma": "accurate",
        "target_lexeme_id": "0ec27262-19f8-4e78-b08a-3f958b5aa723",
        "target_sense_id": "3d98181b-9167-4b16-b46b-26d3099e1c8f",
        "part_of_speech": "a",
        "lexical_type": "word",
    }
    other_sense = {**unique, "source_sense_id": "178130f4-a84c-4811-a4a0-a6c6a3841a1d"}
    source = entry(
        "67000000-0000-4000-8000-000000000011",
        "test lexical entry",
        "a",
        [
            ("178130f4-a84c-4811-a4a0-a6c6a3841a1d", "first sense", "birinchi", None),
            ("178130f4-a84c-4811-a4a0-a6c6a3841a1e", "second sense", "ikkinchi", None),
        ],
        relations=[unique, copy.deepcopy(unique), other_sense],
    )
    source["senses"][0]["examples"] = [
        {"example_id": "ed166218-6c60-4ea4-b2df-66e997b73b60",
         "text_en": "The original example remains intact.",
         "text_uz": "Asl misol o‘zgarishsiz qoladi."}
    ]
    old = copy.deepcopy(source)
    revised = curate_candidate_entry(source)
    assert source == old
    assert revised["senses"] == old["senses"]
    assert revised["relations"] == [unique, other_sense]
    assert curate_candidate_entry(revised) == revised
    out_of_scope = {**source, "lexeme_id": "80000000-0000-4000-8000-000000000011"}
    assert curate_candidate_entry(out_of_scope) == out_of_scope


@pytest.mark.parametrize(
    ("lexeme_id", "lemma", "excluded", "kept"),
    [
        (
            "6620405e-571d-5504-a46e-975d52fcfc29",
            "apprise",
            {
                "0a5c728a-9078-4805-bba3-8cf148e0638e": "gain in value",
                "e1e227ef-4eb1-4f99-8bb7-3c7ae9ab647b": "increase the value of",
            },
            {
                "7bb141c5-1c75-48d1-a396-d405b909c878": "inform (somebody) of something",
                "d0ee3d9f-2168-4a66-85c3-24a1b0247cd4": "make aware of",
            },
        ),
        (
            "71369b20-c561-573d-95aa-3cf2652e4c52",
            "apprize",
            {
                "6c961d4e-9329-5b02-86bf-82c8fed73443": "gain in value",
                "d2f0df39-8f12-5d2c-9876-aa1792253d0c": "increase the value of",
            },
            {
                "9a3096d8-a0ce-5d82-ac24-f708419de9d8": "inform (somebody) of something",
                "835f44a7-ac69-5088-90c6-dfbde683202c": "make aware of",
            },
        ),
    ],
)
def test_misattributed_senses_are_removed_only_in_candidate(
    lexeme_id: str,
    lemma: str,
    excluded: dict[str, str],
    kept: dict[str, str],
) -> None:
    records = {
        **excluded,
        **kept,
    }
    source = entry(
        lexeme_id,
        lemma,
        "v",
        [(sense_id, definition, "unchanged translation", "C2")
         for sense_id, definition in records.items()],
    )
    for sense in source["senses"]:
        sense["examples"] = [
            {
                "example_id": "10000000-0000-4000-8000-000000000001",
                "text_en": "This example must remain unchanged.",
                "text_uz": "Bu misol o‘zgarishsiz qolishi kerak.",
            },
        ]
    original = copy.deepcopy(source)
    revised = curate_candidate_entry(source)
    assert source == original
    assert {x["sense_id"] for x in revised["senses"]} == set(kept)
    assert all(x["examples"] == original["senses"][0]["examples"]
               for x in revised["senses"])
    assert {r["source_sense_id"] for r in revised["relations"]} <= set(kept)
    assert {c["sense_id"] for c in revised["collocations"]} <= set(kept)
    assert len([r for r in revised["relations"]
                if r["relation_type"] == "synonym"
                and r.get("source_sense_id") in kept]) == 2


def test_misattributed_sense_exclusion_rejects_changed_original_gloss() -> None:
    source = entry(
        "6620405e-571d-5504-a46e-975d52fcfc29",
        "apprise",
        "v",
        [
            ("0a5c728a-9078-4805-bba3-8cf148e0638e",
             "gain in value", "qadri oshmoq", "C2"),
            ("e1e227ef-4eb1-4f99-8bb7-3c7ae9ab647b",
             "increase the value of", "qiymatini oshirmoq", "C2"),
            ("7bb141c5-1c75-48d1-a396-d405b909c878",
             "inform (somebody) of something", "xabardor qilmoq", "C2"),
            ("d0ee3d9f-2168-4a66-85c3-24a1b0247cd4",
             "make aware of", "xabardor qilmoq", "C2"),
        ],
    )
    corrupted = copy.deepcopy(source)
    corrupted["senses"][0]["definition_en"] = "inform by writing"
    with pytest.raises(ValueError, match="meaning_sha_mismatch"):
        curate_candidate_entry(corrupted)

    assert len(curate_candidate_entry(source)["senses"]) == 2
    other_release = {**source, "release_id": "other-release"}
    assert curate_candidate_entry(other_release) == other_release


def test_references_to_excluded_senses_are_pruned_across_lexemes() -> None:
    deleted_lexeme = "6620405e-571d-5504-a46e-975d52fcfc29"
    deleted_sense = "0a5c728a-9078-4805-bba3-8cf148e0638e"
    valid_sense = "7bb141c5-1c75-48d1-a396-d405b909c878"
    original = entry(
        "6b44fefa-f6d3-55d5-a6de-7b7e0fa3973a",
        "appreciate",
        "v",
        [("00000000-0000-4000-8000-000000000001",
          "gain in value", "qadri oshmoq", "C2")],
        relations=[
            {
                "relation_type": "synonym",
                "target_lexeme_id": deleted_lexeme,
                "target_sense_id": deleted_sense,
                "display_lemma": "apprise",
                "lexical_type": "word",
                "part_of_speech": "v",
            },
            {
                "relation_type": "synonym",
                "target_lexeme_id": deleted_lexeme,
                "target_sense_id": valid_sense,
                "display_lemma": "apprise",
                "lexical_type": "word",
                "part_of_speech": "v",
            },
        ],
    )
    original_copy = copy.deepcopy(original)
    revised = curate_candidate_entry(original)
    assert original == original_copy
    assert len(revised["relations"]) == 1
    assert revised["relations"][0]["target_sense_id"] == valid_sense
    assert revised["senses"] == original_copy["senses"]

    # Incoming targets outside the exact UUID pair must remain untouched.
    no_matching_target = copy.deepcopy(original)
    no_matching_target["relations"][0]["target_lexeme_id"] = (
        "00000000-0000-4000-8000-000000000099"
    )
    revised_unrelated = curate_candidate_entry(no_matching_target)
    assert len(revised_unrelated["relations"]) == 2


def test_appease_synonyms_resolve_to_correct_target_senses() -> None:
    source = entry(
        "71cc2552-75cf-50c8-84a0-9583b529b884",
        "appease",
        "v",
        [
            (
                "b22c9951-6d11-4f84-868f-5b680f47a39d",
                "cause to be more favorably inclined; gain the good will of",
                "xayrixohligini qozonmoq",
                "C2",
            ),
            (
                "e5d3562b-ea8c-48c7-a748-59a40b542a04",
                "make peace with",
                "yarashtirmoq; ko‘nglini olmoq",
                "C2",
            ),
            (
                "5ea0659a-f428-4ca0-a049-de1e410d6c41",
                "overcome or allay",
                "bosmoq",
                "C2",
            ),
        ],
    )
    frozen = copy.deepcopy(source)
    result = curate_candidate_entry(source)
    assert source == frozen
    mapping = {
        relation["display_lemma"]: (
            relation["source_sense_id"],
            relation["target_sense_id"],
        )
        for relation in result["relations"]
    }
    assert mapping == {
        "placate": (
            "b22c9951-6d11-4f84-868f-5b680f47a39d",
            "21ccd99c-8b8f-4428-b14f-e16e1e38b10e",
        ),
        "pacify": (
            "b22c9951-6d11-4f84-868f-5b680f47a39d",
            "569b5a61-1fe7-4fa2-b2a3-5dce797ccc6c",
        ),
        "propitiate": (
            "e5d3562b-ea8c-48c7-a748-59a40b542a04",
            "e7f57505-ad38-58c7-8276-a22bcd7ae126",
        ),
    }
    assert (
        "75b24043-b297-4aa4-bf67-819534f5dbde"
        not in {relation["target_sense_id"] for relation in result["relations"]}
    )
    assert {
        (c["text"], c["sense_id"])
        for c in result["collocations"]
    } == {
        ("appease critics", "b22c9951-6d11-4f84-868f-5b680f47a39d"),
        (
            "appease a guilty conscience",
            "5ea0659a-f428-4ca0-a049-de1e410d6c41",
        ),
    }


def test_audible_antonym_targets_inaudible_adjective() -> None:
    source = entry(
        "699705d3-0c37-5c64-85a2-e0dfa11ce66c",
        "audible",
        "a",
        [(
            "fd1560ca-4e94-461d-8e67-beef46ebf5d4",
            "heard or perceptible by the ear",
            "eshitiladigan",
            "C2",
        )],
    )
    revised = curate_candidate_entry(source)
    assert source["relations"] == []
    assert revised["relations"][0]["relation_type"] == "antonym"
    assert revised["relations"][0]["display_lemma"] == "inaudible"
    assert revised["relations"][0]["target_sense_id"] == (
        "a0e13d60-00a5-4ec2-8f13-bf8f0333412c"
    )
    assert revised["collocations"] == [{
        "text": "audible sigh",
        "sense_id": "fd1560ca-4e94-461d-8e67-beef46ebf5d4",
    }]


def test_beep_cefr_and_exact_car_horn_synonyms_do_not_change_pager_sense() -> None:
    source = entry(
        "6aeeff90-ed52-5d70-9903-467e1603bceb",
        "beep",
        "v",
        [
            (
                "a1a40c1d-c4ec-40f3-a69e-860a7331523b",
                "make a strident noise",
                "bipillamoq, keskin signal tovushi chiqarmoq",
                "C2",
            ),
            (
                "fe8247eb-4c07-428f-ad5d-7162e2168cb8",
                "call, summon, or alert with a beeper",
                "peydjer bilan chaqirmoq",
                "C2",
            ),
        ],
    )
    before = copy.deepcopy(source)
    result = curate_candidate_entry(source)
    assert source == before
    assert [sense["cefr"] for sense in result["senses"]] == ["C1", "C2"]
    assert {
        (item["display_lemma"], item["source_sense_id"], item["target_sense_id"])
        for item in result["relations"]
    } == {
        ("honk", "a1a40c1d-c4ec-40f3-a69e-860a7331523b",
         "60853a5a-2598-4eb9-aca4-6d9e6241dcdd"),
        ("blare", "a1a40c1d-c4ec-40f3-a69e-860a7331523b",
         "6fa0de95-5d4f-4368-9b91-c348292467fe"),
    }
    assert result["collocations"] == [
        {"text": "beep a horn", "sense_id": "a1a40c1d-c4ec-40f3-a69e-860a7331523b"}
    ]


def test_abide_distinguishes_tolerate_from_reside_and_keeps_source() -> None:
    source = entry(
        "6c3fc2ae-5f8f-55b6-a1e6-b5e2dc4aac52",
        "abide",
        "v",
        [
            ("033fda48-dc62-4b8e-91a7-30f327e8e66d",
             "put up with something or somebody unpleasant", "chidamoq", "C2"),
            ("28d49c76-2120-49d9-bbc9-c93f5dabdf6f",
             "dwell", "yashamoq; turmoq", "C2"),
        ],
    )
    frozen = copy.deepcopy(source)
    result = curate_candidate_entry(source)
    assert source == frozen
    mapping = {
        row["source_sense_id"]: (row["display_lemma"], row["target_sense_id"])
        for row in result["relations"]
    }
    assert mapping == {
        "033fda48-dc62-4b8e-91a7-30f327e8e66d": (
            "tolerate", "52426071-9e5b-4900-a168-e7921693f12a"
        ),
        "28d49c76-2120-49d9-bbc9-c93f5dabdf6f": (
            "dwell", "b193eeef-0dfb-4f08-9e91-31e9a420c668"
        ),
    }
    assert {row["sense_id"] for row in result["collocations"]} == set(mapping)
