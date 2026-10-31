"""Isolated, regression-focused multi-tab attendance checks.

The real implementation is imported; no mock of its attendance math is used.
Run with PYTHONPATH=services/backend python -m pytest -q services/backend/tests/test_live_classes_multitab.py
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest

from app import live_classes_port as attendance

CLASS_ID = UUID('11111111-1111-4111-8111-111111111103')
STUDENT_ID = UUID('22222222-2222-4222-8222-222222222203')
TAB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
TAB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
BASE = datetime(2026, 10, 30, 12, tzinfo=timezone.utc)


class AttendanceConn:
    """Simple row-level SQL double. Tests invoke the real attendance helper."""
    def __init__(self):
        self.row = None
        self.activity_events = 0
        self.update_count = 0

    async def fetchrow(self, sql, *args):
        normalized = ' '.join(sql.split())
        if normalized.startswith('INSERT INTO live_class_attendance ('):
            if self.row is not None:
                return None
            self.row = {'id': UUID(int=100), 'live_class_id': CLASS_ID,
                        'user_id': STUDENT_ID, 'joined_at': args[2],
                        'last_seen_at': args[2], 'left_at': None,
                        'estimated_duration_seconds': 0, 'session_count': 1,
                        'active_sessions': {}}
            return {'id': UUID(int=100)}
        if 'FROM live_class_attendance' in normalized and 'FOR UPDATE' in normalized:
            return dict(self.row) if self.row else None
        if normalized.startswith('UPDATE live_class_attendance'):
            assert self.row is not None
            assert args[0] == CLASS_ID and args[1] == STUDENT_ID
            self.row.update({'last_seen_at': args[2], 'left_at': args[3],
                             'estimated_duration_seconds': args[4],
                             'session_count': args[5], 'active_sessions': json.loads(args[6])})
            self.update_count += 1
            return dict(self.row)
        raise AssertionError(f'Unexpected attendance SQL: {normalized}')

    async def execute(self, sql, *args):
        assert 'LIVE_CLASS_ATTENDED' in sql
        self.activity_events += 1


async def send(conn, tab, action, sec):
    return await attendance.record_tab_attendance(
        conn, CLASS_ID, STUDENT_ID, action, tab, BASE + timedelta(seconds=sec))


@pytest.mark.parametrize('first_to_leave', [TAB_A, TAB_B])
def test_other_tab_continues_after_one_leaves(first_to_leave):
    async def scenario():
        db=AttendanceConn()
        await send(db,TAB_A,'join',0)
        await send(db,TAB_B,'join',10)
        await send(db,first_to_leave,'leave',20)
        other=TAB_B if first_to_leave==TAB_A else TAB_A
        assert db.row['left_at'] is None, 'one tab leave must not end the other tab'
        after=await send(db,other,'heartbeat',35)
        assert after['estimatedDurationSeconds']==35
        assert after['sessionCount']==1
        end=await send(db,other,'leave',45)
        assert end['estimatedDurationSeconds']==45
        assert end['sessionCount']==1
        assert db.row['left_at']==BASE+timedelta(seconds=45)
        assert db.row['active_sessions']=={}
        assert db.activity_events==1
    asyncio.run(scenario())


def test_out_of_order_unknown_leave_cannot_close_active_tab():
    async def scenario():
        db=AttendanceConn()
        await send(db,TAB_A,'join',0)
        await send(db,TAB_B,'join',10)
        before=db.update_count
        await send(db,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','leave',11)
        assert db.update_count==before
        await send(db,TAB_A,'leave',20)
        await send(db,TAB_A,'leave',21)
        assert db.row['left_at'] is None
        result=await send(db,TAB_B,'heartbeat',35)
        assert result['estimatedDurationSeconds']==35
        assert result['sessionCount']==1
    asyncio.run(scenario())


def test_separate_visits_count_only_real_new_periods():
    async def scenario():
        db=AttendanceConn()
        await send(db,TAB_A,'join',0)
        await send(db,TAB_A,'leave',30)
        await send(db,TAB_B,'join',40)
        assert db.row['session_count']==2
        await send(db,TAB_B,'leave',60)
        assert db.row['estimated_duration_seconds']==50
        assert db.row['session_count']==2
        # A short (<5s) interruption is one logical session, without adding gap time.
        await send(db,TAB_A,'join',63)
        assert db.row['session_count']==2
        await send(db,TAB_A,'leave',73)
        assert db.row['estimated_duration_seconds']==60
    asyncio.run(scenario())


def test_stale_tab_is_pruned_and_unbounded_gap_is_not_credited():
    async def scenario():
        db=AttendanceConn()
        await send(db,TAB_A,'join',0)
        await send(db,TAB_A,'heartbeat',30)
        recovered=await send(db,TAB_A,'heartbeat',180)
        assert recovered['estimatedDurationSeconds']==30
        assert recovered['sessionCount']==2
        assert list(db.row['active_sessions'])==[TAB_A]
    asyncio.run(scenario())


def test_duplicate_join_does_not_add_attendance_sessions():
    async def scenario():
        db=AttendanceConn()
        await send(db,TAB_A,'join',0)
        await send(db,TAB_A,'join',10)
        await send(db,TAB_A,'heartbeat',30)
        assert db.row['estimated_duration_seconds']==30
        assert db.row['session_count']==1
        assert db.activity_events==1
    asyncio.run(scenario())


def test_session_id_validation_and_per_student_tab_bound():
    for value in ('x', 'not-a-uuid', '', 'bad/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 123):
        with pytest.raises(ValueError):
            attendance.parse_attendance_session_id(value)
    assert attendance.parse_attendance_session_id(TAB_A)==TAB_A
    assert attendance.parse_attendance_session_id(None) is None  # older clients

    async def scenario():
        db=AttendanceConn()
        for i in range(attendance.ATTENDANCE_MAX_ACTIVE_TABS):
            token=f'{i+1:08x}-0000-4000-8000-000000000001'
            await send(db,token,'join',i)
        with pytest.raises(ValueError,match='too_many_active_tabs'):
            await send(db,'ffffffff-ffff-4fff-8fff-ffffffffffff','join',35)
    asyncio.run(scenario())


def test_synchronized_tabs_are_not_starved_by_per_student_throttle():
    async def scenario():
        db=AttendanceConn()
        await send(db,TAB_A,'join',0)
        await send(db,TAB_B,'join',0)
        for second in (30,60,90,120):
            await send(db,TAB_A,'heartbeat',second)
            await send(db,TAB_B,'heartbeat',second)
        assert db.row['active_sessions'][TAB_B].startswith('2026-10-30T12:02:00')
        await send(db,TAB_A,'leave',121)
        after=await send(db,TAB_B,'heartbeat',150)
        assert after['estimatedDurationSeconds']==150
        assert after['sessionCount']==1
        assert db.row['left_at'] is None
    asyncio.run(scenario())
