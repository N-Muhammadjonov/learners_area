"""Eligibility holds incomplete authored items without changing saved vocabulary."""
import pytest
from app.vocabulary_game_content import eligible_words,gap_prompt

def word(id='one',term='run',definition='Move quickly.',example='We run daily.'):
    return {'id':id,'term':term,'definitionEn':definition,'exampleSentence':example}

@pytest.mark.parametrize('term,sentence,expected',[
    ('art','The artist studies art.','The artist studies ______.'),
    ('staple food','Rice is a staple food.','Rice is a ______.'),
    ('co-operate','We co-operate.','We ______.'),
    ('run','We RUN daily.','We ______ daily.'),
    ('art','The artist works.',None),
    ('run','',None),
])
def test_exact_source_gap(term,sentence,expected):
    assert gap_prompt(word(term=term,example=sentence))==expected

def test_duplicates_and_empty_meanings_do_not_form_ambiguous_choices():
    rows=[word(),word('two','RUN'),word('three','co-operate','Work together.'),
          word('four','co operate','Work together.'),word('five','empty','')]
    assert [w['id'] for w in eligible_words(rows,'choice')]==['one','three']

def test_ineligible_words_remain_available_to_appropriate_games_and_are_not_mutated():
    row=word(example='People move daily.');original=dict(row)
    assert eligible_words([row],'gap')==[]
    assert eligible_words([row],'cards')==[row]
    assert eligible_words([row],'builder')==[row]
    assert row==original

def test_translation_needs_authored_uzbek_and_builder_needs_more_than_one_tile():
    assert eligible_words([word()],'translation')==[]
    assert eligible_words([word(definition='Movement',example='')],'builder')==[]
