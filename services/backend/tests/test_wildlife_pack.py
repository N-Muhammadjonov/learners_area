"""Wildlife pack is usable by every game, with stable source groups."""
import json
from pathlib import Path
from app.step21_vocab_batch import normalize_term, sense_key
from app.vocabulary_game_content import eligible_words, gap_prompt
from app.vocabulary_flashcard_batches import source_groups
from app.step19_vocab_games_port import GAMES, attempt_deck_limit

def test_wildlife_pack_all_game_eligibility():
    path = Path(__file__).resolve().parents[1] / "app" / "vocabulary_builtin_packs.json"
    pack = next(p for p in json.loads(path.read_text(encoding="utf-8")) if p["id"] == "wildlife")
    words = pack["words"]
    assert len(words) == len({sense_key(w) for w in words}) == 158
    assert all(w["translationUz"].strip() and w["definitionEn"].strip() and w["example"].strip() for w in words)
    imported = [{**w, "id": str(i), "term": normalize_term(w["term"]), "exampleSentence": w["example"]} for i, w in enumerate(words)]
    for game in GAMES:
        assert len(eligible_words(imported, game)) == 158, game
    assert all(gap_prompt(w) for w in imported)
    groups = source_groups()
    memberships = [groups[("wildlife", sense_key(w))] for w in words]
    assert sorted(x[2] for x in memberships) == list(range(158))
    assert len({x[0] for x in memberships}) == 9
    assert max(sum(x[0] == i for x in memberships) for i in range(9)) <= attempt_deck_limit("cards")
