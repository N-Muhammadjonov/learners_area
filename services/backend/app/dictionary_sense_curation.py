"""Apply verified, exact-sense dictionary edits to an unpublished candidate copy.

This module does not mutate the active release, database, R2 or examples.
The publishing pipeline must regenerate all checksums and indexes separately.
"""
from __future__ import annotations

import copy
import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from .dictionary_canonical import stable

CORRECTIONS_PATH = (
    Path(__file__).resolve().parents[1] / "assets/dictionary/sense_corrections.json"
)
VALID_CEFR = frozenset({"A1", "A2", "B1", "B2", "C1", "C2"})
PHASE09_FIRST_LEXEME = "6568847e-1b29-5ff7-b104-60393188df8e"
PHASE09_LAST_LEXEME = "726f905d-3146-56a5-9234-e7522f7651ce"


@lru_cache(maxsize=1)
def load_corrections() -> dict[str, Any]:
    """Read versioned metadata with no external writes."""
    data = json.loads(CORRECTIONS_PATH.read_text(encoding="utf-8"))
    if data.get("schema") != 1 or not isinstance(data.get("entries"), dict):
        raise ValueError("dictionary_semantic_corrections_invalid")
    return data


def original_meaning_hash(entry: dict[str, Any], sense: dict[str, Any]) -> str:
    """Hash the unchanged source sense before applying an editorial edit."""
    payload = {
        "lemma": entry["display_lemma"],
        "pos": entry["part_of_speech"],
        "definition": sense["definition_en"],
    }
    return hashlib.sha256(stable(payload).encode("utf-8")).hexdigest()


def _replace_text(record: dict[str, Any], field: str, edit: dict[str, Any]) -> None:
    original = edit.get("original")
    replacement = edit.get("text")
    if record.get(field) != original or not isinstance(replacement, str) or not replacement.strip():
        raise ValueError("dictionary_semantic_source_mismatch")
    record[field] = replacement


def _update_sense(sense: dict[str, Any], patch: dict[str, Any]) -> None:
    if definition := patch.get("replace_definition_en"):
        _replace_text(sense, "definition_en", definition)
    if definition_uz := patch.get("replace_definition_uz"):
        _replace_text(sense, "definition_uz", definition_uz)
    if translation := patch.get("replace_translation_uz"):
        translations = sense.get("translations", [])
        if not translations:
            raise ValueError("dictionary_semantic_translation_missing")
        _replace_text(translations[0], "text", translation)
    if cefr := patch.get("replace_cefr"):
        if sense.get("cefr") != cefr.get("original"):
            raise ValueError("dictionary_semantic_cefr_mismatch")
        level = cefr.get("text")
        if level is not None and level not in VALID_CEFR:
            raise ValueError("dictionary_semantic_cefr_invalid")
        if level is None:
            sense.pop("cefr", None)
        else:
            sense["cefr"] = level


def _update_relations(
    entry: dict[str, Any],
    sense_id: str,
    patch: dict[str, Any],
) -> None:
    senses = entry["senses"]
    for relation_type in ("synonym", "antonym"):
        # A reviewed scope operation identifies one existing edge by both target
        # IDs. Never infer its source meaning from the lemma or target alone.
        for target in patch.get(f"scope_{relation_type}s", []):
            if not all(target.get(key) for key in ("lexemeId", "senseId", "text", "partOfSpeech")):
                raise ValueError("dictionary_semantic_relation_target_missing")
            matches = [
                relation for relation in entry["relations"]
                if relation["relation_type"] == relation_type
                and relation["target_lexeme_id"] == target["lexemeId"]
                and relation.get("target_sense_id") == target["senseId"]
            ]
            if len(matches) != 1 or (
                matches[0].get("source_sense_id") not in (None, sense_id)
                or matches[0]["display_lemma"] != target["text"]
                or matches[0]["part_of_speech"] != target["partOfSpeech"]
            ):
                raise ValueError("dictionary_semantic_relation_scope_mismatch")
            matches[0]["source_sense_id"] = sense_id

        excluded = set(patch.get(f"remove_{relation_type}_lexeme_ids", []))
        if excluded:
            if len(senses) != 1:
                raise ValueError("dictionary_semantic_unscoped_relation_unsafe")
            entry["relations"] = [
                relation for relation in entry["relations"]
                if not (
                    relation["relation_type"] == relation_type
                    and relation["target_lexeme_id"] in excluded
                )
            ]

        for target in patch.get(f"add_{relation_type}s", []):
            if not all(target.get(key) for key in ("lexemeId", "senseId", "text", "partOfSpeech")):
                raise ValueError("dictionary_semantic_relation_target_missing")
            record = {
                "display_lemma": target["text"],
                "lexical_type": "word",
                "part_of_speech": target["partOfSpeech"],
                "relation_type": relation_type,
                "source_sense_id": sense_id,
                "target_lexeme_id": target["lexemeId"],
                "target_sense_id": target["senseId"],
            }
            if not any(
                item["relation_type"] == relation_type
                and item.get("source_sense_id") == sense_id
                and item["target_lexeme_id"] == record["target_lexeme_id"]
                and item.get("target_sense_id") == record["target_sense_id"]
                for item in entry["relations"]
            ):
                entry["relations"].append(record)

    for collocation in patch.get("add_collocations", []):
        value = collocation.get("text")
        if not isinstance(value, str) or not value.strip():
            raise ValueError("dictionary_semantic_collocation_invalid")
        if not any(
            item["text"].casefold() == value.casefold()
            and item.get("sense_id") == sense_id
            for item in entry["collocations"]
        ):
            entry["collocations"].append({"text": value, "sense_id": sense_id})




