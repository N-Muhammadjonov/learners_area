"""Queue global Dictionary writers before borrowing scarce database clients.

PostgreSQL's existing advisory lock remains the cross-instance authority. This
worker-local gate prevents its waiters from occupying the ordinary API pool.
"""
import asyncio
import weakref
from contextlib import asynccontextmanager
from starlette.responses import JSONResponse

_gates=weakref.WeakKeyDictionary()


class DictionaryBusy(TimeoutError):
    pass


@asynccontextmanager
async def dictionary_write_slot(timeout=5):
    loop=asyncio.get_running_loop();reference=_gates.get(loop)
    gate=reference() if reference else None
    if gate is None:
        gate=asyncio.Semaphore(1);_gates[loop]=weakref.ref(gate)
    try:
        async with asyncio.timeout(timeout):await gate.acquire()
    except TimeoutError:
        raise DictionaryBusy('dictionary_busy') from None
    try:yield
    finally:gate.release()


def busy_response():
    return JSONResponse({'error':'temporarily_unavailable'},503,{'Retry-After':'1','Cache-Control':'private, no-store'})
