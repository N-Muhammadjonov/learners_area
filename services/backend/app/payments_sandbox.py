"""Sandbox provider adapter for the tuition payment callback path.

**This is not a live merchant integration and must never be described as one.** Click and
Payme each publish their own merchant API contracts, signatures and credential models, and
neither the endpoint nor the signature algorithm may be guessed. Until the owner provisions a
real merchant account (`docs/SALE_READY_MANUAL_ACTIONS.md`, MA-01) this module is the only
provider path that exists, and it is:

* **disabled unless `TUITION_PROVIDER_SANDBOX=1`** — the route answers 404 otherwise, so it is
  indistinguishable from a route that does not exist;
* authenticated by an HMAC-SHA256 signature over the canonical payload, computed with
  `TUITION_SANDBOX_SECRET`, compared in constant time;
* bound to the pending intent by the ledger, which re-checks amount, currency, customer and
  order. A valid signature on a different order is still rejected.

Status is therefore `VERIFIED_LOCALLY`, never `VERIFIED_IN_PRODUCTION`.

A real adapter must implement the same surface (`validate_notification`, `normalize_event`,
`query_status`, `cancel_or_refund_if_supported`, `reconciliation_report`, `provider_health`)
against the vendor's documented contract — see `docs/architecture/DOMAIN_CONTRACTS.md` §8.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os

SIGNATURE_HEADER = 'x-la-sandbox-signature'
#: Keys that take part in the signature. Anything outside this set is ignored, so an
#: attacker cannot add fields that change meaning without changing the signature.
CANONICAL_KEYS = ('amountMinor', 'currency', 'orderRef', 'provider', 'status',
                  'studentUserId', 'transactionId')


def enabled() -> bool:
    return os.environ.get('TUITION_PROVIDER_SANDBOX') == '1'


def secret() -> str | None:
    value = (os.environ.get('TUITION_SANDBOX_SECRET') or '').strip()
    return value or None


def header_value(headers, name: str) -> str:
    """Read one header from a Starlette `Headers`, a plain dict, or raw ASGI pairs."""
    getter = getattr(headers, 'get', None)
    if callable(getter):
        return str(getter(name) or '')
    for pair in headers or ():
        key, _, value = pair if len(pair) >= 2 else (pair, '', '')
        if isinstance(key, bytes):
            key = key.decode('latin-1')
        if key.lower() == name:
            return value.decode('latin-1') if isinstance(value, bytes) else str(value)
    return ''


def canonical(payload: dict) -> bytes:
    """Stable byte form of the financial semantic keys, independent of key order."""
    return json.dumps({key: payload.get(key) for key in CANONICAL_KEYS},
                      sort_keys=True, separators=(',', ':')).encode()


def sign(payload: dict, key: str | None = None) -> str:
    key = key or secret()
    if not key:
        raise ValueError('sandbox_secret_not_configured')
    return hmac.new(key.encode(), canonical(payload), hashlib.sha256).hexdigest()


def validate_notification(headers, raw: bytes):
    """Return ``(payload, None)`` when the signature is valid, else ``(None, reason)``.

    Never raises for a bad request: a callback endpoint that leaks why it rejected a payload
    is an oracle for forging one.
    """
    key = secret()
    if not key:
        return None, 'not_configured'
    presented = header_value(headers, SIGNATURE_HEADER).strip()
    if not presented:
        return None, 'missing_signature'
    try:
        payload = json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, 'malformed_payload'
    if not isinstance(payload, dict):
        return None, 'malformed_payload'
    expected = sign(payload, key)
    if not hmac.compare_digest(expected, presented):
        return None, 'invalid_signature'
    for required in ('provider', 'transactionId', 'status'):
        if not payload.get(required):
            return None, 'incomplete_payload'
    return payload, None
