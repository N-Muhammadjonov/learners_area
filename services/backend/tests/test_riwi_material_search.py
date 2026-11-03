"""Automatic selection is literal, bounded, actor-scoped and uncertainty-aware."""
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock,patch
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import riwi_material_search as s
from app.riwi_capabilities import RiwiActor

ID='11111111-1111-4111-8111-111111111111'
OTHER='22222222-2222-4222-8222-222222222222'
CID='33333333-3333-4333-8333-333333333333'
ACTOR=RiwiActor(ID,'student')

def conn(rows=(),metadata=None,exam=False):
    return SimpleNamespace(fetch=AsyncMock(return_value=list(rows)),fetchrow=AsyncMock(return_value=metadata),fetchval=AsyncMock(return_value=exam))


@pytest.mark.asyncio
async def test_reading_title_is_resolved_without_a_browser_reference():
    c=conn([{'id':OTHER,'title':'Wind farms'}])
    assert await s.resolve_material(c,ACTOR,'Readingdagi wind farms matnini tushuntir')=={'kind':'reading','id':OTHER}
    sql,*args=c.fetch.call_args.args
    assert "p.publication_state='published'" in sql and 'general_reading_sets' in sql
    assert 'unnest($3::text[])' in sql and 'LIMIT 61' in sql and 'strpos' in sql
    assert args[0:2]==[ID,'student'] and args[2]==['wind','farms']


@pytest.mark.asyncio
async def test_missing_and_tied_sources_ask_instead_of_guessing():
    empty=await s.resolve_material(conn(),ACTOR,'Listening test 99 transkriptini tushuntir')
    assert empty['clarification']=='name'
    tied=conn([{'id':OTHER,'title':'A beautiful object'},{'id':CID,'title':'A beautiful object'}])
    assert (await s.resolve_material(tied,ACTOR,'Speaking beautiful object namuna javobini tushuntir'))['clarification']=='ambiguous'


@pytest.mark.asyncio
async def test_generic_grammar_is_not_intercepted_by_material_lookup():
    c=conn()
    assert await s.resolve_material(c,ACTOR,'Readingda TRUE FALSE NOT GIVEN farqi nima?') is None
    assert await s.resolve_material(c,ACTOR,'Nominalizatsiya nima?') is None
    c.fetch.assert_not_awaited()


@pytest.mark.asyncio
async def test_active_exam_is_checked_before_any_candidate_query():
    c=conn(exam=True)
    with pytest.raises(PermissionError,match='active_exam_lookup_forbidden'):
        await s.resolve_material(c,ACTOR,'Readingdagi wind farms matnini tushuntir')
    c.fetch.assert_not_awaited()


@pytest.mark.asyncio
async def test_followup_uses_only_owned_live_conversation_material_metadata():
    reference={'kind':'speaking','id':OTHER}
    c=conn(metadata={'metadata':{'provider':{'model':'riwi-material-v1','material':reference}}})
    assert await s.resolve_material(c,ACTOR,'Shu matndagi gaplarni tushuntir',CID)==reference
    sql,*args=c.fetchrow.call_args.args
    assert 'c.user_id=$2::uuid' in sql and 'c.role_at_creation=$3::role' in sql
    assert 'c.deleted_at IS NULL' in sql and 'c.expires_at>now()' in sql and '7 days' in sql
    assert args==[CID,ID,'student'];c.fetch.assert_not_awaited()
    # A conversation reset supplies no ID and cannot recover the old source.
    c.fetchrow.reset_mock();assert (await s.resolve_material(c,ACTOR,'Shu matnni tushuntir'))['clarification']=='name'
    c.fetchrow.assert_not_awaited()


@pytest.mark.asyncio
async def test_different_named_material_does_not_reuse_previous_reference():
    c=conn([{'id':CID,'title':'Wind farms'}],{'metadata':{'provider':{'model':'riwi-material-v1','material':{'kind':'speaking','id':OTHER}}}})
    assert await s.resolve_material(c,ACTOR,'Readingdagi wind farms matnini tushuntir',CID)=={'kind':'reading','id':CID}


@pytest.mark.asyncio
async def test_pending_clarification_keeps_scope_without_trusting_external_provider_metadata():
    c=conn([{'id':OTHER,'title':'A beautiful object'}],{'metadata':{'provider':{'model':'riwi-material-resolution-v1','materialSearchKinds':['speaking','private-submissions']}}})
    assert await s.resolve_material(c,ACTOR,'A beautiful object',CID)=={'kind':'speaking','id':OTHER}
    c=conn(metadata={'metadata':{'provider':{'model':'external','material':{'kind':'speaking','id':OTHER}}}})
    assert (await s.resolve_material(c,ACTOR,'Shu matnni tushuntir',CID))['clarification']=='name'


@pytest.mark.asyncio
async def test_gateway_resolves_then_reuses_existing_final_source_access_gate():
    from app.riwi_gateway import handle_riwi_chat
    reference={'kind':'reading','id':OTHER}
    item={'id':OTHER,'kind':'reading','title':'Wind farms','text':'The writer discusses plans for wind energy. The plan is different from an achieved result.', 'contentHash':'a'*64}
    with patch('app.riwi_material_search.resolve_material',AsyncMock(return_value=reference)) as resolve, \
         patch('app.riwi_materials.read_material',AsyncMock(return_value=item)) as read:
        r=await handle_riwi_chat(None,ACTOR,{'message':'Readingdagi wind farms matnini tushuntir'},env={})
    resolve.assert_awaited_once();read.assert_awaited_once_with(None,ACTOR,reference)
    assert r['provider']['material']==reference and r['provider']['model']=='riwi-material-v1'
    assert 'Wind farms' not in r['answer'] and r['citations'][0]['sourceId']==OTHER


@pytest.mark.asyncio
async def test_automatic_exam_refusal_is_a_normal_local_reply_without_external_calls():
    from app.riwi_gateway import handle_riwi_chat
    external=AsyncMock(side_effect=AssertionError('external provider used'))
    with patch('app.riwi_material_search.resolve_material',AsyncMock(side_effect=PermissionError('active_exam_lookup_forbidden'))):
        r=await handle_riwi_chat(None,ACTOR,{'message':'Listening test 1 transkripti'},env={},external_runner=external)
    assert r['ok'] and r['provenance']=='policy_refusal' and r['citations']==[]
    assert 'Faol test' in r['answer'];external.assert_not_awaited()
