"""Phase 09 lexical correction tests; never publish or alter active R2."""
from __future__ import annotations

import copy
import json
from pathlib import Path
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

    # Use the full frozen source rather than the helper's placeholder Uzbek
    # definition: editorial replacements deliberately require exact old text.
    source_path = Path(__file__).resolve().parents[3] / "content/dictionary/audit-20261113-phase09-source-enrichment-0011-0020.json"
    itself = next(e for e in json.loads(source_path.read_text())["lexemes"] if e["display_lemma"] == "itself")
    assert curate_candidate_entry(itself)["senses"][0]["cefr"] == "A2"
    assert "cefr" not in itself["senses"][0]


def test_exact_antonyms_are_scoped_to_the_meaning() -> None:
    # Exact existing synonym scopes require the real complete source graph.
    source_path = Path(__file__).resolve().parents[3] / "content/dictionary/audit-20261113-phase09-relation-scope-accelerated-first200.json"
    decry = next(e for e in json.loads(source_path.read_text())["source_entries"] if e["display_lemma"] == "decry")
    frozen_decry = copy.deepcopy(decry)
    result = curate_candidate_entry(decry)
    relation = next(r for r in result["relations"] if r["relation_type"] == "antonym" and r["display_lemma"] == "praise")
    assert relation["relation_type"] == "antonym"
    assert relation["display_lemma"] == "praise"
    assert relation["part_of_speech"] == "v"
    assert relation["source_sense_id"] == decry["senses"][0]["sense_id"]
    assert relation["target_sense_id"] == "4045aec2-5b1d-438d-a03c-f86296e73b72"
    assert decry == frozen_decry

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
            for kind in ("add_synonyms", "add_antonyms", "scope_synonyms", "scope_antonyms"):
                for relation in correction.get(kind, []):
                    UUID(relation["lexemeId"])
                    UUID(relation["senseId"])
                    assert relation["partOfSpeech"] in {"n", "v", "a", "r"}
                    assert "source" not in relation
            for relation in correction.get("add_collocations", []):
                assert relation["text"].strip()
                assert "source" not in relation


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
    receipt = json.loads((Path(__file__).resolve().parents[3] /
        "content/dictionary/audit-20261113-phase09-lexemes-1701-1730.json"
    ).read_text(encoding="utf-8"))
    source = next(e for e in receipt["lexemes"] if e["display_lemma"] == "abide")
    frozen = copy.deepcopy(source)
    result = curate_candidate_entry(source)
    assert source == frozen
    mapping = {}
    for row in result["relations"]:
        if row["relation_type"] == "synonym":
            mapping.setdefault(row["source_sense_id"], set()).add(
                (row["display_lemma"], row["target_sense_id"]))
    tolerate = "033fda48-dc62-4b8e-91a7-30f327e8e66d"
    reside = "28d49c76-2120-49d9-bbc9-c93f5dabdf6f"
    assert ("tolerate", "52426071-9e5b-4900-a168-e7921693f12a") in mapping[tolerate]
    assert mapping[reside] == {
        ("bide", "813c86c3-e5fd-40e3-961d-dac543a54023"),
        ("stay", "27357825-72ff-421d-b4b2-e0add441aa9f"),
        ("dwell", "b193eeef-0dfb-4f08-9e91-31e9a420c668"),
    }
    assert not mapping[tolerate] & mapping[reside]
    assert {row["sense_id"] for row in result["collocations"]} == set(mapping)


def test_chatty_and_bribe_cefr_edits_preserve_unrelated_senses() -> None:
    chatty = entry(
        "6bc8aaa3-6065-5b07-88b0-7d80ae3b5dd3",
        "chatty",
        "a",
        [
            ("676b56f7-c118-4e2a-823b-0331c4f81114",
             "prone to friendly informal communication", "gapdon", "C2"),
            ("c9007394-5a5e-49c7-9b8b-6e63837bc107",
             "full of trivial conversation", "sergap; mayda gapga to‘la", "C2"),
        ],
    )
    source_copy = copy.deepcopy(chatty)
    curated = curate_candidate_entry(chatty)
    assert chatty == source_copy
    assert [sense["cefr"] for sense in curated["senses"]] == ["C1", "C1"]
    assert curated["senses"][0]["translations"] == chatty["senses"][0]["translations"]
    assert curated["senses"][1]["translations"] == chatty["senses"][1]["translations"]
    assert [(r["display_lemma"], r["source_sense_id"], r["target_sense_id"])
            for r in curated["relations"]] == [
        ("talkative", "676b56f7-c118-4e2a-823b-0331c4f81114",
         "01797def-7f71-40a2-9547-2a76669dc2bc")
    ]
    assert {r["sense_id"] for r in curated["collocations"]} == {
        "c9007394-5a5e-49c7-9b8b-6e63837bc107"
    }

    bribe = entry(
        "6f6bcc4e-b979-554f-8bbc-405475172731",
        "bribe",
        "n",
        [(
            "b023ae8a-5add-4e04-85b3-f59ffd40824a",
            "payment made to a person in a position of trust to corrupt their judgment",
            "pora",
            "C2",
        )],
    )
    assert bribe["senses"][0]["cefr"] == "C2"
    result = curate_candidate_entry(bribe)
    assert result["senses"][0]["cefr"] == "C1"
    assert {item["text"] for item in result["collocations"]} == {
        "accept a bribe",
        "take a bribe",
    }
    assert bribe["collocations"] == []


