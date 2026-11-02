"""Published corpus reads, privacy boundaries and unavailable-source behavior."""
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock,patch
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import riwi_materials as m
from app.riwi_capabilities import RiwiActor
from app.riwi_contracts import validate_riwi_chat_request,RiwiContractError
ID='11111111-1111-4111-8111-111111111111'
OTHER='22222222-2222-4222-8222-222222222222'
OWNER=RiwiActor(ID,'owner')
STUDENT=RiwiActor(ID,'student')


@pytest.mark.parametrize('value',[None,{},[],{'kind':'reading','id':'bad'},
 {'kind':'https://localhost','id':ID},{'kind':'reading','id':ID,'role':'owner'},
 {'kind':'private-submission','id':ID}])
def test_material_reference_cannot_select_a_private_table_or_supply_authority(value):
    with pytest.raises(ValueError):m.validate_reference(value)


def test_chat_contract_validates_material_and_rejects_ambiguous_context():
    reference={'kind':'reading','id':ID.upper()}
    assert validate_riwi_chat_request({'message':'Explain','material':reference})['material']=={'kind':'reading','id':ID}
    for key in ('targetUserId','attemptId','topicId','occurrenceId','lessonId'):
        with pytest.raises(RiwiContractError,match='ambiguous_learning_context'):
            validate_riwi_chat_request({'message':'Explain','material':reference,key:OTHER})
    with pytest.raises(RiwiContractError):validate_riwi_chat_request({'message':'Explain','material':{'kind':'reading','id':'bad'}})


@pytest.mark.asyncio
async def test_suspended_admin_and_active_exam_guards_precede_source_reads():
    conn=SimpleNamespace(fetch=AsyncMock(),fetchrow=AsyncMock(),fetchval=AsyncMock(return_value=True))
    for actor in (RiwiActor(ID,'student',account_status='suspended'),RiwiActor(ID,'admin')):
        with pytest.raises(PermissionError,match='forbidden'):
            await m.list_materials(conn,actor,'reading')
    with pytest.raises(PermissionError,match='active_exam_lookup_forbidden'):
        await m.read_material(conn,STUDENT,{'kind':'reading','id':OTHER})
    conn.fetch.assert_not_called();conn.fetchrow.assert_not_called()
    assert "status IN ('reading','recall')" in conn.fetchval.call_args.args[0]


def test_source_selectors_keep_publication_membership_and_version_guards():
    reading=m.selection('reading')
    assert "p.publication_state='published'" in reading and 'general_reading_sets' in reading and 'CONTENT_DELETED' in reading
    listening=m.selection('listening')
    assert 'listening_packages' in listening and "section->>'transcript'" in listening
    assert 'correct_answer' not in listening and 'questions' not in listening
    speaking=m.selection('speaking')
    assert "study_support->>'modelAnswerHtml'" in speaking and 'available_in @>' in speaking
    assert 'speaking_attempts' not in speaking
    retention=m.selection('retention')
    assert 'a.user_id=$1::uuid' in retention and "a.status IN ('completed','timed_out')" in retention
    assert "t.current_version_id=v.id" in retention and 'scoring_structure' not in retention
    assert 'enrollments' in m.selection('podcast')
    assert all('writing_pattern_bank' not in m.selection(k) for k in m.KINDS)


@pytest.mark.asyncio
async def test_catalogue_is_bounded_and_search_is_literal():
    rows=[{'id':OTHER,'title':'Source <img src=x>'} for _ in range(31)]
    conn=SimpleNamespace(fetch=AsyncMock(return_value=rows),fetchval=AsyncMock(return_value=False))
    result=await m.list_materials(conn,OWNER,'reading','%_')
    assert len(result['items'])==30 and result['hasMore']
    sql,*args=conn.fetch.call_args.args
    assert 'strpos(lower(title),lower($3))' in sql and 'LIMIT 31' in sql
    assert args==[ID,'owner','%_']


@pytest.mark.asyncio
async def test_missing_text_never_becomes_an_invented_transcript():
    conn=SimpleNamespace(fetchrow=AsyncMock(return_value={'id':OTHER,'title':'Test','text':'','attribution':'source'}))
    with patch('app.browser_listening.content',new=AsyncMock(return_value=({'transcript':''},{'sections':[{'transcript':''}]}))) as content:
        with pytest.raises(LookupError,match='material_text_unavailable'):
            await m.read_material(conn,OWNER,{'kind':'listening','id':OTHER})
        assert str(content.call_args.args[2])==OTHER
        assert content.call_args.args[1]=={'id':ID,'role':'owner'}


@pytest.mark.asyncio
async def test_listening_sequence_guard_is_reused_before_any_transcript_answer():
    conn=SimpleNamespace(fetchrow=AsyncMock(return_value={'id':OTHER,'title':'Test','text':'','attribution':'source'}))
    with patch('app.browser_listening.content',new=AsyncMock(side_effect=PermissionError('sequence_locked'))):
        with pytest.raises(PermissionError,match='sequence_locked'):
            await m.read_material(conn,OWNER,{'kind':'listening','id':OTHER})


def test_source_excerpts_are_labelled_and_not_misrepresented_as_generated_answers():
    item={'id':OTHER,'title':'A source','kind':'reading','text':'The study compared two groups. The second group practised every day. The report did not give their ages.','attribution':'Published centre material'}
    uz=m.teach_material(item,'group','uz')
    en=m.teach_material(item,'group','en')
    assert 'xulosa yoki javob kaliti emas' in uz and 'not a summary or answer key' in en
    assert all(f'{i}) ' in uz for i in (1,2,3)) and uz.count('\n   — ')==3
    assert 'Published centre material' in uz
    assert m.plain('<p>Visible</p><script>private()</script><p>Next</p>').split()==['Visible','Next']
    assert m.transcript_text({'answerKey':'secret'})==''
    assert m.transcript_text([{'text':'Only source text','answer':'secret'}])=='Only source text'


def test_source_vocabulary_keeps_authored_uzbek_sense_and_example():
    item={'id':OTHER,'title':'Speaking','kind':'speaking','text':'Describe a challenge.','vocabulary':[
      {'term':'worked against the clock','definitionEn':'worked against the clock','translationUz':'vaqtga qarshi ishladik','exampleSentence':'We worked against the clock.'}]}
    answer=m.teach_material(item,'Worked against the clock nima?','uz')
    assert 'vaqtga qarshi ishladik' in answer and 'We worked against the clock.' in answer
    assert 'band ballini aniqlab bo‘lmaydi' in answer


@pytest.mark.asyncio
async def test_gateway_preserves_source_identity_and_stays_internal():
    from app.riwi_gateway import handle_riwi_chat
    item={'id':OTHER,'kind':'reading','title':'Synthetic passage','text':'The study compared two groups. The second group practised daily. The report did not give their ages.',
          'contentHash':'a'*64,'attribution':'QA synthetic source'}
    runner=AsyncMock(side_effect=AssertionError('external provider called'))
    with patch('app.riwi_materials.read_material',AsyncMock(return_value=item)):
        response=await handle_riwi_chat(None,OWNER,{'message':'Mavzuni tushuntir','material':{'kind':'reading','id':OTHER}},
          env={'RIWI_EXTERNAL_AI_ENABLED':'true','AI_EXTERNAL_ENABLED':'true'},external_runner=runner)
    assert response['provenance']=='deterministic_learning_data'
    assert response['citations'][0]['ref']=='S1' and response['citations'][0]['contentHash']=='a'*64
    assert response['provider']['material']=={'kind':'reading','id':OTHER}
    runner.assert_not_awaited()
