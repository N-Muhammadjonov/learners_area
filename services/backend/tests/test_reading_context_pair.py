import copy
import hashlib
import importlib.util
from pathlib import Path

import pytest

path = Path(__file__).resolve().parents[3] / 'scripts/reading_context_pair.py'
spec = importlib.util.spec_from_file_location('reading_pair', path)
pair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pair)


def fixture():
    sources, passages = [], []
    for digit in ('1', '2'):
        pid = digit * 8 + '-1111-4111-8111-' + digit * 12
        body = 'They find out.'
        sources.append({'id': pid, 'body_text': body, 'occurrences': []})
        passages.append({'id': pid, 'sourceSha256': hashlib.sha256(body.encode()).hexdigest(),
                         'unknown': [], 'entries': [{'start': 5, 'end': 13, 'surface': 'find out',
                         'term': 'find out', 'partOfSpeech': 'phrasal verb',
                         'definitionEn': 'discover information', 'translationUz': 'bilib olmoq'}]})
    return {'version': 1, 'release': 'synthetic-pair', 'passages': passages}, sources


def test_existing_id_is_retained_but_shared_meaning_is_not_reused():
    plan, sources = fixture()
    old_id = '33333333-3333-4333-8333-333333333333'
    old_lexeme = '44444444-4444-4444-8444-444444444444'
    sources[0]['occurrences'] = [{'start_char': 5, 'end_char': 13, 'id': old_id,
                                 'lexeme_id': old_lexeme, 'surface_form': 'find out'}]
    result = pair.prepare(plan, sources)
    entry = result['passages'][0]['entries'][0]
    assert entry['id'] == old_id and entry['oldLexemeId'] == old_lexeme
    assert entry['lexemeId'] != old_lexeme and entry['target'] is True
    assert result == pair.prepare(plan, sources)
    assert result['passages'][0]['entries'][0]['lexemeId'] != result['passages'][1]['entries'][0]['lexemeId']


@pytest.mark.parametrize('mutation', ['third-passage', 'different-body', 'bad-offset', 'empty-meaning', 'duplicate-span', 'unknown'])
def test_incomplete_or_changed_review_is_rejected(mutation):
    plan, sources = fixture()
    if mutation == 'third-passage':
        plan['passages'].append(copy.deepcopy(plan['passages'][0]))
    elif mutation == 'different-body':
        sources[1]['body_text'] += ' Changed.'
    elif mutation == 'bad-offset':
        plan['passages'][0]['entries'][0]['start'] = True
    elif mutation == 'empty-meaning':
        plan['passages'][0]['entries'][0]['translationUz'] = ' '
    elif mutation == 'duplicate-span':
        plan['passages'][0]['entries'] *= 2
    else:
        plan['passages'][0]['unknown'] = ['unreviewed']
    with pytest.raises(ValueError):
        pair.prepare(plan, sources)


def test_auxiliary_pronoun_metadata_and_country_remain_distinct():
    plan, sources = fixture()
    plan['passages'][0]['entries'][0]['partOfSpeech'] = 'relative pronoun'
    assert pair.prepare(plan, sources)['passages'][0]['entries'][0]['target'] is False
    sql = pair.build_sql(pair.prepare(plan, sources), rollback=True)
    assert sql.endswith('ROLLBACK;\n')
    assert 'reading_pair_source_changed' in sql
    assert 'reading_pair_previous_binding_changed' in sql
    assert 'before_users IS DISTINCT FROM after_users' in sql
    assert 'before_lexemes IS DISTINCT FROM after_lexemes' in sql
    assert 'UPDATE public.lexemes' not in sql and 'UPDATE public.user_vocabulary' not in sql