def test_baguette_caregiver_and_annoyance_are_sense_scoped() -> None:
    baguette = entry(
        "6e2c70ea-17b4-50d8-9ffb-62486f8f60d3",
        "baguette", "n",
        [("45af92dc-c0c8-4151-878a-18186573effe",
          "narrow French stick loaf", "baget", "C2")],
    )
    caregiver = entry(
        "707450c8-bf09-55c0-8dd4-0c4935498169",
        "caregiver", "n",
        [
            ("0471da0b-e1e8-4316-b4ef-3134542ac6b4",
             "a person who helps in identifying or preventing or treating illness or disability",
             "tibbiy parvarishchi", "C2"),
            ("b28678ca-7aad-4192-b56e-04f16a3715a6",
             "a person who is responsible for attending to the needs of a child or dependent adult",
             "parvarishlovchi", "C2"),
            ("860fbff3-ddfb-4cc0-be73-7fb3f776e7f2",
             "a person who regularly looks after a child or dependent person",
             "parvarish qiluvchi shaxs", None),
        ],
    )
    annoyance = entry(
        "6b82d1f2-3022-55b2-babc-654db68ced9a",
        "annoyance", "n",
        [
            ("2d183b9e-17b4-4309-ac28-f5522b6e0824",
             "the psychological state of being irritated or annoyed",
             "jahllanish; bezovtalik", "C1"),
            ("5b0ac525-7a59-499c-8c7f-37f9d4ccbe77",
             "an unpleasant person who is annoying or exasperating",
             "bezovta qiluvchi odam", "C2"),
            ("7684f98e-2417-4cdf-9a07-368ae9952f22",
             "something or someone that causes trouble; a source of unhappiness",
             "boshog'riq", "C2"),
            ("a4e14c69-657b-4c47-a46d-a338b7ffac8b",
             "anger produced by some annoying irritation",
             "bezovtalikdan kelib chiqqan jahl", "C2"),
            ("bd4f8395-ee91-4f99-9738-47e57e3ff13b",
             "the act of troubling or annoying someone",
             "bezovta qilish", "C2"),
        ],
    )
    originals = [copy.deepcopy(e) for e in (baguette, caregiver, annoyance)]
    bread, carer, irritation = [
        curate_candidate_entry(e) for e in (baguette, caregiver, annoyance)
    ]
    assert (baguette, caregiver, annoyance) == tuple(originals)
    assert bread["senses"][0]["cefr"] == "B2"
    assert bread["collocations"] == [{
        "text": "fresh baguette",
        "sense_id": "45af92dc-c0c8-4151-878a-18186573effe",
    }]
    assert [s.get("cefr") for s in carer["senses"]] == ["C2", "C1", None]
    assert {x["text"] for x in carer["collocations"]} == {
        "primary caregiver", "family caregiver"
    }
    assert [s["cefr"] for s in irritation["senses"]] == [
        "C1", "C2", "C1", "C1", "C2"
    ]
    assert irritation["senses"][2]["translations"][0]["text"] == (
        "bezovta qiladigan odam yoki narsa; boshog‘riq"
    )
    assert len(irritation["relations"]) == 2
    assert {r["source_sense_id"] for r in irritation["relations"]} == {
        "7684f98e-2417-4cdf-9a07-368ae9952f22",
        "a4e14c69-657b-4c47-a46d-a338b7ffac8b",
    }


def test_brilliance_three_distinct_senses_keep_their_own_lexical_links() -> None:
    original = entry(
        "6d673b56-e14b-5236-b31e-d947f28f5b42",
        "brilliance", "n",
        [
            ("86fde680-8dd4-4286-af9b-09f93752e21a",
             "unusual mental ability", "zakovat", "C2"),
            ("bb6d0dc4-dbeb-4b26-88b2-3a5b0b4d2f24",
             "the quality of being magnificent or splendid or grand",
             "ulug'vorlik; hashamat", "C2"),
            ("cb1ac30e-edb8-4266-b36f-4f2a886e1a54",
             "a light within the field of vision that is brighter than the brightness to which the eyes are adapted",
             "ko‘zni qamashtiruvchi yorqinlik", "C1"),
        ],
    )
    original["senses"][0]["examples"] = [{
        "example_id": "decc3d5c-8d9a-4ce5-a99d-e99bba20909c",
        "text_en": "Her academic brilliance was recognized.",
        "text_uz": "Uning ilmiy salohiyati e’tirof etildi.",
    }]
    preserved = copy.deepcopy(original)
    updated = curate_candidate_entry(original)
    assert original == preserved
    assert updated["senses"][0]["examples"] == preserved["senses"][0]["examples"]
    assert [sense["cefr"] for sense in updated["senses"]] == ["C1", "C1", "C1"]
    relation_senses = {
        relation["display_lemma"]: (
            relation["source_sense_id"], relation["target_sense_id"]
        )
        for relation in updated["relations"]
    }
    assert relation_senses == {
        "genius": (
            "86fde680-8dd4-4286-af9b-09f93752e21a",
            "3fb261c7-c5a6-44b3-9b34-cc7e4e49bf30",
        ),
        "glare": (
            "cb1ac30e-edb8-4266-b36f-4f2a886e1a54",
            "c07f9fc1-7d3a-4cb0-abc4-799f117d2a2c",
        ),
        "blaze": (
            "cb1ac30e-edb8-4266-b36f-4f2a886e1a54",
            "1599ee7f-ab04-4335-97f8-1150731662d1",
        ),
    }
    assert {
        (value["sense_id"], value["text"]) for value in updated["collocations"]
    } == {
        ("86fde680-8dd4-4286-af9b-09f93752e21a", "academic brilliance"),
        ("86fde680-8dd4-4286-af9b-09f93752e21a", "flashes of brilliance"),
        ("bb6d0dc4-dbeb-4b26-88b2-3a5b0b4d2f24", "technical brilliance"),
    }


