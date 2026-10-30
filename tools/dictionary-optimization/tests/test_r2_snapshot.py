import asyncio
import importlib.util
from pathlib import Path
import pytest
from app import step39_dictionary_publish as publish

path=Path(__file__).resolve().parents[3]/'tools/dictionary-optimization/scripts/verify_r2_snapshot.py'
spec=importlib.util.spec_from_file_location('r2_snapshot',path)
snapshot=importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)

def records():
    return [{'lexeme_id':f'00000000-0000-4000-8000-{i:012}',
             'content_sha':str(i)*64,'sense_ids':[f'10000000-0000-4000-8000-{i:012}'],
             'example_ids':[f'20000000-0000-4000-8000-{i:012}']} for i in [2,1]]

class Projection:
    async def fetch(self,sql,*args):
        return sorted(records(),key=lambda r:r['lexeme_id']) if 'dictionary_entries' in sql else []
    async def fetchval(self,sql,*args):
        return {'logicalTerms':2} if 'dictionary_search_indexes' in sql else 0

def test_r2_identity_matches_native_release_manifest():
    actual=snapshot.identity(records())
    manifest=asyncio.run(publish.make_manifest(Projection(),'release'))
    assert actual['entries']==manifest['lexemes']
    for field in ['senses','examples','entry_inventory_sha256','sense_set_sha256','example_set_sha256']:
        assert actual[field]==manifest[field]

@pytest.mark.parametrize('field',['lexeme_id','sense_ids','example_ids'])
def test_snapshot_refuses_duplicate_projection_identities(field):
    rows=records();rows[1][field]=rows[0][field]
    with pytest.raises(ValueError,match='duplicate_identity'):snapshot.identity(rows)

def test_snapshot_require_is_a_runtime_guard():
    with pytest.raises(ValueError,match='corrupt_object'):snapshot.require(False,'corrupt_object')
