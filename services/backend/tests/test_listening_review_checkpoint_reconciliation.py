"""Regression: Listening review can read a genuinely completed linked attempt.
No production database, exam result mutation, or unrelated course changes.
"""
import asyncio
import json
from uuid import UUID
from app.step21_listening_authored_reads import _recover_linked_completed_attempt

USER=UUID('11111111-1111-4111-8111-111111111111')
TEST=UUID('22222222-2222-4222-8222-222222222222')
ATTEMPT=UUID('33333333-3333-4333-8333-333333333333')
OTHER=UUID('44444444-4444-4444-8444-444444444444')
KEY='la_listening_test_2_v2'

class Connection:
    def __init__(self,status='completed',latest=ATTEMPT,saved=40):
        self.status=status;self.latest=latest;self.saved=saved;self.queries=[]
    async def fetchrow(self,sql,*args):
        self.queries.append(sql)
        assert args==(USER,TEST)
        return {'id':self.latest,'status':self.status,'test_id':TEST,'content_version_id':None} if self.latest else None
    async def fetch(self,sql,*args):
        self.queries.append(sql)
        if 'listening_questions' in sql:
            return [{'id':UUID(int=100+i),'order':i} for i in range(1,41)]
        assert args==(ATTEMPT,)
        return [{'question_id':UUID(int=100+i),'user_answer':'answer '+str(i),'is_correct':i%2==0} for i in range(1,self.saved+1)]

def run(db,linked=ATTEMPT,state=None):
    state=state or {'attemptKey':str(ATTEMPT),'attemptStatus':'in_progress','submitted':False,'answers':{'1':'draft'}}
    values={KEY:json.dumps(state),'keep':'unchanged'}
    answer=asyncio.run(_recover_linked_completed_attempt(db,{'id':USER},str(TEST),'listening-test-2',values,linked))
    return values,answer

def test_linked_completed_attempt_recovers_review_without_mutating_storage():
    db=Connection()
    original,result=run(db)
    recovered=json.loads(result[KEY])
    assert recovered['attemptStatus']=='submitted'
    assert recovered['submitted'] is True
    assert len(recovered['lastResults'])==40
    assert recovered['lastResults'][0]=={'q':1,'user':'answer 1','ok':False}
    assert recovered['answers']['40']=='answer 40'
    assert result['keep']=='unchanged'
    assert json.loads(original[KEY])['attemptStatus']=='in_progress'
    assert all('INSERT' not in q and 'UPDATE' not in q for q in db.queries)

def test_active_exam_and_foreign_or_newer_attempt_remain_untouched():
    for db,linked in [(Connection(status='in_progress'),ATTEMPT),
                      (Connection(latest=OTHER),ATTEMPT),
                      (Connection(),OTHER)]:
        original,result=run(db,linked)
        assert result==original

def test_missing_partial_results_never_unlock_review():
    original,result=run(Connection(saved=39))
    assert result==original

def test_submitted_checkpoint_does_not_be_overwritten():
    db=Connection()
    original,result=run(db,state={'attemptKey':str(ATTEMPT),'attemptStatus':'submitted','submitted':True})
    assert result==original
    assert db.queries==[]
