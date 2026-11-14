"""Scope the General Reading inline dictionary to verified, source-exact meanings.

Names of people, places, historical entities and named programmes are not
vocabulary targets.  This policy changes only the General Reading learning
projection; it never deletes a shared lexeme or a learner's saved vocabulary.
"""
from __future__ import annotations

from collections.abc import Mapping

_NON_VOCABULARY_NAMES: frozenset[str] = frozenset({
    "roman empire",
    "mediterranean",
    "european capital of culture",
    "caribbean",
    "portuguese",
    "heart of paris",
    "caral area",
    "arctic",
    "industrial revolution",
    "gordian knot",
    "gordian solution",
})


def is_verified_reading_gloss(body: str, row: Mapping[str, object]) -> bool:
    """Return True only for one source-positioned lexical sense with Uzbek text."""
    surface = row.get("surface_form")
    definition = row.get("definition_en")
    translation = row.get("translation_uz")
    start = row.get("start_char")
    end = row.get("end_char")
    pos = row.get("part_of_speech")
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
        or str(pos or "").strip().lower() == "proper noun"
    ):
        return False
    if surface.casefold().strip() in _NON_VOCABULARY_NAMES:
        return False
    return body[start:end].casefold() == surface.casefold()
