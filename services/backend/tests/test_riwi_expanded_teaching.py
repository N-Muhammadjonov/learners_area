"""Governed teaching, typo variants and conservative sentence feedback."""
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock,patch
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import riwi_curriculum as c,riwi_teaching_details as d
from app.riwi_internal_tutor import correction_request,format_correction,smalltalk
from app.riwi_capabilities import RiwiActor
from app.riwi_gateway import handle_riwi_chat
from app.riwi_knowledge import chunk_knowledge_text,collect_knowledge_conflicts,KnowledgeServiceError
ACTOR=RiwiActor('11111111-1111-4111-8111-111111111111','owner',locale='uz')
CID='22222222-2222-4222-8222-222222222222'

def lesson(key='grammar.past-simple-vs-present-perfect',variant=0):
    entry=c.library()[key];detail=d.library()[key]
    return {'ref':'K1','sourceId':CID,'unitId':CID,'title':entry['title'],'text':c.unit_text(entry),
            'authority':75,'version':1,'curriculumId':key,'lessonVariant':variant,
            'supplement':{'ref':'K2','sourceId':ACTOR.id,'unitId':ACTOR.id,'title':d.SOURCE_TITLE,
                          'authority':75,'version':1,'text':d.unit_text(detail),'teachingDetails':detail}}

@pytest.mark.parametrize('query,key',[
 ('презент перфект билан паст симпл фарки нма','grammar.past-simple-vs-present-perfect'),
 ('presnt perfct bilan past simpl farqi nima','grammar.past-simple-vs-present-perfect'),
 ('present perfectdan past simple farqi nima','grammar.past-simple-vs-present-perfect'),
 ('Doiraviy diagrammani tushuntir','writing.task1.pie_chart'),
 ('So‘z birikmalarini o‘rgat.','vocabulary.collocation'),
 ('So`z birikmalarini orgat.','vocabulary.collocation'),
 ('few va a few farqi nima','grammar.quantifiers'),
 ('although nima','grammar.linking'),
 ('How should I use past perfect?','grammar.past-perfect'),
 ('Give a few examples of a line graph.','writing.task1.line_graph'),
 ('What is the capital of Mars?',None),
 ('How do articles and countability interact?',None),
])
def test_typo_script_and_apostrophe_variants_without_unrelated_topic_capture(query,key):
    assert c.choose_entry(query)==key

@pytest.mark.parametrize('query',['tushinmadim soddarok misollar ber','Тушунмадим','yana','3 ta misol ber'])
def test_short_uzbek_followups_keep_context(query):assert c.is_followup(query)

def test_all_lessons_offer_three_bilingual_examples_and_different_followup_set():
    assert len(d.library())==92
    for key,entry in d.library().items():
        a=c.format_lesson(lesson(key,0),'Tushuntir','uz')
        b=c.format_lesson(lesson(key,1),'Yana 3 ta misol ber','uz')
        assert all(f'{i}) ' in a and f'{i}) ' in b for i in (1,2,3)),key
        assert a.count('\n   — ')==3 and b.count('\n   — ')==3,key
        assert set(e['en'] for e in entry['examples'][:3]).isdisjoint(e['en'] for e in entry['examples'][3:6]),key
        assert all(e['en'] in a for e in entry['examples'][:3]),key
        assert all(e['en'] in b for e in entry['examples'][3:6]),key
        assert len(a)<5500 and len(b)<5500 and '💡' in a and '✍️' in a and a!=b,key
        en=c.format_lesson(lesson(key),'Explain this topic','en')
        assert 'Three examples' in en and en.count('\n   — ')==0

def test_pack_parser_preserves_original_library_and_does_not_relax_generic_uploads():
    assert c.source_checksum()=='e87a2aa55c7f1aabf8fdfc8475d91f41a14cfa710fa16feeafd6f9e7383e5b1f'
    units=chunk_knowledge_text(d.source_content())
    assert len(units)==92 and max(len(u['text']) for u in units)<=4000
    assert [u['text'] for u in units]==[d.unit_text(e) for e in d.library().values()]
    generic=chunk_knowledge_text('x'*1400)
    assert len(generic)==2 and all(len(u['text'])<=1200 for u in generic)
    try:rows=chunk_knowledge_text(d.source_content()+' changed')
    except KnowledgeServiceError:rows=[]
    assert all(len(u['text'])<=1200 for u in rows)
    old=chunk_knowledge_text(c.source_content())
    assert not collect_knowledge_conflicts(units,[{'sourceId':CID,'unitId':str(i),'text':u['text']} for i,u in enumerate(old)])