def test_blackberry_edible_fruit_grade_does_not_change_botanical_sense() -> None:
    original = entry(
        "69d5e678-3e68-5081-8e63-6cb588d34827",
        "blackberry", "n",
        [
            ("369e683a-bed2-4834-8743-e5871947d096",
             "large sweet black or very dark purple edible aggregate fruit of any of various bushes of the genus Rubus",
             "maymunjon", "C2"),
            ("53db6d5a-434d-4e63-b213-9b7cdbfd4f4e",
             "bramble with sweet edible black or dark purple berries that usually do not separate from the receptacle",
             "maymunjon butasi (qora mevali tikanli buta)", "C2"),
        ],
    )
    immutable = copy.deepcopy(original)
    revised = curate_candidate_entry(original)
    assert original == immutable
    assert [sense["cefr"] for sense in revised["senses"]] == ["C1", "C2"]
    assert revised["relations"] == []
    assert revised["collocations"] == [{
        "text": "blackberry and apple pie",
        "sense_id": "369e683a-bed2-4834-8743-e5871947d096",
    }]


def test_brim_container_relations_do_not_apply_to_hat_and_burrow_keeps_grammar() -> None:
    brim = entry(
        "67582942-8fa4-5a45-a24b-006fcfe219fc",
        "brim", "n",
        [
            ("ece50b59-a973-40b1-9add-e4c360a03983",
             "the top edge of a vessel or other container",
             "og‘iz cheti; yuqori chet", "C2"),
            ("f0a1a434-41dc-4c6e-861b-7a82b29f079e",
             "a circular projection that sticks outward from the crown of a hat",
             "shlyapa soyaboni", "C2"),
        ],
    )
    unchanged = copy.deepcopy(brim)
    revised = curate_candidate_entry(brim)
    assert brim == unchanged
    assert {
        (rel["display_lemma"], rel["source_sense_id"])
        for rel in revised["relations"]
    } == {
        ("rim", "ece50b59-a973-40b1-9add-e4c360a03983"),
        ("lip", "ece50b59-a973-40b1-9add-e4c360a03983"),
    }
    assert {
        (item["sense_id"], item["text"]) for item in revised["collocations"]
    } == {
        ("ece50b59-a973-40b1-9add-e4c360a03983", "full to the brim"),
        ("ece50b59-a973-40b1-9add-e4c360a03983", "fill something to the brim"),
        ("f0a1a434-41dc-4c6e-861b-7a82b29f079e", "wide brim"),
        ("f0a1a434-41dc-4c6e-861b-7a82b29f079e", "beneath the brim"),
    }
    assert [s["cefr"] for s in revised["senses"]] == ["C2", "C2"]

    burrow = entry(
        "67206e0f-045b-5e1d-bdf7-37623e627824",
        "burrow", "v",
        [("26a43cd7-8094-4a68-91c4-fca58ff30636",
          "move through by or as by digging", "kovlab o‘tmoq", "C2")],
    )
    burrow_original = copy.deepcopy(burrow)
    burrow_revised = curate_candidate_entry(burrow)
    assert burrow == burrow_original
    assert burrow_revised["senses"] == burrow_original["senses"]
    assert {item["text"] for item in burrow_revised["collocations"]} == {
        "burrow into the soil", "burrow under the fence"
    }


def test_dictionary_content_excludes_provenance_and_publisher_branding() -> None:
    """Provenance is audit-only, not part of serialized dictionary entries."""
    data = load_corrections()
    content = json.dumps(data, ensure_ascii=False).casefold()
    for identifier in (
        "oxford",
        "cambridge",
        "collins",
        "cornell",
        "https://",
        "http://",
        "sense_alignment",
        '"source":',
    ):
        assert identifier not in content

    provenance_path = (
        Path(__file__).resolve().parents[3]
        / "content/dictionary/audit-20261112-phase09-source-evidence.json"
    )
    evidence = json.loads(provenance_path.read_text(encoding="utf-8"))
    assert evidence["visibility"] == "audit_only_not_dictionary_content"
    assert evidence["release_id"] == RELEASE
    assert len(evidence["references"]) == 199
    assert len(evidence["annotations"]) == 12

    for reference in evidence["references"]:
        assert reference["url"].startswith("https://")
        assert reference["lexeme_id"] in data["entries"]
        assert reference["sense_id"] in data["entries"][reference["lexeme_id"]]
        assert reference["field_path"].endswith(".source") or reference["field_path"] == "source"


def test_candidate_and_public_dictionary_view_never_leak_source_metadata(monkeypatch) -> None:
    from app import dictionary_presentation as presentation
    from app import dictionary_reader_metadata as reader

    original = entry(
        "6d673b56-e14b-5236-b31e-d947f28f5b42",
        "brilliance",
        "n",
        [
            (
                "86fde680-8dd4-4286-af9b-09f93752e21a",
                "unusual mental ability",
                "zakovat",
                "C2",
            ),
            (
                "bb6d0dc4-dbeb-4b26-88b2-3a5b0b4d2f24",
                "the quality of being magnificent or splendid or grand",
                "ulug'vorlik; hashamat",
                "C2",
            ),
            (
                "cb1ac30e-edb8-4266-b36f-4f2a886e1a54",
                "a light within the field of vision that is brighter than the brightness to which the eyes are adapted",
                "ko‘zni qamashtiruvchi yorqinlik",
                "C1",
            ),
        ],
    )
    original.update({"lexical_type": "word", "forms": []})
    snapshot = copy.deepcopy(original)
    revised = curate_candidate_entry(original)
    monkeypatch.setattr(presentation, "shard", lambda _: {})
    monkeypatch.setattr(reader, "stored", lambda _: None)
    public_view = presentation.present(original)

    assert original == snapshot
    for result in (revised, public_view):
        rendered = json.dumps(result, ensure_ascii=False).casefold()
        assert "https://" not in rendered
        for provider in ("oxford", "cambridge", "collins", "cornell"):
            assert provider not in rendered
        assert '"source":' not in rendered
        assert "sense_alignment" not in rendered
    assert public_view["senses"][original["senses"][0]["sense_id"]]["collocations"]


