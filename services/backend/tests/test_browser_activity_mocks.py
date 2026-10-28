"""The shared Mock projection and staff summary stay bounded and disclose truncation."""
from datetime import datetime, timezone
import asyncio

from app.browser_activity import mocks
from app.browser_staff_people import results


class FakeConnection:
    def __init__(self, *, attempts=0, catalogue=0):
        self.attempt_rows = [
            {
                'id': f'00000000-0000-4000-8000-{n:012d}',
                'mock_test_id': None,
                'started_at': datetime(2026, 10, 28, tzinfo=timezone.utc),
                'finished_at': None,
                'raw_score': None,
                'estimated_band': None,
                'mock_snapshot': {'title': 'Saved mock', 'kind': 'full'},
            }
            for n in range(attempts)
        ]
        self.catalogue_rows = [
            {'id': f'11111111-1111-4111-8111-{n:012d}', 'title': f'Mock {n}', 'skill': 'full'}
            for n in range(catalogue)
        ]
        self.statements = []

    async def fetch(self, statement, *args):
        self.statements.append(statement)
        normalized = ' '.join(statement.split())
        if 'FROM mock_tests t JOIN courses c' in normalized:
            assert 'LIMIT 5001' in normalized
            return self.catalogue_rows
        if 'FROM mock_attempts' in normalized:
            assert 'LIMIT 5001' in normalized
            return self.attempt_rows
        if 'FROM mock_tests WHERE id=ANY' in normalized:
            assert len(args[0]) <= 5000
            return []
        raise AssertionError(f'unexpected unbounded query: {statement}')

    async def fetchval(self, statement, *args):
        self.statements.append(statement)
        assert 'WHERE user_id=$1' in statement
        return 0


def test_mock_list_and_staff_results_cap_rows_and_report_truncation():
    con = FakeConnection(attempts=5001, catalogue=5001)
    projection = asyncio.run(mocks(con, '22222222-2222-4222-8222-222222222222'))
    assert len(projection['attempts']) == 5000
    assert projection['attemptsTruncated'] is True
    assert len(projection['tests']) == 5000
    assert projection['catalogueTruncated'] is True
    assert projection['attempts'][0]['title'] == 'Saved mock'

    staff_result = asyncio.run(results(con, '22222222-2222-4222-8222-222222222222'))
    assert len(staff_result['attempts']) == 5000
    assert staff_result['attemptsTruncated'] is True
    assert len(staff_result['testIds']) == 5000
    assert all('LIMIT 5001' in statement for statement in con.statements if 'FROM mock_attempts' in statement or 'FROM mock_tests t JOIN courses' in statement)
