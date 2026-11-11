"""Per-worker admission and bounded blocking work; no user or database authority."""
import asyncio
import logging
import weakref
from dataclasses import dataclass, field

from starlette.responses import JSONResponse
from starlette.datastructures import QueryParams
from starlette.exceptions import HTTPException

LOG = logging.getLogger('uvicorn.error')


class WorkBusy(Exception):
    pass


def unavailable(reason='busy'):
    return JSONResponse({'error': 'service_unavailable', 'reason': reason}, 503,
                        headers={'Cache-Control': 'private, no-store', 'Retry-After': '1',
                                 'X-Content-Type-Options': 'nosniff'})


@dataclass
class WorkerState:
    active: int = 0
    bulk: int = 0
    streams: int = 0
    media: int = 0
    exports: int = 0
    probes: int = 0
    draining: bool = False
    work_slots: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(2))
    io_slots: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(4))
    jobs: set = field(default_factory=set)


class WorkerControl:
    def __init__(self):
        self.states = weakref.WeakKeyDictionary()

    def state(self):
        loop = asyncio.get_running_loop()
        reference = self.states.get(loop)
        state = reference() if reference else None
        if state is None:
            state = WorkerState()
            self.states[loop] = weakref.ref(state)
        return state

    def start(self):
        state = self.state()
        state.draining = False
        LOG.info('Request budgets ready: ordinary=64 bulk=4 streams=256 media=64 blocking=2 storage=4 workers=1')
        return state

    async def run_blocking(self, func, *args, **kwargs):
        state = self.state()
        return await self._run(state, state.work_slots, func, args, kwargs)

    async def run_io(self, func, *args, **kwargs):
        state = self.state()
        return await self._run(state, state.io_slots, func, args, kwargs)

    async def _run(self, state, slots, func, args, kwargs):
        if state.draining:
            raise WorkBusy('worker_draining')
        try:
            await asyncio.wait_for(slots.acquire(), timeout=1)
        except TimeoutError:
            raise WorkBusy('blocking_work_busy') from None
        if state.draining:
            slots.release()
            raise WorkBusy('worker_draining')
        # Cancelling an HTTP waiter cannot stop a running thread. Keep its slot
        # reserved until the actual work ends, rather than over-admitting work.
        job = asyncio.create_task(asyncio.to_thread(func, *args, **kwargs))
        state.jobs.add(job)

        def finished(task):
            state.jobs.discard(task)
            slots.release()
            if not task.cancelled():
                task.exception()  # Retrieve failures even if the HTTP waiter disconnected.

        job.add_done_callback(finished)
        return await asyncio.shield(job)

    async def drain(self, timeout=5, *, state=None):
        state = state or self.state()
        state.draining = True
        if state.jobs:
            _, pending = await asyncio.wait(tuple(state.jobs), timeout=timeout)
            if pending:
                LOG.warning('Shutdown blocking-work grace expired: pending=%s', len(pending))


control = WorkerControl()
run_blocking = control.run_blocking
run_io = control.run_io


class RequestBudget:
    def __init__(self, app, *, controller=control, ordinary=64, bulk=4, streams=256,media=64,
                 read_timeout=30, body_timeout=30, probe_timeout=5):
        self.app = app
        self.control = controller
        self.ordinary = ordinary
        self.bulk = bulk
        self.streams = streams
        self.media = media
        self.read_timeout = read_timeout
        self.body_timeout = body_timeout
        self.probe_timeout = probe_timeout

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        state = self.control.state()
        path, method = scope.get('path', ''), scope.get('method', 'GET')
        probe = path in ('/health', '/healthz', '/readyz')
        stream = path == '/api/auth/changes' and method == 'GET'
        media = path.startswith(('/api/resources/','/api/mocks/media/')) and method=='GET' and QueryParams(scope.get('query_string',b'')).get('capability')!='1'
        export = method=='GET' and path.startswith('/api/staff/mocks/exports/') and path.endswith('/download')
        bulk = (path == '/api/reports' or path.startswith('/api/uploads') or path.endswith('/import')
                or path=='/api/staff/mocks/materials' or path.endswith('/speaking/responses') or export)
        if path in ('/health', '/healthz'):
            return await self.app(scope, receive, send)
        rejected = state.draining or (probe and (state.probes >= 2 or state.active >= self.ordinary))
        if not probe:
            rejected |= state.streams >= self.streams if stream else state.media >= self.media if media else (
                state.active >= self.ordinary or bulk and state.bulk >= self.bulk)
            rejected |= export and state.exports>=1
        if rejected:
            return await unavailable('draining' if state.draining else 'busy')(scope, receive, send)
        if probe:
            state.probes += 1
        elif stream:
            state.streams += 1
        elif media:
            state.media += 1
        else:
            state.active += 1
            state.bulk += int(bulk)
            state.exports += int(export)
        started = False
        body_done = False
        body_deadline = None
        body_bytes=0
        upload_limit=(11*1024*1024 if path.endswith('/speaking/responses') else
                      49*1024*1024 if path=='/api/staff/mocks/materials' else None)
        # Do not impose an arbitrary cancellation deadline on a mutating route:
        # its database/provider operations have their own bounds. Safe view reads
        # have a response-start deadline; an established file/SSE stream is intact.
        # The frequent session handshake has only bounded database operations;
        # retain those bounds without allocating a request timer for each poll.
        safe_read = method in ('GET', 'HEAD') and not path.startswith('/api/auth/') and path != '/api/frontend/session'
        timeout = self.probe_timeout if probe else self.read_timeout if safe_read and not stream else None

        async def bounded_receive():
            nonlocal body_done, body_deadline,body_bytes
            if started or body_done:
                return await receive()
            if body_deadline is None:
                body_deadline = asyncio.get_running_loop().time() + self.body_timeout
            async with asyncio.timeout_at(body_deadline):
                message = await receive()
            if message['type']=='http.request':
                body_bytes+=len(message.get('body',b''))
                if upload_limit and body_bytes>upload_limit:
                    raise HTTPException(413,'upload_too_large')
            if message['type'] == 'http.request' and not message.get('more_body', False):
                body_done = True
            return message

        deadline = None
        async def guarded_send(message):
            nonlocal started
            if message['type'] == 'http.response.start':
                started = True
                if deadline is not None:deadline.reschedule(None)
            await send(message)

        # HTTP framing gives a bodyless GET/HEAD no incoming payload to time.
        bodyless = method in ('GET','HEAD') and not any(
            k.lower()==b'transfer-encoding' or k.lower()==b'content-length' and v.strip()!=b'0'
            for k,v in scope.get('headers',()))
        incoming = receive if bodyless else bounded_receive
        try:
            if timeout is None:
                await self.app(scope, incoming, guarded_send)
            else:
                async with asyncio.timeout(timeout) as deadline:
                    await self.app(scope, incoming, guarded_send)
        except (TimeoutError, WorkBusy) as exc:
            if started:
                raise  # Never append a second response or claim a partial stream succeeded.
            await unavailable('busy' if isinstance(exc, WorkBusy) else 'request_timeout')(scope, receive, send)
        finally:
            if probe:
                state.probes -= 1
            elif stream:
                state.streams -= 1
            elif media:
                state.media -= 1
            else:
                state.active -= 1
                state.bulk -= int(bulk)
                state.exports -= int(export)
