"""Published replacement for old General Reading links."""
from unittest.mock import AsyncMock

import pytest

from app import browser_reading as reading


@pytest.mark.asyncio
async def test_old_general_practice_link_uses_a_single_reviewed_passage():
    class Connection:
        fetch = AsyncMock(return_value=[{'passage_id': 'reviewed-passage', 'passage_no': 1}])

    connection = Connection()
    for source_ref, external_id in reading.STANDALONE_REPLACEMENTS.items():
        assert await reading.standalone_replacement(connection, source_ref) == [
            {'passage_id': 'reviewed-passage', 'passage_no': 1}]
        query, bound_id = connection.fetch.await_args.args
        assert bound_id == external_id
        assert 'JOIN general_reading_passages' in query
    assert len(reading.STANDALONE_REPLACEMENTS) == 5

    connection.fetch.reset_mock()
    assert await reading.standalone_replacement(connection, 'unrelated-set') == []
    connection.fetch.assert_not_awaited()

    connection.fetch.return_value = [
        {'passage_id': 'reviewed-passage', 'passage_no': 1},
        {'passage_id': 'duplicate-passage', 'passage_no': 1},
    ]
    source_ref = next(iter(reading.STANDALONE_REPLACEMENTS))
    assert await reading.standalone_replacement(connection, source_ref) == []
