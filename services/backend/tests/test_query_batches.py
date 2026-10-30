"""Bounded read round trips, unchanged DTOs and scoped parameter binding."""
import asyncio
import re
from datetime import datetime,timezone
from decimal import Decimal
from uuid import UUID
from unittest.mock import AsyncMock

from app import browser_writing as writing,main as core,step37_reports as reports

USER=UUID('11111111-1111-4111-8111-111111111111')
def identifier(n):return UUID(f'22222222-2222-4222-8222-{n:012}')

class Pool:
    def __init__(self,con):self.con=con
    def acquire(self):return self
    async def __aenter__(self):return self.con
    async def __aexit__(self,*args):pass


def test_fifty_grade_rows_use_one_scoped_evaluation_read(monkeypatch):
    rows=[{'id':identifier(n),'task_type':'task2','question_text':'Isolated question','word_count':250,
           'status':'evaluated','created_at':datetime(2026,10,1,tzinfo=timezone.utc)} for n in range(50)]
    con=type('DB',(),{'fetch':AsyncMock(side_effect=[rows,[],[]])})()
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=Pool(con)))
    monkeypatch.setattr(writing,'ai_ready',AsyncMock(return_value=False))
    result=asyncio.run(writing.read(None,{'id':USER},'/app/writing',{'tab':'grade'},None))
    assert len(result['essays'])==50 and all(row['overall'] is None for row in result['essays'])
    assert con.fetch.await_count==3
    call=con.fetch.await_args_list[1]
    assert 'user_id=$1 AND source_type=$2' in call.args[0]
    assert call.args[1:]==(USER,'writing_grade',[row['id'] for row in rows])


def test_empty_evaluation_batch_needs_no_query():
    con=type('DB',(),{'fetch':AsyncMock()})()
    assert asyncio.run(writing.evaluations(con,USER,'writing_grade',[]))=={}
    con.fetch.assert_not_awaited()


def test_exam_grades_batch_only_the_owned_paper_keys(monkeypatch):
    paper_id=identifier(90);prompt_id=str(identifier(91));request_id=identifier(92)
    paper={'paper':{'entries':[{'promptId':prompt_id,'position':1},{'promptId':prompt_id,'position':2}]}}
    rows=[{'id':request_id,'status':'evaluated','idempotency_key':f'exam_{paper_id}_1'}]
    con=type('DB',(),{'fetch':AsyncMock(side_effect=[[],rows])})()
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=Pool(con)))
    monkeypatch.setattr(writing,'existing',AsyncMock(return_value=paper))
    monkeypatch.setattr(writing,'ai_ready',AsyncMock(return_value=False))
    checked=AsyncMock(return_value={str(request_id):{'overallEstimate':7.5}})
    monkeypatch.setattr(writing,'evaluations',checked)
    result=asyncio.run(writing.read(None,{'id':USER},f'/app/writing/exam/{paper_id}',{},None))
    assert result['grades']=={'1':{'requestId':str(request_id),'status':'evaluated','overall':7.5}}
    assert result['materials']=={'1':[],'2':[]}
    assert con.fetch.await_count==2
    call=con.fetch.await_args_list[1]
    assert 'user_id=$1 AND idempotency_key=ANY($2::text[])' in call.args[0]
    assert call.args[1:]==(USER,[f'exam_{paper_id}_1',f'exam_{paper_id}_2'])
    checked.assert_awaited_once_with(con,USER,'writing_grade',[request_id],True)


def test_pack_batch_preserves_order_empty_packs_and_label_fallback():
    packs=[{'id':identifier(1),'slug':'first','label_en':'First','label_uz':None},
           {'id':identifier(2),'slug':'empty','label_en':'Empty','label_uz':'Bo‘sh'}]
    words=[{'pack_id':identifier(1),'term':'earlier','part_of_speech':'noun','definition_en':'First definition','translation_uz':'Birinchi','example':'One.','collocations':[]},
           {'pack_id':identifier(1),'term':'later','part_of_speech':'noun','definition_en':'Second definition','translation_uz':'Ikkinchi','example':'Two.','collocations':[]}]
    con=type('DB',(),{'fetch':AsyncMock(side_effect=[packs,words])})()
    result=asyncio.run(writing.packs(con))
    assert con.fetch.await_count==2
    assert [row['id'] for row in result]==['first','empty']
    assert result[0]['label']=={'en':'First','uz':'First'}
    assert [word['term'] for word in result[0]['words']]==['earlier','later']
    assert result[1]['words']==[]
    assert all('packId' not in word for word in result[0]['words'])


def test_report_parameters_are_rebased_without_interpolating_identity():
    period={'from':'2026-10-01T00:00:00Z','to':'2026-11-01T00:00:00Z'}
    query,args=reports.compile_sql('select count(*) as v from users where id=:subject and created_at>=:from and created_at<:to',
                                  period,{'subjectId':str(USER)},offset=8)
    assert '$9::uuid' in query and '$10::timestamptz' in query and '$11::timestamptz' in query
    assert str(USER) not in query and args==[str(USER),period['from'],period['to']]


def test_report_snapshot_uses_one_statement_and_preserves_provenance():
    scope={'kind':'student','subjectId':str(USER),'subjectName':'Isolated learner'}
    now=datetime(2026,10,29,tzinfo=timezone.utc);period=reports.period_window('monthly',now)
    selected=reports.specs_for(scope)
    row={f'metric_{n}':Decimal('7.5') if n==0 else 0 for n in range(len(selected))}
    con=type('DB',(),{'fetchrow':AsyncMock(return_value=row)})()
    result=asyncio.run(reports.snapshot(con,scope,period,{'id':USER,'role':'student'},now))
    con.fetchrow.assert_awaited_once()
    query,*args=con.fetchrow.await_args.args
    slots=[int(n) for n in re.findall(r'\$(\d+)',query)]
    assert sorted(set(slots))==list(range(1,len(args)+1))
    assert result['metrics'][0]['value']==7.5
    assert [m['source']['sql'] for m in result['metrics']]==[s['compiledText'] for s in selected]
    assert all(m['scope']=='student:'+str(USER) for m in result['metrics'])
    assert str(USER) not in query
