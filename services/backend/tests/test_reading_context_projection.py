from app.reading_lexical_policy import paragraph_offsets, reading_glosses, is_verified_reading_gloss, is_reading_pronoun


def row(id, start, surface, translation='bilib olmoq'):
    return dict(id=id, start_char=start, end_char=start+len(surface), surface_form=surface,
                definition_en='discover information', translation_uz=translation, part_of_speech='verb')


def test_longest_phrase_is_one_disjoint_projection_and_legacy_rows_are_unchanged():
    body='They find out a fact.'
    rows=[row('short',5,'find'),row('phrase',5,'find out'),row('particle',10,'out')]
    assert [item['id'] for item in reading_glosses(body,rows)]==['phrase']
    assert len(rows)==3 and rows[0]['surface_form']=='find'


def test_equal_conflicting_source_meanings_are_not_chosen_by_row_order():
    body='find out'
    first=row('one',0,body);other=row('two',0,body,'aniqlamoq')
    assert reading_glosses(body,[first,other])==[]
    assert reading_glosses(body,[other,first])==[]
    assert [r['id'] for r in reading_glosses(body,[first,{**first,'id':'duplicate'}])]==['duplicate']


def test_word_boundaries_refuse_opposite_compound_and_partial_plural_but_accept_quotes():
    assert not is_verified_reading_gloss('non-identical twins',row('bad',4,'identical twins'))
    assert not is_verified_reading_gloss('jars',row('bad',0,'jar'))
    assert is_verified_reading_gloss("'find out', she said.",row('good',1,'find out'))


def test_ordered_repeated_paragraphs_keep_distinct_absolute_offsets():
    body='Clan\n\nA clan\n\nClan'
    rows=[{'id':'first','text':'Clan'},{'id':'middle','text':'A clan'},{'id':'last','text':'Clan'}]
    assert [r['start_char'] for r in paragraph_offsets(body,rows)]==[0,6,14]
    assert 'start_char' not in rows[0]


def test_country_us_and_contextual_determiners_are_not_personal_pronouns():
    assert not is_reading_pronoun('US','proper noun')
    assert is_reading_pronoun('us')
    assert is_reading_pronoun("It's")
    assert is_reading_pronoun('which','relative pronoun')
    assert not is_reading_pronoun('which','determiner')
    assert not is_reading_pronoun('A','proper noun')
