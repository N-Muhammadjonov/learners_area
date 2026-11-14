"""Regression guard: source-named flashcard groups must not fail attempt creation."""
from app.step19_vocab_games_port import attempt_deck_limit
from app.vocabulary_flashcard_batches import source_groups

def test_art_group_sizes_fit_flashcard_attempt_limit():
    groups = {}
    for (pack, _sense), (index, _label, _position) in source_groups().items():
        if pack == "art":
            groups[index] = groups.get(index, 0) + 1
    assert sorted(groups.values()) == sorted([24, 8, 31, 22, 27, 30, 33])
    assert max(groups.values()) <= attempt_deck_limit("cards")

def test_other_games_keep_the_existing_limit():
    for game in ("choice", "match", "gap", "race", "translation", "builder"):
        assert attempt_deck_limit(game) == 24

def test_larger_named_flashcard_batches_are_accepted_by_the_length_guard():
    for length in (10, 24, 31, 33):
        assert 1 <= length <= attempt_deck_limit("cards")
    assert 501 > attempt_deck_limit("cards")
