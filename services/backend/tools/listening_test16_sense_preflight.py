"""Fail-closed Test 16 transcript-to-dictionary editorial preflight.

No dictionary sense is ever selected by orthography or suffix alone. This
validator accepts a fully explicit editorial plan and verifies transcript
offsets and grammatical choices BEFORE dictionary_context applies its
release/hash/owner safeguards. It does not write to production databases.
"""
import hashlib
import json
import re
from pathlib import Path

TEST = "listening-test-16"
RUNTIME = Path(__file__).resolve().parents[1] / "assets/listening/test-16.json"
WORD = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?(?:-[A-Za-z]+)*")


def transcript_parts():
    source = json.loads(RUNTIME.read_text())["files"]["source.html"]
    marker = "const DATA="
    start = source.index(marker) + len(marker)
    data = json.loads(source[start:source.index(";\n", start)])
    assert data["test_id"] == TEST
    return {int(part): text for part, text in data["transcript"].items()}


def preflight(records):
    """Returns True or raises ValueError; never guesses grammatical category.

    Each explicit candidate must carry a dictionary entryId, senseId,
    partOfSpeech and meaningSha checked against the active release separately.
    """
    parts = transcript_parts()
    ordered = {part: [] for part in parts}
    for record in records:
        part = record.get("part")
        if type(part) is not int or part not in parts:
            raise ValueError("part_invalid")
        start, end, surface = record.get("start"), record.get("end"), record.get("surface")
        if type(start) is not int or type(end) is not int or not isinstance(surface, str):
            raise ValueError("span_invalid")
        text = parts[part]
        if start < 0 or end <= start or end > len(text) or text[start:end] != surface:
            raise ValueError("span_mismatch")
        if start and text[start - 1].isalpha() or end < len(text) and text[end].isalpha():
            raise ValueError("partial_word")
        if not all(record.get(x) for x in ("entryId", "senseId", "meaningSha", "partOfSpeech", "lemma")):
            raise ValueError("dictionary_sense_unverified")
        if record.get("grammaticalUse") not in ("verb", "adjective", "noun", "adverb", "other"):
            raise ValueError("grammatical_use_required")
        if surface.casefold().endswith(("ed", "ing")) and record.get("grammaticalUse") == "adjective" and record["partOfSpeech"] not in ("a", "adjective"):
            raise ValueError("adjective_cannot_be_verb_lemma")
        if record["grammaticalUse"] == "verb" and record["partOfSpeech"] not in ("v", "verb"):
            raise ValueError("verb_requires_verb_sense")
        if record.get("unitType") == "collocation" and not record.get("lexicographicSource"):
            raise ValueError("collocation_requires_attestation")
        ordered[part].append((start, end))
    for spans in ordered.values():
        spans.sort()
        if any(a[1] > b[0] for a, b in zip(spans, spans[1:])):
            raise ValueError("overlapping_senses")
    return True
