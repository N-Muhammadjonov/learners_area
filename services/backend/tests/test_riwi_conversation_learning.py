import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock,patch
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import riwi_conversation_learning as l
from app.riwi_capabilities import RiwiActor
from app.riwi_questions import answer_question
from app.riwi_curriculum import previous_lesson_context,retrieve_lesson,library,unit_text

ID='11111111-1111-4111-8111-111111111111';CID='22222222-2222-4222-8222-222222222222'
ACTOR=RiwiActor(ID,'student')

@pytest.mark.parametrize('message',[
 'my grammar question about illness','Ali grammar tushunmaydi nima qilay',
 'landscape sozi user@example.com uchun nima degani','grammar https://example.com',
 'tokenim 123456 grammar haqida','mening kasalligim haqida tarjima qil',
])
def test_personal_or_secret_text_is_not_captured(message):assert l.safe_question(message) is None

@pytest.mark.asyncio
async def test_capture_is_atomic_private_deduplicated_and_never_promotes():
    conn=SimpleNamespace(fetchrow=AsyncMock(return_value={'id':CID,'state':'candidate','created':False}))
    first=await l.capture_unknown_question(conn,ACTOR,CID,'nuxlerm sozi qaysi vazifada')
    assert first=={'recorded':True,'state':'candidate','scope':'user'}
    sql,*args=conn.fetchrow.call_args.args
    assert 'c.user_id=u.id' in sql and "u.account_status='active'" in sql
    assert 'c.role_at_creation=u.role' in sql and 'c.deleted_at IS NULL' in sql and 'c.expires_at>now()' in sql
    assert 'ON CONFLICT(actor_user_id,signal_type,source_id)' in sql and 'DO NOTHING' in sql
    assert "'user' FROM eligible" in sql and 'riwi_knowledge_sources' not in sql
    assert args[:3]==[ID,'student',CID]
    source=args[4];assert 'unverified' in args[5] and 'full transcript omitted' in args[6]
    await l.capture_unknown_question(conn,ACTOR,CID,'NUXLERM SOZI QAYSI VAZIFADA')
    # Uppercase acronyms are normalised, not identifiers or secrets.
    assert conn.fetchrow.call_args.args[5]==source
    other=RiwiActor('33333333-3333-4333-8333-333333333333','student')
    await l.capture_unknown_question(conn,other,CID,'nuxlerm sozi qaysi vazifada')
    assert conn.fetchrow.call_args.args[5]!=source

@pytest.mark.asyncio
async def test_queue_failure_does_not_break_a_saved_answer_or_log_text(caplog):
    conn=SimpleNamespace(fetchrow=AsyncMock(side_effect=RuntimeError('private text should never be logged')))
    assert await l.capture_safely(conn,ACTOR,CID,'nuxlerm sozi qaysi vazifada')=={'recorded':False}
    assert 'private text' not in caplog.text and 'RuntimeError' in caplog.text

@pytest.mark.asyncio
async def test_unknown_question_cannot_be_promoted_even_after_review():
    from app.riwi_learning_signals import create_knowledge_candidate_from_learning_signal,LearningServiceError
    owner=RiwiActor(ID,'owner')
    conn=SimpleNamespace(fetchrow=AsyncMock(return_value={'id':CID,'signal_type':'retrieval_failure','state':'accepted','target_user_id':ID,'candidate_claim':'unverified question','evidence_hash':'a'*64,'scope':'user'}))
    with pytest.raises(LearningServiceError,match='promotion_blocked'):
        await create_knowledge_candidate_from_learning_signal(conn,actor=owner,signal_id=CID)

@pytest.mark.asyncio
async def test_explicit_clarification_learns_only_a_conversation_local_alias():
    conn=SimpleNamespace(fetchrow=AsyncMock(return_value={'question':'nuxlerm sozi qaysi vazifada',
      'metadata':{'provenance':'unavailable','provider':{'model':'deterministic-v1'}}}))
    provider={'id':'riwi','model':'riwi-curriculum-v1:grammar.present-perfect'}
    result=await l.attach_clarification_alias(conn,ACTOR,CID,'present perfectni nazarda tutdim',provider)
    assert result['queryAliases']==['nuxlerm sozi qaysi vazifada']
    assert 'u.metadata' in conn.fetchrow.call_args.args[0] and 'c.user_id=$2::uuid' in conn.fetchrow.call_args.args[0]
    assert await l.attach_clarification_alias(conn,ACTOR,None,'present perfectni nazarda tutdim',provider)==provider
    assert await l.attach_clarification_alias(conn,ACTOR,CID,'Boshqa mavzu: past simple',provider)==provider

@pytest.mark.asyncio
async def test_alias_reuse_still_requires_active_lesson_and_explicit_topic_wins():
    provider={'id':'riwi','model':'riwi-curriculum-v1:grammar.present-perfect','queryAliases':['nuxlerm sozi qaysi vazifada']}
    async def row(sql,*args):
        if 'm.metadata' in sql:return {'metadata':{'provider':provider}}
        if 's.checksum=$1' in sql:
            # Use the hash requested by the real retrieval to choose exact data.
            import hashlib
            e=next((e for e in library().values() if hashlib.sha256(unit_text(e).encode()).hexdigest()==args[1]),None)
            if not e:return None
            return {'source_id':ID,'unit_id':CID,'title':e['title'],'content':unit_text(e),'authority':75,'version':1}
        return None
    conn=SimpleNamespace(fetchrow=AsyncMock(side_effect=row))
    result=await retrieve_lesson(conn,ACTOR,'nuxlerm sozi qaysi vazifada',CID)
    assert result['curriculumId']=='grammar.present-perfect'
    assert (await retrieve_lesson(conn,ACTOR,'Past simple',CID))['curriculumId']=='grammar.past-simple'
    assert await retrieve_lesson(conn,ACTOR,'nuxlerm sozi qaysi vazifada') is None

@pytest.mark.asyncio
async def test_short_followups_reuse_known_answers_without_hijacking_new_topics():
    conn=SimpleNamespace(fetchrow=AsyncMock(return_value={'metadata':{'provider':{'id':'riwi','model':'riwi-questions-v1','responseId':'borrow-lend'}}}))
    result=await answer_question(conn,ACTOR,'Tushunmadim, yana ayt.','uz',CID)
    assert 'Borrow' in result['answer'] and 'bitta o‘z misolingizni' in result['answer']
    assert (await answer_question(conn,ACTOR,'200 ning 15 foizi qancha?','uz',CID))['provider']['responseId']=='science-802'
    conn.fetchrow.return_value={'metadata':{'provider':{'model':'riwi-curriculum-v1:grammar.present-perfect'}}}
    assert await answer_question(conn,ACTOR,'Tushunmadim, yana ayt.','uz',CID) is None
