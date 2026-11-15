"""Security contracts for the pinned ASGI request URL implementation."""
from __future__ import annotations

import pytest
from starlette.requests import Request


@pytest.mark.parametrize('host', [
    b'testserver/api/guardian/children?ignored=',
    b'testserver#fragment',
    b'testserver@attacker.invalid',
])
def test_malformed_host_cannot_change_the_authorized_request_path(host: bytes) -> None:
    request = Request({
        'type': 'http', 'method': 'GET', 'scheme': 'https',
        'path': '/api/staff/finance/summary', 'query_string': b'',
        'server': ('testserver', 443), 'headers': [(b'host', host)],
    })
    assert request.url.path == '/api/staff/finance/summary'
    assert request.url.hostname == 'testserver'


def test_invalid_request_target_cannot_replace_the_url_authority() -> None:
    request = Request({
        'type': 'http', 'method': 'GET', 'scheme': 'https',
        'path': '@attacker.invalid', 'query_string': b'',
        'server': ('testserver', 443), 'headers': [(b'host', b'testserver')],
    })
    assert request.url.hostname == 'testserver'
    assert request.url.path == '/@attacker.invalid'
