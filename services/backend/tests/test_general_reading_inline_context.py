"""General Reading must display only exact, editorially defined passage senses."""
from app.reading_lexical_policy import is_verified_reading_gloss

BODY = "The jars stood near Caral. A strong jar was useful."


def gloss(surface: str, start: int, definition: str = "a glass container",
          translation: str = "shisha banka", pos: str = "noun") -> dict:
    return {
        "surface_form": surface,
        "start_char": start,
        "end_char": start + len(surface),
        "definition_en": definition,
        "translation_uz": translation,
        "part_of_speech": pos,
    }


def test_source_exact_contextual_meaning_is_admitted() -> None:
    assert is_verified_reading_gloss(BODY, gloss("jars", 4))


def test_rejects_unchecked_spelling_and_wrong_absolute_offset() -> None:
    assert not is_verified_reading_gloss(BODY, gloss("jars", 0))
    assert not is_verified_reading_gloss(BODY, gloss("jar", 4))
    assert not is_verified_reading_gloss(BODY, gloss("jars", -1))
    assert not is_verified_reading_gloss(BODY, gloss("jars", len(BODY)))


def test_refuses_ambiguous_or_missing_passage_definition() -> None:
    assert not is_verified_reading_gloss(BODY, gloss("jars", 4, definition=""))
    assert not is_verified_reading_gloss(BODY, gloss("jars", 4, translation=""))
    assert not is_verified_reading_gloss(BODY, gloss("jars", 4, pos="proper noun"))
    assert not is_verified_reading_gloss(BODY, gloss("jars", True))


def test_person_and_place_names_are_not_vocabulary_targets() -> None:
    assert not is_verified_reading_gloss(BODY, gloss("Caral area", 20))
    assert not is_verified_reading_gloss("The Roman Empire expanded", gloss("Roman Empire", 4))
    assert not is_verified_reading_gloss("A city near the Mediterranean",
        gloss("Mediterranean", 16))
