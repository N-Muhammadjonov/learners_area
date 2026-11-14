import importlib.util
from pathlib import Path
import pytest

path=Path(__file__).resolve().parents[3]/'scripts/reading_context_repair.py'
spec=importlib.util.spec_from_file_location('reading_repair',path)
repair=importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


def manifest():
    return {'version':1,'release':'test-only','changes':[{
        'id':'11111111-1111-4111-8111-111111111111','passageId':'22222222-2222-4222-8222-222222222222',
        'lexemeId':'33333333-3333-4333-8333-333333333333','oldStart':1,'oldEnd':5,'start':10,'end':14,
        'surface':'test','sourceSha256':'a'*64}]}


def test_repair_sql_guards_source_identity_and_learner_state():
    sql=repair.build_sql(manifest(),rollback=True)
    assert sql.endswith('ROLLBACK;\n')
    assert 'reading_source_checksum_changed' in sql
    assert 'reading_repair_occurrence_changed' in sql
    assert 'before_users IS DISTINCT FROM after_users' in sql
    assert 'UPDATE public.lexical_occurrences' in sql
    assert 'UPDATE public.user_vocabulary' not in sql
    assert 'UPDATE public.lexemes' not in sql


def test_repair_rejects_duplicate_identity_and_noninteger_offsets():
    value=manifest();value['changes']*=2
    with pytest.raises(ValueError,match='Duplicate'):
        repair.build_sql(value)
    value=manifest();value['changes'][0]['start']=True
    with pytest.raises(ValueError,match='offset'):
        repair.build_sql(value)
