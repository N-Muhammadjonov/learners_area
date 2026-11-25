from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.browser_trends import RECENT_BAND_LIMIT, attempt_band_summary


class AttemptConnection:
    def __init__(self, row, owner, skill):
        self.row = row
        self.owner = owner
        self.skill = skill

    async def fetchrow(self, sql, user_id, limit):
        assert f'FROM {self.skill}_attempts' in sql
        assert 'user_id=$1' in sql and "status='completed'" in sql
        assert 'total_questions=40' in sql
        assert user_id == self.owner
        assert limit == RECENT_BAND_LIMIT
        return self.row


@pytest.mark.asyncio
@pytest.mark.parametrize(('skill', 'average'), [('reading', 7.06), ('listening', 7.41)])
async def test_band_average_uses_all_completed_full_scores_not_only_chart_points(skill, average):
    user_id = uuid4()
    submitted = datetime(2026, 11, 25, 21, tzinfo=timezone.utc)
    row = {
        'completed': 22, 'accuracy': 78.4, 'score_counts': [[32, 12], [39, 4], [0, 1]],
        'first_score': 0, 'recent_scores': [32] * 8 + [39] * 4, 'recent_dates': [submitted] * 12,
    }
    result = await attempt_band_summary(AttemptConnection(row, user_id, skill), user_id, skill)
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
    }
    result = await attempt_band_summary(AttemptConnection(row, user_id, 'reading'), user_id, 'reading')
    assert result == {
        'completed': completed, 'accuracy': accuracy, 'bandCount': 0,
        'averageBand': None, 'bestBand': None, 'firstBand': None, 'recent': [],
    }
