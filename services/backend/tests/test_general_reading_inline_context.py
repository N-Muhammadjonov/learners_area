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
    assert not is_verified_reading_gloss(BODY, gloss("jars", True))


def test_pronouns_never_receive_reading_glosses() -> None:
    for pronoun in ("he", "she", "it", "they", "we", "our", "his", "them"):
        assert not is_verified_reading_gloss(
            f"People saw {pronoun} there.", gloss(pronoun, 11)
        )


def test_source_verified_named_expression_can_be_linked() -> None:
    assert is_verified_reading_gloss(
        "The Roman Empire expanded", gloss("Roman Empire", 4, pos="proper noun")
    )
    assert not is_verified_reading_gloss(
        "The Roman Empire expanded", gloss("Roman Empire", 5, pos="proper noun")
    )
