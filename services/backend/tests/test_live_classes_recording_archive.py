"""Previous Classes keyset pagination regression tests.

Requires the normal Learners Area backend test environment. No production
connection, no remote YouTube stream, and no fixed student count.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi import HTTPException

from app import browser_activity

COURSE = UUID('11111111-1111-4111-8111-111111111111')
STUDENT = UUID('22222222-2222-4222-8222-222222222222')
TEACHER = UUID('33333333-3333-4333-8333-333333333333')


class ArchiveConnection:
    """Captures the production SQL and returns deterministic authorized rows.

    Authorization assertions below also inspect the generated SQL; this fake
    does not replace a separate PostgreSQL integration test.
    """
    def __init__(self, *, n=151, authorized='all'):
        base=datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
        self.rows=[]
        for i in range(n):
            self.rows.append({
                'id':UUID(int=10000+i),
                'course_id':COURSE,
                'status':'recorded',
                'scheduled_at':base-timedelta(minutes=i//3,microseconds=i%3),
                'teacher_user_id':TEACHER,
                'access_scope':'assigned' if i%2 else 'course',
            })
        self.authorized=authorized
        self.queries=[]

    async def fetch(self, query, *args):
        self.queries.append((query,args))
        assert 'ORDER BY l.scheduled_at DESC,l.id DESC LIMIT $5' in query
        assert "l.status IN ('completed','recorded')" in query
        assert '($3::timestamptz,$4::uuid)' in query
        assert args[-1] == 21
        rows=self.rows
        if self.authorized=='alternating':
            assert 'live_class_enrollments' in query
            assert 'teacher_student_links' in query
            assert 'access_entitlements' in query
            rows=[r for i,r in enumerate(rows) if i%2==0]
        if self.authorized=='teacher':
            assert 'l.teacher_user_id=$2::uuid' in query
        rows=sorted(rows,key=lambda r:(r['scheduled_at'],r['id']),reverse=True)
        cursor_at,cursor_id=args[2],args[3]
        if cursor_at is not None:
            rows=[r for r in rows if (r['scheduled_at'],r['id'])<(cursor_at,cursor_id)]
        return rows[:args[-1]]


@pytest.mark.parametrize('count',[0,5,20,21,40,41,100,151,300])
def test_archive_does_not_stop_at_forty(count):
    async def run():
        conn=ArchiveConnection(n=count)
        actor={'id':STUDENT,'account_status':'active','role':'student'}
        received=[]
        cursor=None
        while True:
            page,metadata=await browser_activity._archive_page_rows(
                conn,actor,COURSE,extended=True,before=cursor)
            received.extend(str(r['id']) for r in page)
            assert len(page)<=20
            if not metadata['hasMore']:
                assert metadata['nextCursor'] is None
                break
            assert metadata['nextCursor'] and metadata['nextCursor'] != cursor
            cursor=metadata['nextCursor']
        assert len(received)==count
        assert len(set(received))==count
        assert len(conn.queries)==max(1,(count+19)//20)
    asyncio.run(run())


def test_access_predicates_applied_before_pagination():
    async def run():
        conn=ArchiveConnection(n=151,authorized='alternating')
        actor={'id':STUDENT,'account_status':'active','role':'student'}
        result=[]
        cursor=None
        while True:
            page,p=await browser_activity._archive_page_rows(conn,actor,COURSE,extended=True,before=cursor)
            result.extend(page)
            if not p['hasMore']:break
            cursor=p['nextCursor']
        assert len(result)==76
        assert len({r['id'] for r in result})==76
        assert all('EXISTS' in query for query,_ in conn.queries)
    asyncio.run(run())


def test_role_specific_and_fail_closed_archive():
    async def run():
        c=ArchiveConnection(n=55,authorized='teacher')
        teacher={'id':TEACHER,'account_status':'active','role':'teacher'}
        page,meta=await browser_activity._archive_page_rows(c,teacher,COURSE,extended=True)
        assert len(page)==20 and meta['hasMore']
        for actor in ({'id':STUDENT,'role':'student','account_status':'blocked'},
                      {'id':STUDENT,'role':'guest','account_status':'active'}):
            with pytest.raises(HTTPException) as exc:
                await browser_activity._archive_page_rows(c,actor,COURSE,extended=True)
            assert exc.value.status_code==403
        for cursor in ('nonsense','2026-10-01|injection','2026-10-01|0000|extra',' '*140):
            with pytest.raises(HTTPException) as exc:
                await browser_activity._archive_page_rows(c,teacher,COURSE,extended=True,before=cursor)
            assert exc.value.status_code==400
    asyncio.run(run())
