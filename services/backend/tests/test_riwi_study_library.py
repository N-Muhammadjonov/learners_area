"""Reference identity, governed use and meaning-focused study-guide checks."""
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock,patch
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import riwi_study_library as s
from app.riwi_capabilities import RiwiActor
from app.riwi_knowledge import chunk_knowledge_text,detect_knowledge_overlap,_keywords
from app.riwi_curriculum import is_library_text
ACTOR=RiwiActor('11111111-1111-4111-8111-111111111111','owner')
CID='22222222-2222-4222-8222-222222222222'


def test_source_identity_levels_and_original_content_are_preserved():
    entries=s.library()
    guardian=[e for e in entries.values() if e['id'].startswith('study.guardian.')]
    grammar=[e for e in entries.values() if e['id'].startswith('study.cambridge.')]
    assert len(guardian)==150 and len(grammar)==25
    groups={e['group'] for e in guardian}
    assert len(groups)==50
    for group in groups:
        levels={e['level'] for e in guardian if e['group']==group}
        assert levels in ({'elementary','intermediate','advanced'},{'pre-intermediate','intermediate','advanced'})
    assert {e['source']['unit'] for e in grammar}==set(range(1,26))
    for e in entries.values():
        assert e['source']['publisherTextRedistributed'] is False
        assert len(e['source']['sha256'])==64 and e['source']['pages']
        assert is_library_text(s.unit_text(e)[:1200])
        for locale in ('uz','en'):
            a=s.format_lesson({'studyId':e['id'],'lessonVariant':0},'Tushuntir',locale)
            b=s.format_lesson({'studyId':e['id'],'lessonVariant':1},'Yana',locale)
            assert a!=b and all(f'{n}) ' in a for n in (1,2,3))
            assert (a.count('\n   — ')==3)==(locale=='uz')
            assert len(a)<5500
            assert not any(label in a.lower() for label in ('cambridge','guardian','macmillan','pdf','study guide','manba:','source:'))
            if e in guardian:assert ('tarixiy' in a if locale=='uz' else 'historical' in a)


@pytest.mark.parametrize('query,key',[
 ('Cambridge unit 1','study.cambridge.unit-01'),('Cambridge unit 10','study.cambridge.unit-10'),
 ('Cambridge unit 25 ni tushuntir','study.cambridge.unit-25'),
 ('Nominalisation nima?','study.cambridge.unit-25'),('Nominalizatsiya nima?','study.cambridge.unit-25'),
 ('Noun phrase expansion','study.cambridge.unit-12'),('Introductory it','study.cambridge.unit-21'),
 ('hedging nima','study.cambridge.unit-24'),
 ('Guardian amazon forest intermediate','study.guardian.amazon-forest.intermediate'),
 ('Guardian wind farms level 3','study.guardian.wind-farms.advanced'),
 ('Guardian zoos pre-intermediate','study.guardian.zoos.pre-intermediate'),
 ('Guardian drug patents elementary','study.guardian.drug-patents.elementary'),
 ('Cambridge unit 99',None),('Mars capital',None),
 ('Guardian wind farms elementary advanced',None),
])
def test_explicit_topic_and_level_selection(query,key):assert s.choose_entry(query)==key


def test_shared_rules_and_examples_are_governed_without_relaxing_generic_uploads():
    from app import riwi_curriculum as c,riwi_teaching_details as d
    active=[c.unit_text(e) for e in c.library().values()]+[d.unit_text(e) for e in d.library().values()]
    active_words=[_keywords(text) for text in active]
    for kind,count in (('guardian',154),('cambridge',25)):
        content=s.source_content(kind)
        from app.riwi_outbound_guard import redact_external_text
        assert redact_external_text(content,200000)==content
        assert len(content)<=200000
        parsed=chunk_knowledge_text(content)
        assert len(parsed)==count
        assert [u['text'] for u in parsed]==[s.encode(r) for r in s.source_records(kind)]
        assert all(is_library_text(u['text'][:1200]) for u in parsed)
        for unit in parsed:
            words=_keywords(unit['text'])
            assert all(len(words&other)/min(len(words),len(other))<.72 for other in active_words)
        active_words += [_keywords(u['text']) for u in parsed]
    assert max(len(u['text']) for u in chunk_knowledge_text('x'*1400))<=1200
    assert s.structured_units(s.source_content('cambridge')+' altered') is None
    assert s.installation_payload('guardian')['rightsClass']=='internal_permission'
    assert 'publisher rights' in s.PROVENANCE


@pytest.mark.asyncio
async def test_both_installation_payloads_pass_the_normal_ingestion_contract():
    from app.riwi_knowledge import create_knowledge_candidate
    for kind in ('guardian','cambridge'):
        p=s.installation_payload(kind)
        result=await create_knowledge_candidate(None,actor=ACTOR,source_type=p['sourceType'],title=p['title'],
          provenance=p['provenance'],rights_class=p['rightsClass'],scope=p['scope'],content=p['content'])
        assert result['state']=='candidate' and result['checksum']==s.source_checksum(kind)