@pytest.mark.asyncio
async def test_details_require_exact_active_checksum_and_actor_scope():
    key='grammar.articles';entry=d.library()[key]
    conn=SimpleNamespace(fetchrow=AsyncMock(return_value={'source_id':CID,'unit_id':CID,'content':d.unit_text(entry),'authority':75,'version':1}))
    result=await d.retrieve_details(conn,ACTOR,key)
    assert result['ref']=='K2'
    sql,*args=conn.fetchrow.await_args.args
    assert "s.state='active'" in sql and 's.scope_role=$3::role' in sql and 's.scope_user_id=$4::uuid' in sql
    assert args[0]==d.source_checksum() and args[2:]==[ACTOR.role,ACTOR.id]
    conn.fetchrow.return_value={'content':'altered'}
    assert await d.retrieve_details(conn,ACTOR,key) is None
    conn.fetchrow.reset_mock()
    assert await d.retrieve_details(conn,RiwiActor(ACTOR.id,'owner','suspended'),key) is None
    conn.fetchrow.assert_not_awaited()
    unit=lesson(key);unit['supplement']['text']='altered'
    assert d.format_details(unit,'Explain','uz',c.library()[key]) is None

@pytest.mark.parametrize('original,corrected',[
 ('She does not goes to school.','She does not go to school.'),
 ("He doesn't studies here.","He doesn't study here."),
 ('Does she works here?','Does she work here?'),
 ('Did they studied yesterday?','Did they study yesterday?'),
 ('I did not went home.','I did not go home.'),
 ('I waited for a hour.','I waited for an hour.'),
 ('He studies at an university.','He studies at a university.'),
 ('She went home yesterday.','She went home yesterday.'),
 ('He does not pass that building.','He does not pass that building.'),
 ('If I were you, I would wait.','If I were you, I would wait.'),
 ('A people is a cultural group.','A people is a cultural group.'),
 ('They consist in careful observation.','They consist in careful observation.'),
])
def test_targeted_corrections_preserve_correct_and_ambiguous_writing(original,corrected):
    result=correction_request('Please correct this grammar: '+original)
    assert result['original']==original and result['corrected']==corrected
    answer=format_correction(result,c.format_lesson(lesson(result['topic']),'Explain','uz'),'uz')
    assert original in answer and answer.count('\n   — ')==3
    if original==corrected:assert not result['reasons']
    else:assert result['reasons'] and corrected in answer

@pytest.mark.asyncio
async def test_gateway_uses_original_and_supplement_citations_without_a_provider():
    no_network=AsyncMock(side_effect=AssertionError('external request attempted'))
    with patch('app.riwi_curriculum.retrieve_lesson',AsyncMock(return_value=lesson())):
        result=await handle_riwi_chat(None,ACTOR,{'message':'Past simple bilan present perfect farqi nima?'},
                                     env={'RIWI_EXTERNAL_AI_ENABLED':'false','AI_EXTERNAL_ENABLED':'false'},external_runner=no_network)
    assert result['provider']['id']=='riwi' and result['provider']['teachingEdition']=='details-v1'
    assert result['provenance']=='approved_knowledge' and {x['ref'] for x in result['citations']}=={'K1','K2'}
    assert result['answer'].count('\n   — ')==3
    no_network.assert_not_awaited()

@pytest.mark.asyncio
async def test_valid_input_is_addressed_instead_of_an_unrelated_people_example():
    with patch('app.riwi_curriculum.retrieve_lesson',AsyncMock(return_value=lesson('grammar.past-simple'))) as retrieve:
        result=await handle_riwi_chat(None,ACTOR,{'message':'Please correct this grammar: She went home yesterday.'},env={'RIWI_EXTERNAL_AI_ENABLED':'false'})
    assert retrieve.await_args.kwargs['topic_key']=='grammar.past-simple'
    assert 'She went home yesterday.' in result['answer'] and 'People is waiting' not in result['answer']
    assert result['answer'].count('\n   — ')==3

@pytest.mark.asyncio
async def test_published_grammar_stays_authoritative_and_gains_approved_examples():
    broker=SimpleNamespace(execute=AsyncMock(return_value={
        'resolved':True,'title':'Present Perfect','summary':'Published topic explanation.',
        'provenance':'canonical_grammar'}))
    with patch('app.riwi_curriculum.retrieve_lesson',AsyncMock(return_value=lesson('grammar.present-perfect'))) as retrieve:
        result=await handle_riwi_chat(None,ACTOR,{'message':'Explain present perfect grammar'},
                                     broker=broker,env={'RIWI_EXTERNAL_AI_ENABLED':'false'})
    assert retrieve.await_args.kwargs['topic_key']=='grammar.present-perfect'
    assert result['provenance']=='canonical_grammar'
    assert result['answer'].startswith('Published topic explanation.')
    assert result['answer'].count('\n   — ')==3

def test_greetings_and_unknowns_are_honest():
    assert 'Salom' in smalltalk('Салом','uz')
    assert '🙂' in smalltalk('raxmat','uz')
    assert smalltalk('What is the capital of Mars?','en') is None
    assert correction_request('Teach grammar error correction.') is None
