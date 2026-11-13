"""The answer-bearing source is available only after server-owned review access."""
import asyncio
from uuid import UUID
from app.listening_review_access import exam_gate

USER=UUID(int=1);TEST=UUID(int=2);ATTEMPT=UUID(int=3)
class Connection:
    def __init__(self,status=None):self.status=status;self.args=None
    async def fetchrow(self,sql,*args):
        self.args=args
        assert "CASE WHEN status='in_progress' THEN 0" in sql
        return {'id':ATTEMPT,'status':self.status} if self.status else None

def test_student_needs_own_completed_attempt():
    for status,expected in [(None,(True,None)),('in_progress',(True,str(ATTEMPT))),('completed',(False,None))]:
        con=Connection(status)
        assert asyncio.run(exam_gate(con,{'id':USER,'role':'student'},TEST))==expected
        assert con.args==(USER,TEST)

def test_staff_can_open_activities_with_or_without_an_active_exam():
    for role in ('owner','teacher','admin'):
        assert asyncio.run(exam_gate(Connection(),{'id':USER,'role':role},TEST))==(False,None)
        assert asyncio.run(exam_gate(Connection('in_progress'),{'id':USER,'role':role},TEST))==(False,None)
