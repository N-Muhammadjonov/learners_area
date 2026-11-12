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
            if not (target.get("lexemeId") and target.get("senseId") and target.get("text")):
                raise ValueError("dictionary_semantic_relation_target_missing")
            record = {
                "display_lemma": target["text"],
                "lexical_type": "word",
                "part_of_speech": target.get("partOfSpeech", "n"),
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


def curate_candidate_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Return a deep-copied canonical candidate; never change the source."""
    curated = copy.deepcopy(entry)
    data = load_corrections()
    if entry.get("release_id") != data["source_release"]:
        return curated
    patches = data["entries"].get(entry["lexeme_id"], {})
    if not patches:
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
    return curated
