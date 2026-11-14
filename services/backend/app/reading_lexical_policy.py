"""Only source-exact Reading meanings with translations are displayed.

Pronouns are excluded from Reading vocabulary targets. This projection never
changes a stored meaning or any learner-owned vocabulary state.
"""
from __future__ import annotations

from collections.abc import Mapping

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
    return body[start:end].casefold() == surface.casefold()