def exclude_misattributed_senses(
    original: dict[str, Any],
    curated: dict[str, Any],
    patches: dict[str, Any],
) -> None:
    """Exclude independently disproven senses from a future candidate copy only.

    Preserve the remaining sense and example objects unchanged, and never
    reassign ambiguous unscoped relations to a different sense.
    """
    exclusions: set[str] = set()
    for sense in original["senses"]:
        correction = patches.get(sense["sense_id"], {}).get("exclude_misattributed_sense")
        if correction is None:
            continue
        if not isinstance(correction, dict) or (
            correction.get("original_definition_en") != sense["definition_en"]
            or not correction.get("reason")
        ):
            raise ValueError("dictionary_semantic_exclusion_source_mismatch")
        exclusions.add(sense["sense_id"])

    if not exclusions:
        return
    retained = [
        sense for sense in curated["senses"]
        if sense["sense_id"] not in exclusions
    ]
    if not retained:
        raise ValueError("dictionary_semantic_all_senses_excluded")
    curated["senses"] = retained
    curated["relations"] = [
        relation for relation in curated["relations"]
        if relation.get("source_sense_id") not in exclusions
    ]
    curated["collocations"] = [
        item for item in curated["collocations"]
        if item.get("sense_id") not in exclusions
    ]



def prune_excluded_target_relations(
    entry: dict[str, Any],
    all_patches: dict[str, Any],
) -> None:
    """Remove references to sense IDs excluded from the same candidate release."""
    excluded = {
        (lexeme_id, sense_id)
        for lexeme_id, senses in all_patches.items()
        for sense_id, change in senses.items()
        if change.get("exclude_misattributed_sense")
    }
    if excluded:
        entry["relations"] = [
            relation for relation in entry["relations"]
            if (relation["target_lexeme_id"], relation.get("target_sense_id"))
            not in excluded
        ]


def deduplicate_relations(entry: dict[str, Any]) -> None:
    """Remove repeated identical relation targets without collapsing distinct senses."""
    kept: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str | None, str | None]] = set()
    for relation in entry["relations"]:
        identity = (
            relation["relation_type"],
            relation["target_lexeme_id"],
            relation.get("target_sense_id"),
            relation.get("source_sense_id"),
        )
        if identity not in seen:
            kept.append(relation)
            seen.add(identity)
    entry["relations"] = kept

def curate_candidate_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Return a deep-copied canonical candidate; never change the source."""
    curated = copy.deepcopy(entry)
    data = load_corrections()
    if entry.get("release_id") != data["source_release"]:
        return curated
    patches = data["entries"].get(entry["lexeme_id"], {})
    in_phase09 = PHASE09_FIRST_LEXEME <= entry["lexeme_id"] <= PHASE09_LAST_LEXEME
    if not patches:
        prune_excluded_target_relations(curated, data["entries"])
        if in_phase09:
            deduplicate_relations(curated)
        return curated

    senses = {sense["sense_id"]: sense for sense in curated["senses"]}
    for sense_id, patch in patches.items():
        sense = senses.get(sense_id)
        if sense is None:
            raise ValueError("dictionary_semantic_sense_missing")
        if patch["meaning_sha"] != original_meaning_hash(entry, sense):
            raise ValueError("dictionary_semantic_meaning_sha_mismatch")
        _update_sense(sense, patch)
        _update_relations(curated, sense_id, patch)
    exclude_misattributed_senses(entry, curated, patches)
    prune_excluded_target_relations(curated, data["entries"])
    deduplicate_relations(curated)
    return curated
