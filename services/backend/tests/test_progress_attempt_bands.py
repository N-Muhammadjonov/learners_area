from datetime import date, datetime, timezone
from uuid import uuid4

import pytest

from app.browser_trends import RECENT_BAND_LIMIT, attempt_band_summary


class AttemptConnection:
    def __init__(self, row, owner, skill):
        self.row = row
        self.owner = owner
        self.skill = skill

    async def fetchrow(self, sql, user_id, limit, first_week):
        assert f'FROM {self.skill}_attempts' in sql
        assert 'user_id=$1' in sql and "status='completed'" in sql
        assert 'total_questions=40' in sql
        assert 'DISTINCT ON' in sql and 'a.submitted_at, a.id' in sql
        assert ('a.passage_id' if self.skill == 'reading' else 'a.test_id') in sql
        assert first_week.isoformat() == '2026-10-05T00:00:00+05:00'
        assert user_id == self.owner
        assert limit == RECENT_BAND_LIMIT
        return self.row


@pytest.mark.asyncio
@pytest.mark.parametrize(('skill', 'average'), [('reading', 7.06), ('listening', 7.41)])
async def test_band_average_uses_all_completed_full_scores_not_only_chart_points(skill, average):
    user_id = uuid4()
    submitted = datetime(2026, 11, 25, 21, tzinfo=timezone.utc)
    today = date(2026, 11, 26)
    row = {
        'completed': 22, 'accuracy': 78.4, 'score_counts': [[32, 12], [39, 4], [0, 1]],
        'first_score': 0, 'recent_scores': [32] * 8 + [39] * 4, 'recent_dates': [submitted] * 12,
        'weekly_dates': [date(2026, 11, 23)], 'weekly_accuracy': [80], 'weekly_attempts': [2],
    }
    result = await attempt_band_summary(AttemptConnection(row, user_id, skill), user_id, skill, today=today)
    weekly = result.pop('weekly')
    assert len(weekly) == 8
    assert weekly[0] == {'weekStart': '2026-10-05', 'value': None, 'count': 0}
    assert weekly[-1] == {'weekStart': '2026-11-23', 'value': 80, 'count': 2}
    assert result == {
        'completed': 22, 'accuracy': 78.4, 'bandCount': 17,
        'averageBand': average, 'bestBand': 9, 'firstBand': 0,
        'recent': ([{'day': '2026-11-26', 'band': 7 if skill == 'reading' else 7.5}] * 8
                   + [{'day': '2026-11-26', 'band': 9}] * 4),
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(('completed', 'accuracy'), [(0, None), (3, 0)])
async def test_empty_or_short_attempts_never_get_a_band(completed, accuracy):
    user_id = uuid4()
    row = {
        'completed': completed, 'accuracy': accuracy, 'score_counts': [],
        'first_score': None, 'recent_scores': [], 'recent_dates': [],
        'weekly_dates': [], 'weekly_accuracy': [], 'weekly_attempts': [],
    }
    result = await attempt_band_summary(
        AttemptConnection(row, user_id, 'reading'), user_id, 'reading', today=date(2026, 11, 26))
    assert all(point['count'] == 0 and point['value'] is None for point in result.pop('weekly'))
    assert result == {
        'completed': completed, 'accuracy': accuracy, 'bandCount': 0,
        'averageBand': None, 'bestBand': None, 'firstBand': None, 'recent': [],
    }


@pytest.mark.asyncio
async def test_only_the_first_scored_attempt_per_passage_or_test_counts():
    import os

    import asyncpg

    try:
        connection = await asyncpg.connect('postgresql://coin_qa:coin_qa_local@127.0.0.1:55439/coin_qa')
    except OSError:
        if os.getenv('CI'):
            raise
        pytest.skip('Disposable PostgreSQL is unavailable')
    try:
        await connection.execute("""
            CREATE TEMP TABLE reading_attempts (
                id integer PRIMARY KEY, user_id integer, passage_id integer, status text,
                score integer, total_questions integer, submitted_at timestamptz
            );
            CREATE TEMP TABLE reading_assessments (attempt_id integer PRIMARY KEY, set_id integer);
            CREATE TEMP TABLE listening_attempts (
                id integer PRIMARY KEY, user_id integer, test_id integer, status text,
                score integer, total_questions integer, submitted_at timestamptz
            );
            INSERT INTO reading_attempts VALUES
                (1, 1, 1, 'completed', 1, 10, '2026-09-01T10:00Z'),
                (2, 2, 1, 'completed', 10, 10, '2026-08-01T10:00Z');
            INSERT INTO reading_attempts
                SELECT n + 2, 1, 1, 'completed', 10, 10, '2026-11-24T10:00Z' FROM generate_series(1,9) n;
        """)
        today = date(2026, 11, 25)
        first = await attempt_band_summary(connection, 1, 'reading', today=today)
        assert first['completed'] == 1 and first['accuracy'] == 10
        assert first['weekly'][-1] == {'weekStart': '2026-11-23', 'count': 0, 'value': None}

        await connection.execute("""
            INSERT INTO reading_attempts
                SELECT n + 20, 1, n, 'completed', n, 10, '2026-11-24T10:00Z' FROM generate_series(2,10) n;
        """)
        passages = await attempt_band_summary(connection, 1, 'reading', today=today)
        assert passages['completed'] == 10 and passages['accuracy'] == 55
        assert passages['weekly'][-1] == {'weekStart': '2026-11-23', 'count': 9, 'value': 60}

        await connection.execute("""
            INSERT INTO reading_attempts VALUES
                (31, 1, 1, 'completed', 30, 40, '2026-11-24T10:00Z'),
                (32, 1, 1, 'completed', 40, 40, '2026-11-25T10:00Z'),
                (33, 1, 1, 'completed', 34, 40, '2026-11-25T10:00Z');
            INSERT INTO reading_assessments VALUES (31, 1), (32, 1), (33, 2);
            INSERT INTO listening_attempts VALUES
                (1, 1, 1, 'completed', 30, 40, '2026-11-23T10:00Z'),
                (2, 1, 1, 'completed', 40, 40, '2026-11-25T10:00Z'),
                (3, 1, 2, 'completed', 32, 40, '2026-11-24T10:00Z'),
                (4, 1, 2, 'in_progress', 40, 40, '2026-11-21T10:00Z');
        """)
        reading = await attempt_band_summary(connection, 1, 'reading', today=today)
        listening = await attempt_band_summary(connection, 1, 'listening', today=today)
        assert reading['completed'] == 12 and reading['bandCount'] == 2
        assert [point['band'] for point in reading['recent']] == [7, 7.5]
        assert listening['completed'] == 2 and listening['accuracy'] == 77.5
        assert listening['averageBand'] == 7.25
    finally:
        await connection.close()
