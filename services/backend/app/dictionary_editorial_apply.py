"""Apply checked editorial batches to a decoded dictionary release JSONL export."""

import argparse
import hashlib
import json
import os
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import UUID, uuid5


LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2"}
CYRILLIC = re.compile(r"[\u0400-\u052f\u2de0-\u2dff\ua640-\ua69f]")


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def validated_text(text, uz=False):
    if not isinstance(text, str) or not 0 < len(text.strip()) <= 6000:
        raise ValueError("Invalid editorial text")
    if uz and CYRILLIC.search(text):
        raise ValueError("Expected an Uzbek Latin-script field")
    return text.strip()


def translations(sense_id, values, original):
    if not isinstance(values, list) or not 1 <= len(values) <= 50:
        raise ValueError(f"Invalid translation list for {sense_id}")
    phrases = [validated_text(value, uz=True) for value in values]
    if len({phrase.casefold() for phrase in phrases}) != len(phrases):
        raise ValueError(f"Duplicate translation for {sense_id}")
    return [
        {
            "translation_id": original[order]["translation_id"] if order < len(original)
            else str(uuid5(UUID(sense_id), f"editorial:translation:{order}")),
            "text": phrase,
            "order": order,
        }
        for order, phrase in enumerate(phrases)
    ]


def apply_fields(entry, sense, change):
    sense_id = sense["sense_id"]
    if "cefr" in change:
        level = change["cefr"]
        if level is None:
            sense.pop("cefr", None)
        elif level in LEVELS:
            sense["cefr"] = level
        else:
            raise ValueError(f"Invalid CEFR level for {sense_id}")
    if "definition_uz" in change:
        sense["definition_uz"] = validated_text(change["definition_uz"], uz=True)
    if "translations_uz" in change:
        sense["translations"] = translations(sense_id, change["translations_uz"], sense["translations"])

    collocations = entry["collocations"]
    existing = {(item.get("sense_id"), item["text"].casefold()) for item in collocations}
    for value in change.get("add_collocations", []):
        phrase = validated_text(value["text"])
        pattern = value["pattern_type"]
        if pattern not in {"collocation", "usage_frame"}:
            raise ValueError(f"Invalid collocation pattern for {sense_id}")
        key = (sense_id, phrase.casefold())
        if key not in existing:
            collocations.append({"sense_id": sense_id, "text": phrase, "pattern_type": pattern})
            existing.add(key)


def apply_entry(entry, change):
    key = entry["lexeme_id"]
    if (entry["display_lemma"] != change["lemma"]
            or entry["part_of_speech"] != change["part_of_speech"]
            or digest(entry) != change["expected_sha256"]):
        raise ValueError(f"Base entry changed for {key}")

    senses = {sense["sense_id"]: sense for sense in entry["senses"]}
    if len(senses) != len(entry["senses"]):
        raise ValueError(f"Duplicate sense ID in base entry {key}")
    for edit in change["edits"]:
        apply_fields(entry, senses[edit["sense_id"]], edit)

    definitions = {sense["definition_en"].strip().casefold() for sense in senses.values()}
    for addition in change["added_senses"]:
        sense_id = addition["sense_id"]
        definition = validated_text(addition["definition_en"])
        if sense_id in senses or definition.casefold() in definitions:
            raise ValueError(f"Duplicate new sense {sense_id} for {key}")
        sense = {
            "sense_id": sense_id,
            "definition_en": definition,
            "translations": [],
            "examples": [{
                "example_id": str(uuid5(UUID(sense_id), "editorial:example:0")),
                "text_en": validated_text(addition["example_en"]),
                "text_uz": validated_text(addition["example_uz"], uz=True),
            }],
        }
        if "register" in addition:
            sense["register"] = addition["register"]
        apply_fields(entry, sense, addition)
        entry["senses"].append(sense)
        senses[sense_id] = sense
        definitions.add(definition.casefold())

    if len(senses) > 300:
        raise ValueError(f"Too many senses for {key}")
    return entry


def apply_batches(source_path, batch_paths, result_path):
    pending = {}
    base_release = None
    for batch_path in batch_paths:
        batch = json.loads(batch_path.read_text(encoding="utf-8"))
        if batch.get("schema_version") != 1:
            raise ValueError("Unsupported editorial batch version")
        if base_release is None:
            base_release = batch["base_release_id"]
        elif base_release != batch["base_release_id"]:
            raise ValueError("Editorial batches have different base releases")
        for row in batch["entries"]:
            key = row["lexeme_id"]
            if key in pending:
                raise ValueError(f"Duplicate lexeme in editorial batches: {key}")
            pending[key] = row
    if base_release is None:
        raise ValueError("Expected at least one editorial batch")
    target_ids = set(pending)

    with TemporaryDirectory(dir=result_path.parent) as temp_dir:
        candidate = Path(temp_dir) / "release.jsonl"
        with source_path.open(encoding="utf-8") as source, candidate.open("w", encoding="utf-8") as out:
            for number, line in enumerate(source, 1):
                entry = json.loads(line)
                if entry["release_id"] != base_release:
                    raise ValueError(f"Unexpected release ID on line {number}")
                key = entry["lexeme_id"]
                if key in target_ids:
                    if key not in pending:
                        raise ValueError(f"Repeated target entry {key}")
                    entry = apply_entry(entry, pending.pop(key))
                    line = canonical_json(entry) + "\n"
                out.write(line if line.endswith("\n") else line + "\n")
        if pending:
            raise ValueError(f"Missing target entries: {', '.join(sorted(pending))}")
        os.link(candidate, result_path)


def apply_batch(source_path, batch_path, result_path):
    apply_batches(source_path, [batch_path], result_path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Decoded JSONL for the batch's base release")
    parser.add_argument("batches", type=Path, nargs="+", help="Editorial batch JSON files with the same base release")
    parser.add_argument("output", type=Path, help="New JSONL file")
    args = parser.parse_args()
    apply_batches(args.source, args.batches, args.output)


if __name__ == "__main__":
    main()
