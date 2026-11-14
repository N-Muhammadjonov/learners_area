"""Only source-exact Reading meanings with translations are displayed.

Pronouns are excluded from Reading vocabulary targets. This projection never
changes a stored meaning or any learner-owned vocabulary state.
"""
from __future__ import annotations

from collections.abc import Mapping
import re

_READING_PRONOUNS: frozenset[str] = frozenset({
    "i","me","my","mine","myself","you","your","yours","yourself",
    "yourselves","he","him","his","himself","she","her","hers","herself",
    "it","its","itself","we","us","our","ours","ourselves","they","them",
    "their","theirs","themselves","who","whom","whose","someone",
    "somebody","everyone","everybody","anyone","anybody","nobody",
    "noone",
})

def is_verified_reading_gloss(body: str, row: Mapping[str, object]) -> bool:
    """Return True only for one source-positioned lexical sense with Uzbek text."""
    surface = row.get("surface_form")
    definition = row.get("definition_en")
    translation = row.get("translation_uz")
    start = row.get("start_char")
    end = row.get("end_char")
    if (
        not isinstance(body, str)
        or not isinstance(surface, str)
        or not surface.strip()
        or not isinstance(definition, str)
        or not definition.strip()
        or not isinstance(translation, str)
        or not translation.strip()
        or type(start) is not int
        or type(end) is not int
        or start < 0
        or end <= start
        or end > len(body)
    ):
        return False
    if surface.casefold().strip() in _READING_PRONOUNS:
        return False
    if body[start:end].casefold() != surface.casefold():
        return False
    # A substring of a different word is not a contextual binding: jar/jars,
    # or identical inside non-identical, must never share a source identity.
    def joined(index: int, direction: int) -> bool:
        if not 0 <= index < len(body):
            return False
        char = body[index]
        if re.match(r'[A-Za-z]', char):
            return True
        neighbor = index + direction
        return char in "'’\u2011-" and 0 <= neighbor < len(body) and bool(re.match(r'[A-Za-z]', body[neighbor]))
    return not (joined(start - 1, -1) or joined(end, 1))


def reading_glosses(body: str, rows: list[Mapping[str, object]]) -> list[Mapping[str, object]]:
    """Project disjoint authored spans; retain every stored ID and learner sense.

    Nested single-word rows remain available to saved vocabulary, while the
    reader opens the longest whole expression. Equal competing meanings fail
    closed rather than letting database row order choose a sense.
    """
    grouped: dict[tuple[int, int], list[Mapping[str, object]]] = {}
    for row in rows:
        if is_verified_reading_gloss(body, row):
            grouped.setdefault((row['start_char'], row['end_char']), []).append(row)
    candidates = []
    for matches in grouped.values():
        meanings = {(row.get('definition_en'), row.get('translation_uz'), row.get('part_of_speech')) for row in matches}
        if len(meanings) == 1:
            candidates.append(min(matches, key=lambda row: str(row['id'])))
    accepted = []
    for row in sorted(candidates, key=lambda row: (row['start_char'] - row['end_char'], row['start_char'], str(row['id']))):
        if not any(row['start_char'] < other['end_char'] and other['start_char'] < row['end_char'] for other in accepted):
            accepted.append(row)
    return sorted(accepted, key=lambda row: (row['start_char'], row['end_char']))


def paragraph_offsets(body: str, rows: list[Mapping[str, object]]) -> list[dict]:
    """Use paragraph order to distinguish repeated text without guessing a sense."""
    cursor = 0
    projected = []
    for row in rows:
        item = dict(row)
        text = row.get('text')
        if isinstance(text, str) and text:
            start = body.find(text, cursor)
            if start >= 0:
                item.update(start_char=start, end_char=start + len(text))
                cursor = start + len(text)
        projected.append(item)
    return projected
