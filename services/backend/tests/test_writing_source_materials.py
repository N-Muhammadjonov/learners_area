"""The removed Writing Real Exam source pack must stay absent.

Translation source materials remain available for the independent Translation module.
"""
import asyncio
from app import writing_source_materials as source

def test_exam_materials_deleted_but_translation_kept():
    assert source.DATA['prompts'] == []
    assert source.DATA['fullTests'] == []
    assert len(source.DATA['translations']) == 57
    assert source.PROMPTS == {}
    assert source.FULL_TESTS == {}
    assert source.GRAPHS == {}
    assert source.graph_bytes('writing-source-graphs/A01.png') is None

def test_source_inventory_is_empty_even_if_other_prompts_exist():
    class Conn:
        async def fetch(self, sql, *args):
            assert args[0] == []
            return []
    inventory = asyncio.run(source.live_inventory(Conn()))
    assert inventory == {}
    assert source.catalogue(inventory) == {'fullTests': [], 'task1': [], 'task2': []}
    assert source.metadata_for_prompt({'id': 'no-such-source'}) is None

def test_translation_source_does_not_restore_exam_tests():
    assert all(t['taskType'] == 'task2' for t in source.DATA['translations'])
    assert all(t.get('modelEnglish') for t in source.DATA['translations'])
    assert not any(t.get('promptIds') for t in source.DATA['fullTests'])