def test_reader_facing_overlay_whitelists_fields_even_if_source_metadata_is_injected(
    monkeypatch,
) -> None:
    """Never serialize editorial publisher links through dictionary presentation."""
    from app import dictionary_presentation as presentation
    from app import dictionary_reader_metadata as reader

    original = entry(
        "6d673b56-e14b-5236-b31e-d947f28f5b42",
        "brilliance",
        "n",
        [("86fde680-8dd4-4286-af9b-09f93752e21a",
          "unusual mental ability", "zakovat", "C2")],
    )
    original.update({"lexical_type": "word", "forms": []})
    sense = original["senses"][0]
    patch = {
        "meaning_sha": presentation.meaning_hash(original, sense),
        "source": "https://dictionary.cambridge.org/dictionary/english/brilliance",
        "sense_alignment": "Oxford learner-level metadata stays in audit only",
        "replace_cefr": {
            "original": "C2",
            "text": "C1",
            "source": "https://www.oxfordlearnersdictionaries.com/",
        },
        "add_synonyms": [
            {
                "text": "genius",
                "lexemeId": "90e4c3ee-e1d3-58d6-a153-98e1a24364bb",
                "senseId": "3fb261c7-c5a6-44b3-9b34-cc7e4e49bf30",
                "source": "https://dictionary.cambridge.org/",
                "publisher": "Cambridge",
            }
        ],
        "add_collocations": [
            {
                "text": "academic brilliance",
                "source": "https://www.oxfordlearnersdictionaries.com/",
                "publisher": "Oxford",
            }
        ],
    }
    monkeypatch.setattr(
        presentation,
        "sense_corrections",
        lambda: {
            "source_release": RELEASE,
            "entries": {original["lexeme_id"]: {sense["sense_id"]: patch}},
        },
    )
    monkeypatch.setattr(presentation, "shard", lambda _: {})
    monkeypatch.setattr(reader, "stored", lambda _: None)
    curated_overlay = presentation.corrected_sense_presentation(original, sense)
    public_response = presentation.present(original)

    for rendered in (curated_overlay, public_response):
        text = json.dumps(rendered, ensure_ascii=False).casefold()
        for forbidden in ("oxford", "cambridge", "https://", "publisher", "sense_alignment"):
            assert forbidden not in text
    assert public_response["senses"][sense["sense_id"]]["synonyms"] == [
        {
            "text": "genius",
            "lexemeId": "90e4c3ee-e1d3-58d6-a153-98e1a24364bb",
            "senseId": "3fb261c7-c5a6-44b3-9b34-cc7e4e49bf30",
        },
    ]
    assert public_response["senses"][sense["sense_id"]]["collocations"] == [
        {"text": "academic brilliance"}
    ]



def test_supplemental_exact_sense_cefr_and_collocations_are_guarded() -> None:
    """Only four attested meanings change; all other meanings and source objects stay intact."""
    dinnertime = entry(
        "6f87437a-2e92-5dee-932a-2dce0fb1e3fc",
        "dinnertime", "n",
        [("076f0d4c-4403-4cca-a6f9-91e2132189e7",
          "the customary or habitual hour for the evening meal",
          "kechki ovqat vaqti", "C2")],
    )
    casino = entry(
        "7000821d-e8e8-5d02-8df0-85624482002c",
        "casino", "n",
        [
            ("2d63e0d4-b386-462b-be11-394e39e60f29",
             "a public building for gambling and entertainment", "kazino", "C2"),
            ("750c43e7-a7c3-48e7-ba80-076df7ce65a3",
             "a card game in which cards face up on the table are taken with eligible cards in the hand",
             "kasino karta o'yini", "C2"),
        ],
    )
    clash = entry(
        "6f2fc2bf-a389-5298-98b8-19aee9820b0f",
        "clash", "n",
        [
            ("58903a8b-9c0f-4cc9-bf80-0c7b385aaa60",
             "a state of conflict between colors", "ranglar to‘qnashuvi", "C2"),
            ("c2911c20-b7da-4d8d-acdb-332c9553ad8e",
             "a state of conflict between persons", "to‘qnashuv; ziddiyat", "C2"),
        ],
    )
    circuit = entry(
        "685813d5-65c5-54ab-a964-5aa0c090c253",
        "circuit", "n",
        [
            ("1db61f3e-afa9-5b5d-aea5-0a1e7fd2757b",
             "a racetrack for automobile races", "avtopoyga trassasi", "C2"),
            ("ce38d61a-705b-499e-8de4-c03aff3e4f17",
             "a complete path through which electric current or a signal can travel",
             "elektr zanjiri", None),
        ],
    )
    scenarios = [
        (dinnertime, "076f0d4c-4403-4cca-a6f9-91e2132189e7",
         "b5a930f6e120c25e4e1a071c2628ddb46358ae3ed3d431e37d03b5a87b95216e",
         ["B2"], {"before dinnertime"}),
        (casino, "2d63e0d4-b386-462b-be11-394e39e60f29",
         "130851f4e9052204bef8132f40828d32d8df6afc4d038d907f147b32ff86f8b3",
         ["C1", "C2"], set()),
        (clash, "c2911c20-b7da-4d8d-acdb-332c9553ad8e",
         "721de9c021a5920292799102574f74c6107345975dd8fdd68602b21eab2c0c87",
         ["C2", "C1"], {"a personality clash"}),
        (circuit, "ce38d61a-705b-499e-8de4-c03aff3e4f17",
         "a191d10fcc3ddfbf3a1b12429527fa2b4e7e269c23f35b44a0c0b7901b18d3c1",
         ["C2", "B2"], {"electrical circuit", "circuit diagram"}),
    ]
    for original, sense_id, source_hash, levels, collocations in scenarios:
        frozen = copy.deepcopy(original)
        source_sense = next(s for s in original["senses"] if s["sense_id"] == sense_id)
        assert original_meaning_hash(original, source_sense) == source_hash
        corrected = curate_candidate_entry(original)
        assert original == frozen
        assert [s.get("cefr") for s in corrected["senses"]] == levels
        assert {c["text"] for c in corrected["collocations"]} == collocations
        assert all(c["sense_id"] == sense_id for c in corrected["collocations"])
        assert corrected["relations"] == frozen["relations"]
        for before, after in zip(frozen["senses"], corrected["senses"]):
            assert before["definition_en"] == after["definition_en"]
            assert before["definition_uz"] == after["definition_uz"]
            assert before["translations"] == after["translations"]
            assert before["examples"] == after["examples"]
            if before["sense_id"] != sense_id:
                assert before == after


