"""Behavioral compatibility with the campus branch's existing UI/API contract.

The supplied package targets a later Next.js revision. Request-local selection
keeps its upstream regression tests available while the ASGI deployment serves
the current preview's contract. Authentication and session revocation are shared.
"""
from contextvars import ContextVar

current_preview = ContextVar('current_preview', default=False)
