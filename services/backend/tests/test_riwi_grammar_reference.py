import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock,patch
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import riwi_grammar_reference as g
from app.riwi_capabilities import RiwiActor
from app.riwi_knowledge import chunk_knowledge_text,collect_knowledge_conflicts,KnowledgeServiceError
from app.riwi_curriculum import is_library_text
from app.riwi_outbound_guard import redact_external_text

ID='11111111-1111-4111-8111-111111111111';CID='22222222-2222-4222-8222-222222222222'
ACTOR=RiwiActor(ID,'student')

def active_conn():
    async def row(sql,*args):
        if 's.checksum=$1' in sql:
            for kind in g.KINDS:
                if args[0]!=g.source_checksum(kind):continue
                e=next((r for r in g.records(kind) if g.digest(g.encode(r))==args[1]),None)
                if e:return {'source_id':ID,'unit_id':CID,'authority':75,'version':1,'content':g.encode(e)}
        return None
    return SimpleNamespace(fetchrow=AsyncMock(side_effect=row),fetchval=AsyncMock(return_value=False))

def test_book_inventory_and_governed_sources_are_complete_and_safe():
    assert len(g.library())==290 and len(g.pack()['support'])==12
    assert sum(len(e['examples']) for e in g.library().values())==870
    assert g.pack()['source']['sha256']=='29bc917a2c5fb6e42696a4aa037eaa86b988ce4825f644ef957126f2baf7f86c'
    assert sum(len(r['rows']) for r in g.pack()['support'] if r['kind']=='verb_forms')==112
    assert sum(len(r['rows']) for r in g.pack()['support'] if r['kind']=='error_patterns')==25
    for kind in g.KINDS:
        text=g.source_content(kind);units=chunk_knowledge_text(text)
        assert len(units)==len(g.records(kind))<=160 and len(text)<200000
        assert redact_external_text(text,200000)==text
        assert all(is_library_text(u['text']) for u in units)

@pytest.mark.parametrize('entry',list(g.library().values()),ids=lambda e:e['id'])
@pytest.mark.parametrize('locale',['uz','en'])
def test_every_topic_has_three_bilingual_examples_and_neutral_output(entry,locale):
    assert g.choose_entry(entry['title'])==entry['id']
    answer=g.format_lesson({'entry':entry},'Tushuntir',locale)
    assert all(e['en'] in answer for e in entry['examples']) and len(answer)<5800
    if locale=='uz':assert all(e['uz'] in answer for e in entry['examples'])
    assert all(brand not in answer.lower() for brand in ('cambridge','guardian','pdf','manba:','source:','grammar with learners'))
    exercise=g.format_lesson({'entry':entry},'mashq ber',locale)
    assert all(e['uz'] in exercise for e in entry['examples']) and '✍️' in exercise

@pytest.mark.asyncio
async def test_reference_is_not_served_before_activation_or_outside_scope():
    assert await g.retrieve_lesson(None,ACTOR,'Negative inversion') is None
    conn=SimpleNamespace(fetchrow=AsyncMock(return_value=None))
    assert await g.retrieve_lesson(conn,ACTOR,'Negative inversion') is None
    sql,*args=conn.fetchrow.call_args.args
    assert "s.state='active'" in sql and 's.checksum=$1' in sql and 'u.content_hash=$2' in sql
    assert 's.scope_user_id=$4::uuid' in sql and args[-2:]==['student',ID]
    conn.fetchrow.return_value={'source_id':ID,'unit_id':CID,'content':'changed'}
    assert await g.retrieve_lesson(conn,ACTOR,'Negative inversion') is None

@pytest.mark.asyncio
async def test_supported_reference_teaches_niche_topic_without_replacing_core():
    conn=active_conn()
    r=await g.retrieve_lesson(conn,ACTOR,'Negative inversionni tushuntir')
    assert r['referenceId']=='grammar.reference.150'
    assert await g.retrieve_lesson(conn,ACTOR,'Present perfect') is None
    r=await g.retrieve_lesson(conn,ACTOR,'deontik epistemik farq nima')
    assert r['referenceId']=='grammar.reference.185'

@pytest.mark.asyncio
async def test_example_translation_and_error_correction_require_their_own_active_units():
    conn=active_conn()
    r=await g.translate_example(conn,ACTOR,'Only after she explained did I understand.')
    assert 'tushundim' in r['translation']
    assert await g.translate_example(None,ACTOR,'Only after she explained did I understand.') is None
    assert await g.translate_example(conn,ACTOR,'Only after she explain did I understand.') is None
    check={'original':'I am agree.','corrected':'I am agree.','reasons':[],'topic':'grammar.error_correction'}
    assert (await g.correction_example(conn,ACTOR,check))['corrected']=='I agree.'
    assert await g.correction_example(None,ACTOR,check)==check
    assert (await g.lookup_term(conn,ACTOR,'finite','en'))['provenance']=='deterministic_learning_data'

@pytest.mark.asyncio
async def test_verb_forms_and_tense_table_use_active_support_units():
    conn=active_conn()
    assert 'written' in (await g.answer_support(conn,ACTOR,'writening v2 v3 nima','uz'))['answer']
    assert 'lied' in (await g.answer_support(conn,ACTOR,'lie v2 v3 nima','en'))['answer']
    assert 'morphological' in (await g.answer_support(conn,ACTOR,'12 tense table','en'))['answer']
    assert await g.answer_support(None,ACTOR,'go v2 v3 nima','uz') is None

@pytest.mark.asyncio
async def test_gateway_and_translation_use_the_reference_without_external_ai():
    from app.riwi_gateway import handle_riwi_chat
    from app.riwi_understanding import explain_request
    conn=active_conn()
    unit=await g.retrieve_lesson(conn,ACTOR,'Negative inversion')
    with patch('app.riwi_grammar_reference.retrieve_lesson',AsyncMock(return_value=unit)):
        result=await handle_riwi_chat(None,ACTOR,{'message':'Negative inversion nima?'},env={})
    assert result['provider']['model']==g.MODEL_PREFIX+'grammar.reference.150'
    broker=SimpleNamespace(execute=AsyncMock(side_effect=AssertionError('dictionary not needed')))
    result=await explain_request(conn,ACTOR,'Tarjima qil: Only after she explained did I understand.','uz',broker)
    assert 'tushundim' in result['answer'] and result['citations']
    broker.execute.assert_not_awaited()

def test_conflict_capacity_remains_bounded_and_overlap_semantics_are_preserved():
    active=[{'sourceId':'s','unitId':str(i),'text':'A unique unrelated word '+str(i)} for i in range(665)]
    assert collect_knowledge_conflicts([{'id':'new','text':'Nothing shares these terms'}],active)==[]
    with pytest.raises(KnowledgeServiceError,match='analysis_capacity_exceeded'):
        collect_knowledge_conflicts([],active*2)
    found=collect_knowledge_conflicts([{'id':'new','text':'Clear useful learning rules practice'}],[{'sourceId':'s','unitId':'u','text':'Clear useful learning rules practice today'}])
    assert len(found)==1