@pytest.mark.asyncio
async def test_only_exact_active_scoped_source_can_supply_the_lesson():
    key='study.cambridge.unit-25';content=s.unit_text(s.library()[key])
    conn=SimpleNamespace(fetchrow=AsyncMock(return_value=None))
    assert await s.retrieve_lesson(conn,ACTOR,'Nominalisation') is None
    conn.fetchrow.return_value={'source_id':CID,'unit_id':CID,'authority':75,'version':1,'content':content}
    result=await s.retrieve_lesson(conn,ACTOR,'Nominalisation')
    assert result['studyId']==key
    sql,args=conn.fetchrow.call_args.args[0],conn.fetchrow.call_args.args[1:]
    assert "s.state='active'" in sql and 's.scope_user_id=$4::uuid' in sql
    assert args[:2]==(s.source_checksum('cambridge'),s.digest(content))
    conn.fetchrow.return_value={**conn.fetchrow.return_value,'content':'modified'}
    assert await s.retrieve_lesson(conn,ACTOR,'Nominalisation') is None


@pytest.mark.asyncio
async def test_followup_reads_only_owned_unexpired_role_bound_history():
    e=s.library()['study.guardian.wind-farms.advanced']
    metadata={'provider':{'id':'riwi','model':s.MODEL_PREFIX+e['id'],'lessonVariant':0}}
    conn=SimpleNamespace(fetchrow=AsyncMock(side_effect=[{'metadata':metadata},{'source_id':CID,'unit_id':CID,'authority':75,'version':1,'content':s.unit_text(e)}]))
    result=await s.retrieve_lesson(conn,ACTOR,'Yana uchta misol ber',CID)
    assert result['studyId']==e['id'] and result['lessonVariant']==1
    sql,*args=conn.fetchrow.call_args_list[0].args
    assert 'c.user_id=$2::uuid' in sql and 'c.role_at_creation=$3::role' in sql and 'c.expires_at>now()' in sql
    assert args==[CID,ACTOR.id,ACTOR.role]


def test_semantic_contracts_preserve_meaning_and_avoid_false_exam_claims():
    cases={
      7:['Advice','few','little'],14:['Mustn’t','Don’t have to','Needn’t have done'],
      18:['Mixed','time'],20:['non-defining','That'],24:['not universally forbidden'],
      25:['Preserve the agent','does not automatically raise']}
    for unit,terms in cases.items():
        text=s.library()[f'study.cambridge.unit-{unit:02}']['explanationEn'].lower()
        assert all(t.lower() in text for t in terms)
    cloning=s.library()['study.guardian.cloning.elementary']['explanationUz']
    assert 'keyinchalik tasdiqlanganini anglatmaydi' in cloning
    colas=s.library()['study.guardian.colas.elementary']['explanationUz']
    assert 'Market value' in colas and 'sales' in colas and 'bir ko‘rsatkich emas' in colas


@pytest.mark.parametrize('locale,message,step',[('uz','Shu mavzuni soddaroq tushuntir va uchta misol ber.','1-qadam:'),
 ('en','Explain this topic more simply with three examples.','Step 1:')])
def test_simple_followup_is_readable_steps_and_keeps_the_modal_contrast(locale,message,step):
    entry=s.library()['study.cambridge.unit-14']
    answer=s.format_lesson({'studyId':entry['id'],'lessonVariant':2},message,locale)
    assert step in answer and 'Mustn’t' in answer and 'Don’t have to' in answer
    assert entry['explanationUz' if locale=='uz' else 'explanationEn'] not in answer
    assert all(f'{n}) ' in answer for n in (1,2,3))


def test_more_examples_does_not_repeat_the_whole_explanation_or_claim_an_unlimited_new_set():
    entry=s.library()['study.cambridge.unit-25']
    unit={'studyId':entry['id'],'lessonVariant':3}
    answer=s.format_lesson(unit,'Shu mavzu uchun yana uchta misol va kichik mashq ber.','uz')
    assert entry['explanationUz'] not in answer and '3 ta yangi misol' not in answer
    assert all(x['en'] in answer for x in entry['examples'][3:6])
    assert entry['explanationUz'] in s.format_lesson({**unit,'lessonVariant':0},'Nominalisation nima?','uz')


@pytest.mark.asyncio
async def test_gateway_delivers_approved_study_guide_with_citation_and_without_provider_calls():
    from app.riwi_gateway import handle_riwi_chat
    key='study.cambridge.unit-25';entry=s.library()[key]
    unit={'ref':'K3','sourceId':CID,'unitId':CID,'title':entry['title'],'authority':75,'version':1,
          'text':s.unit_text(entry),'studyId':key,'lessonVariant':0}
    runner=AsyncMock(side_effect=AssertionError('external provider called'))
    with patch('app.riwi_study_library.retrieve_lesson',AsyncMock(return_value=unit)):
        response=await handle_riwi_chat(None,ACTOR,{'message':'Nominalisation nima?'},
          env={'RIWI_EXTERNAL_AI_ENABLED':'true','AI_EXTERNAL_ENABLED':'true'},external_runner=runner)
    assert response['provider']['model']==s.MODEL_PREFIX+key
    assert response['provenance']=='approved_knowledge' and response['citations'][0]['sourceId']==CID
    assert response['answer'].count('\n   — ')==3
    runner.assert_not_awaited()