def test_phase09_first_200_source_receipt_and_targeted_repairs() -> None:
    """Verify 200 frozen lexical objects, 353 hashes and each exact-sense patch."""
    import hashlib
    from app.dictionary_canonical import stable

    path = (
        Path(__file__).resolve().parents[3]
        / "content/dictionary/audit-20261113-phase09-first-200-lexemes.json"
    )
    report = json.loads(path.read_text(encoding="utf-8"))
    assert report["schema"] == 1
    assert report["phase"] == 9
    assert report["scope"]["lexemes"] == 200
    assert report["scope"]["senses"] == 353
    assert report["scope"]["shards"] == ["65", "66"]
    assert report["signoff"]["main_merged"] is False
    assert report["signoff"]["release_published"] is False
    assert report["signoff"]["lexeme_semantics_independently_certified"] is False
    assert len(report["lexemes"]) == 200
    all_senses = [
        (word, sense)
        for word in report["lexemes"]
        for sense in word["senses"]
    ]
    assert len(all_senses) == 353
    assert len({sense["sense_id"] for _, sense in all_senses}) == 353
    for word, sense in all_senses:
        source = {
            "definition": sense["definition_en"],
            "lemma": word["lemma"],
            "pos": word["part_of_speech"],
        }
        digest = hashlib.sha256(stable(source).encode("utf-8")).hexdigest()
        assert sense["meaning_sha"] == digest

    patches = load_corrections()["entries"]
    expected = {
        "hello": {"eadfd862-8108-42cf-b009-995653d25c2c": "A1"},
        "margin of error": {"2da29542-2016-5d1b-8cda-6d3edc52ae8b": "C2"},
        "diner": {
            "7e147f4d-e484-4807-a4c1-118e634c628e": "C1",
            "c558d849-f291-4c12-9ba5-9e9d11b81a07": "C1",
        },
        "startup": {"94cb1d1c-56f4-42e0-89bf-fcf8ecab3cc9": "C1"},
    }
    by_lemma = {w["lemma"]: w for w in report["lexemes"]}
    for lemma, levels in expected.items():
        word = by_lemma[lemma]
        for sense_id, level in levels.items():
            assert patches[word["lexeme_id"]][sense_id]["replace_cefr"]["text"] == level
    for lemma in ("hame", "zakat", "chatterbox"):
        word = by_lemma[lemma]
        assert word["lexeme_id"] in patches

    full_sources = {}
    for full_path in path.parent.glob("audit-*-phase09-source-enrichment-*.json"):
        enriched = json.loads(full_path.read_text(encoding="utf-8"))
        if enriched["historical_receipt"] == path.relative_to(path.parents[2]).as_posix():
            full_sources.update({item["lexeme_id"]: item for item in enriched["lexemes"]})
    scoped_source = json.loads((path.parent / "audit-20261113-phase09-relation-scope-accelerated-first200.json").read_text())
    full_sources.update({item["lexeme_id"]: item for item in scoped_source["source_entries"]})

    for word in report["lexemes"]:
        if word["lexeme_id"] not in patches:
            continue
        original = {
            "release_id": report["source_release"],
            "lexeme_id": word["lexeme_id"],
            "display_lemma": word["lemma"],
            "part_of_speech": word["part_of_speech"],
            "senses": [
                {
                    "sense_id": s["sense_id"],
                    "definition_en": s["definition_en"],
                    "definition_uz": s["definition_uz"],
                    "translations": [{"text": s["translation_uz"]}],
                    **({"cefr": s["cefr"]} if s["cefr"] is not None else {}),
                    "examples": [],
                }
                for s in word["senses"]
            ],
            "relations": [
                {
                    **{
                        "relation_type": r["relation_type"],
                        "display_lemma": r["display_lemma"],
                        "target_lexeme_id": r["target_lexeme_id"],
                    },
                    **({"target_sense_id": r["target_sense_id"]}
                       if r["target_sense_id"] else {}),
                    **({"source_sense_id": r["source_sense_id"]}
                       if r["source_sense_id"] else {}),
                }
                for r in word["relations"]
            ],
            "collocations": [
                {"text": c["text"], **({"sense_id": c["sense_id"]}
                  if c["sense_id"] else {})}
                for c in word["collocations"]
            ],
        }
        # Historical projections omit target POS and full example objects.
        # Keep the production scope guards strict and use verified source data.
        original = copy.deepcopy(full_sources.get(word["lexeme_id"], original))
        immutable = copy.deepcopy(original)
        candidate = curate_candidate_entry(original)
        assert original == immutable
        assert candidate is not original
        changed = patches[word["lexeme_id"]]
        for sense in candidate["senses"]:
            patch = changed.get(sense["sense_id"], {})
            before = next(s for s in immutable["senses"] if s["sense_id"] == sense["sense_id"])
            if "replace_cefr" in patch:
                assert sense.get("cefr") == patch["replace_cefr"]["text"]
            else:
                assert sense.get("cefr") == before.get("cefr")
            for field in ("definition_en", "definition_uz"):
                replacement = patch.get("replace_" + field)
                assert sense[field] == (replacement["text"] if replacement else before[field])
            translation = patch.get("replace_translation_uz")
            assert sense["translations"][0]["text"] == (
                translation["text"] if translation else before["translations"][0]["text"]
            )
            assert sense["examples"] == before["examples"]

    margin = by_lemma["margin of error"]
    assert len(patches[margin["lexeme_id"]][margin["senses"][0]["sense_id"]]
               ["remove_synonym_lexeme_ids"]) == 2


