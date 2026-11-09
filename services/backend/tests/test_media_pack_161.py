"""Media vocabulary: 161 source entries, seven distinct flashcard topics, and game set links."""
import json
from pathlib import Path
from app.step21_vocab_batch import sense_key
from app.vocabulary_flashcard_batches import source_groups, named_parts, batch_plan

APP = Path(__file__).resolve().parents[1] / "app"

def media_content():
    packs = json.loads((APP / "vocabulary_builtin_packs.json").read_text(encoding="utf-8"))
    return next(p for p in packs if p["id"] == "media")["words"]

def media_groups():
    return json.loads((APP / "vocabulary_pack_groups.json").read_text(encoding="utf-8"))["media"]

def test_media_pack_all_161_have_valid_fields_and_no_duplicates():
    words = media_content()
    assert len(words) == 161
    assert words[0]["term"] == "mass media"
    assert words[-1]["term"] == "rethink something"
    assert len({w["term"].casefold().strip() for w in words}) == 161
    for word in words:
        assert set(word) == {"term", "partOfSpeech", "definitionEn", "translationUz", "example"}
        assert all(isinstance(word[field], str) and word[field].strip() for field in word)
        assert len(word["term"]) <= 120
        assert len(word["definitionEn"]) <= 500
        assert len(word["translationUz"]) <= 500
        assert len(word["example"]) <= 500

def test_media_categories_cover_all_words_in_source_order():
    words = media_content()
    groups = media_groups()
    assert len(groups) == 7
    expected_counts = [22, 12, 19, 24, 36, 28, 20]
    assert [g["end"] - g["start"] for g in groups] == expected_counts
    assert groups[0]["start"] == 0 and groups[-1]["end"] == len(words)
    for previous, next_group in zip(groups, groups[1:]):
        assert previous["end"] == next_group["start"]
    assert len({g["label"] for g in groups}) == 7

def test_media_flashcard_groups_and_topic_game_set_use_canonical_senses():
    words = media_content()
    groups = media_groups()
    source_groups.cache_clear()
    lookup = source_groups()
    entries = []
    for i, word in enumerate(words):
        found = lookup.get(("media", sense_key(word)))
        assert found is not None, f"Missing flashcard topic for ${word['term']}"
        index, label, position = found
        group = groups[index]
        assert group["label"] == label
        assert position == i
        assert group["start"] <= i < group["end"]
        entries.append({"id":str(i + 1), "topic_pack":"media",
            "sense_key":sense_key(word), "term":word["term"],
            "part_of_speech":word["partOfSpeech"], "definition_en":word["definitionEn"]})
    parts = named_parts(entries)
    assert [label for label, _ in parts] == [g["label"] for g in groups]
    ids = [word_id for _, part in parts for word_id in part]
    assert ids == [str(i + 1) for i in range(161)]
    batches = batch_plan(ids, {}, parts)
    assert len(batches) == 7
    assert sum(b["count"] for b in batches) == 161
    assert batches[0]["unlocked"]
    assert all(not b["unlocked"] for b in batches[1:])