def test_phase09_next_500_original_hashes_and_sense_corrections() -> None:
    """500 original lexemes/822 senses remain identity matched; edits are sense scoped."""
    import hashlib
    from app.dictionary_canonical import stable

    path = (
        Path(__file__).resolve().parents[3]
        / "content/dictionary/audit-20261113-phase09-next-500-lexemes.json"
    )
    report = json.loads(path.read_text(encoding="utf-8"))
    assert report["schema"] == 1
    assert report["phase"] == 9
    assert report["scope"]["lexemes"] == 500
    assert report["scope"]["senses"] == 822
    assert report["scope"]["first_lexeme_id"] == "662fec4a-afb8-563b-a494-c093c80b5ad6"
    assert report["scope"]["last_lexeme_id"] == "6822c2c2-41d6-508c-9d04-d3397fcbd406"
    assert report["scope"]["shards"] == {"66": 204, "67": 248, "68": 48}
    assert report["signoff"]["source_identity_readback"] is True
    assert report["signoff"]["linguistic_external_certification_complete"] is False
    assert report["signoff"]["main_merged"] is False
    assert len(report["lexemes"]) == 500
    assert len({entry["lexeme_id"] for entry in report["lexemes"]}) == 500
    assert sum(len(entry["senses"]) for entry in report["lexemes"]) == 822
    assert sum(sense["cefr"] is None for entry in report["lexemes"]
               for sense in entry["senses"]) == 66
    assert sum(sense["cefr"] == "C2" for entry in report["lexemes"]
               for sense in entry["senses"]) == 355
    assert sum(relation["source_sense_id"] is None for entry in report["lexemes"]
               for relation in entry["relations"]) == 1076

    for entry_record in report["lexemes"]:
        for sense in entry_record["senses"]:
            original = {
                "definition": sense["definition_en"],
                "lemma": entry_record["lemma"],
                "pos": entry_record["part_of_speech"],
            }
            digest = hashlib.sha256(stable(original).encode("utf-8")).hexdigest()
            assert sense["meaning_sha"] == digest

    patch_data = load_corrections()["entries"]
    expected = {
        "sneaker": ("31f266af-0418-47f0-8f16-0fb3563e96f2", "A2"),
        "sportsmanship": ("e7b07f8c-4c9b-4afc-b3a3-cb8a9ceb0f4b", "C1"),
        "kilogram": ("02fffd48-1cda-4196-9b03-8958eb087213", "A2"),
        "landowner": ("c16a72af-f2ac-4acd-a8b3-fcd1cf9f306f", "C1"),
    }
    by_name = {entry["lemma"]: entry for entry in report["lexemes"]}
    for lemma, (sense_id, cefr) in expected.items():
        entry_record = by_name[lemma]
        patch = patch_data[entry_record["lexeme_id"]][sense_id]
        assert patch["replace_cefr"]["text"] == cefr

    for lemma in (
        "sneaker", "sportsmanship", "manga", "compiler", "kilogram",
        "landowner", "alright", "present perfect tense", "tsunami",
    ):
        entry_record = by_name[lemma]
        original = {
            "lexeme_id": entry_record["lexeme_id"],
            "release_id": report["source_release"],
            "display_lemma": entry_record["lemma"],
            "part_of_speech": entry_record["part_of_speech"],
            "senses": [
                {
                    "sense_id": s["sense_id"],
                    "definition_en": s["definition_en"],
                    "definition_uz": s["definition_uz"],
                    "translations": copy.deepcopy(s["translations"]),
                    **({"cefr": s["cefr"]} if s["cefr"] is not None else {}),
                    "examples": [],
                }
                for s in entry_record["senses"]
            ],
            "relations": [
                {
                    "relation_type": r["type"],
                    "display_lemma": r["text"],
                    "target_lexeme_id": r["target_lexeme_id"],
                    **({"target_sense_id": r["target_sense_id"]}
                       if r["target_sense_id"] else {}),
                    **({"source_sense_id": r["source_sense_id"]}
                       if r["source_sense_id"] else {}),
                }
                for r in entry_record["relations"]
            ],
            "collocations": copy.deepcopy(entry_record["collocations"]),
        }
        frozen = copy.deepcopy(original)
        updated = curate_candidate_entry(original)
        assert original == frozen
        edits = patch_data[entry_record["lexeme_id"]]
        for sense in updated["senses"]:
            patch = edits.get(sense["sense_id"], {})
            before = next(x for x in frozen["senses"] if x["sense_id"] == sense["sense_id"])
            assert original_meaning_hash(frozen, before) == next(
                s["meaning_sha"] for s in entry_record["senses"]
                if s["sense_id"] == sense["sense_id"]
            )
            for key in ("definition_en", "definition_uz"):
                change = patch.get("replace_" + key)
                assert sense[key] == (change["text"] if change else before[key])
            change_cefr = patch.get("replace_cefr")
            assert sense.get("cefr") == (
                change_cefr["text"] if change_cefr else before.get("cefr")
            )
            assert sense["translations"] == before["translations"]
            assert sense["examples"] == before["examples"]
        expected_collocations = {
            (x["text"], sid)
            for sid, patch in edits.items()
            for x in patch.get("add_collocations", [])
        }
        assert expected_collocations <= {
            (x["text"], x["sense_id"]) for x in updated["collocations"]
        }
        assert updated["relations"] == frozen["relations"]


def test_phase09_third_500_source_and_exact_sense_corrections() -> None:
    """Ensure 500 original R2 identities survive curated edits unchanged."""
    import hashlib
    from app.dictionary_canonical import stable

    path = (
        Path(__file__).resolve().parents[3]
        / "content/dictionary/audit-20261113-phase09-third-500-lexemes.json"
    )
    receipt = json.loads(path.read_text(encoding="utf-8"))
    assert receipt["schema"] == 1
    assert receipt["phase"] == 9
    assert receipt["batch"] == "lexemes-0701-1200"
    assert receipt["scope"]["lexemes"] == 500
    assert receipt["scope"]["senses"] == 819
    assert receipt["scope"]["shards"] == {"68": 219, "69": 247, "6a": 34}
    assert receipt["scope"]["first_lexeme_id"] == "6823fe72-835e-5119-8853-51e24d1e683d"
    assert receipt["scope"]["last_lexeme_id"] == "6a1ec259-771a-5642-beef-848917b610d4"
    assert receipt["scope"]["missing_cefr"] == 60
    assert receipt["scope"]["c2"] == 346
    assert receipt["scope"]["unscoped_relations"] == 1122
    assert receipt["scope"]["source_missing_translations"] == 0
    assert receipt["scope"]["source_missing_definition_uz"] == 0
    assert receipt["signoff"]["linguistic_external_certification_complete"] is False
    assert receipt["signoff"]["main_merged"] is False
    assert receipt["signoff"]["production_published"] is False
    assert len(receipt["lexemes"]) == 500
    assert len({w["lexeme_id"] for w in receipt["lexemes"]}) == 500

    by_name = {word["lemma"]: word for word in receipt["lexemes"]}
    updates = load_corrections()["entries"]
    expected_levels = {
        ("Thursday", "c923a375-22c8-57d8-a201-4b3fdc867d14"): "A1",
        ("airplane", "41f44af9-509c-4d45-8dc4-44e71caa2c13"): "A1",
        ("secretary", "bd660b7b-71af-414a-a566-0a42d67a5461"): "A2",
        ("secretary", "e58abe27-e1f7-4c74-beaa-00cf30d1789c"): "B2",
        ("etiquette", "212df488-f976-4bfd-97cd-6b322528b32d"): "B2",
        ("etiquette", "5d44c082-2b56-41c5-b2b7-0594dbf11438"): "B2",
        ("log in", "f549d2de-7e3e-5dda-b564-c11c0e96de53"): "B2",
    }
    assert sum(len(w["senses"]) for w in receipt["lexemes"]) == 819
    for word in receipt["lexemes"]:
        for sense in word["senses"]:
            original = {
                "definition": sense["definition_en"],
                "lemma": word["lemma"],
                "pos": word["part_of_speech"],
            }
            assert hashlib.sha256(stable(original).encode("utf-8")).hexdigest() == sense["meaning_sha"]

    for lemma in ("Thursday", "airplane", "secretary", "etiquette", "log in",
                  "pediatrician", "light bulb"):
        word = by_name[lemma]
        frozen = entry(
            word["lexeme_id"],
            word["lemma"],
            word["part_of_speech"],
            [
                (sense["sense_id"], sense["definition_en"],
                 sense["translations"][0]["text"], sense["cefr"])
                for sense in word["senses"]
            ],
            relations=[
                {
                    "relation_type": relation["type"],
                    "display_lemma": relation["text"],
                    "target_lexeme_id": relation["target_lexeme_id"],
                    **({"target_sense_id": relation["target_sense_id"]}
                       if relation["target_sense_id"] else {}),
                    **({"source_sense_id": relation["source_sense_id"]}
                       if relation["source_sense_id"] else {}),
                }
                for relation in word["relations"]
            ],
            definition_uz_by_sense={
                sense["sense_id"]: sense["definition_uz"]
                for sense in word["senses"]
            },
        )
        frozen["collocations"] = copy.deepcopy(word["collocations"])
        before = copy.deepcopy(frozen)
        result = curate_candidate_entry(frozen)
        assert frozen == before
        assert result is not frozen
        edits = updates[word["lexeme_id"]]
        for original, transformed in zip(before["senses"], result["senses"]):
            sid = original["sense_id"]
            correction = edits.get(sid, {})
            assert original_meaning_hash(before, original) == next(
                s["meaning_sha"] for s in word["senses"] if s["sense_id"] == sid
            )
            for name in ("definition_en", "definition_uz"):
                patch = correction.get("replace_" + name)
                assert transformed[name] == (patch["text"] if patch else original[name])
            t_patch = correction.get("replace_translation_uz")
            assert transformed["translations"][0]["text"] == (
                t_patch["text"] if t_patch else original["translations"][0]["text"]
            )
            level_patch = correction.get("replace_cefr")
            assert transformed.get("cefr") == (
                level_patch["text"] if level_patch else original.get("cefr")
            )
            assert transformed["examples"] == original["examples"]
            if (lemma, sid) in expected_levels:
                assert transformed["cefr"] == expected_levels[lemma, sid]
        expected_collocations = {
            (colloc["text"], sid)
            for sid, patch in edits.items()
            for colloc in patch.get("add_collocations", [])
        }
        assert expected_collocations <= {
            (colloc["text"], colloc.get("sense_id"))
            for colloc in result["collocations"]
        }
        assert result["relations"] == before["relations"]


def test_phase09_fourth_500_source_and_exact_sense_repairs() -> None:
    """Immutable source inventory and surgical sense edits for lexemes 1201–1700."""
    import hashlib
    from app.dictionary_canonical import stable

    path = (
        Path(__file__).resolve().parents[3]
        / "content/dictionary/audit-20261113-phase09-fourth-500-lexemes.json"
    )
    report = json.loads(path.read_text(encoding="utf-8"))
    scope = report["scope"]
    assert report["schema"] == 1 and report["phase"] == 9
    assert report["batch"] == "lexemes-1201-1700"
    assert scope["lexemes"] == 500
    assert scope["senses"] == 890
    assert scope["shards"] == {"6a": 221, "6b": 231, "6c": 48}
    assert scope["first_lexeme_id"] == "6a218520-9c74-5549-a2ca-a4548d06f32b"
    assert scope["last_lexeme_id"] == "6c38da6c-1d2d-57b3-bdb4-38fa1a8a4c1c"
    assert scope["missing_cefr"] == 82
    assert scope["c2"] == 397
    assert scope["unscoped_relations"] == 1245
    assert scope["source_missing_translations"] == 0
    assert scope["source_missing_definition_uz"] == 0
    assert report["signoff"]["linguistic_external_certification_complete"] is False
    assert report["signoff"]["production_published"] is False
    assert report["signoff"]["main_merged"] is False
    assert len(report["lexemes"]) == 500
    assert len({w["lexeme_id"] for w in report["lexemes"]}) == 500
    assert sum(len(w["senses"]) for w in report["lexemes"]) == 890
    for word in report["lexemes"]:
        for sense in word["senses"]:
            content = {
                "definition": sense["definition_en"],
                "lemma": word["lemma"],
                "pos": word["part_of_speech"],
            }
            assert hashlib.sha256(stable(content).encode("utf-8")).hexdigest() == sense["meaning_sha"]

    expected_levels = {
        ("committee", "84398b89-9fca-4d27-827d-881518e85281"): "B2",
        ("tonight", "35a82d63-dd4a-4dda-9284-f90b4be66ec3"): "A1",
        ("pricey", "dd616329-2a56-49fa-94d9-9e9f80237e1a"): "B2",
        ("kebab", "b8d6fb2a-9ffa-48f8-b84d-3dd8d85d4d97"): "B2",
        ("sequel", "581e179e-c811-4b8a-babf-d069db03cb80"): "C1",
        ("saying", "6aba55e5-4a0e-427d-84bf-2bd113d8cc29"): "B1",
        ("orphan", "7fc7746d-e07a-46eb-80b2-d2dc8cd8dc36"): "C1",
        ("napkin", "e2c9cd82-de5f-44e0-b6f3-584dc1729c03"): "C1",
        ("e-mail", "93f476ea-6cfd-405b-9177-36afcf333ead"): "A2",
    }
    names = {
        "committee", "tonight", "pricey", "kebab", "sequel", "saying",
        "orphan", "napkin", "e-mail", "bubble", "invoice",
    }
    patches = load_corrections()["entries"]
    for word in report["lexemes"]:
        if word["lemma"] not in names:
            continue
        original = entry(
            word["lexeme_id"],
            word["lemma"],
            word["part_of_speech"],
            [
                (
                    s["sense_id"],
                    s["definition_en"],
                    s["translations"][0]["text"],
                    s["cefr"],
                )
                for s in word["senses"]
            ],
            relations=[
                {
                    "relation_type": r["type"],
                    "display_lemma": r["text"],
                    "target_lexeme_id": r["target_lexeme_id"],
                    **({"target_sense_id": r["target_sense_id"]}
                       if r["target_sense_id"] else {}),
                    **({"source_sense_id": r["source_sense_id"]}
                       if r["source_sense_id"] else {}),
                }
                for r in word["relations"]
            ],
            definition_uz_by_sense={
                s["sense_id"]: s["definition_uz"] for s in word["senses"]
            },
        )
        original["collocations"] = copy.deepcopy(word["collocations"])
        frozen = copy.deepcopy(original)
        revised = curate_candidate_entry(original)
        assert original == frozen
        assert revised is not original
        edits = patches[word["lexeme_id"]]
        for old_sense, new_sense in zip(frozen["senses"], revised["senses"]):
            sense_id = old_sense["sense_id"]
            patch = edits.get(sense_id, {})
            assert original_meaning_hash(frozen, old_sense) == next(
                s["meaning_sha"] for s in word["senses"]
                if s["sense_id"] == sense_id
            )
            for field in ("definition_en", "definition_uz"):
                replacement = patch.get("replace_" + field)
                assert new_sense[field] == (
                    replacement["text"] if replacement else old_sense[field]
                )
            t_patch = patch.get("replace_translation_uz")
            assert new_sense["translations"][0]["text"] == (
                t_patch["text"] if t_patch else old_sense["translations"][0]["text"]
            )
            c_patch = patch.get("replace_cefr")
            assert new_sense.get("cefr") == (
                c_patch["text"] if c_patch else old_sense.get("cefr")
            )
            assert new_sense["examples"] == old_sense["examples"]
            if (word["lemma"], sense_id) in expected_levels:
                assert new_sense["cefr"] == expected_levels[(word["lemma"], sense_id)]
        expected_collocations = {
            (value["text"], sense_id)
            for sense_id, patch in edits.items()
            for value in patch.get("add_collocations", [])
        }
        assert expected_collocations <= {
            (c["text"], c.get("sense_id")) for c in revised["collocations"]
        }
        assert revised["relations"] == frozen["relations"]
