"""Synthetic warm-file ASGI allocation benchmark, not public HTTP latency."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import statistics
import sys
import tempfile
import time
import tracemalloc

sys.path.insert(0, str(Path(sys.argv[1]).resolve()))
import httpx
from app.frontend_static import StaticFrontend


async def main():
    with tempfile.TemporaryDirectory(prefix='la-static-range-') as directory:
        root = Path(directory)
        payload = root / 'js/large.bin'
        payload.parent.mkdir()
        payload.write_bytes(b'x' * (32 * 1024 * 1024))
        sha = hashlib.sha256(payload.read_bytes()).hexdigest()
        (root / 'asset-manifest.json').write_text(json.dumps({
            'version': 1, 'revision': '1234567890abcdef1234',
            'routes': ['/'], 'files': {'js/large.bin': {'sha256': sha, 'bytes': payload.stat().st_size}},
        }))
        os.environ['FRONTEND_DIST'] = str(root)
        samples = []
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=StaticFrontend()), base_url='https://fixture.invalid') as client:
            async def request():
                start = time.perf_counter()
                r = await client.get('/assets/1234567890abcdef1234/js/large.bin', headers={'Range': 'bytes=0-9'})
                assert r.status_code == 206 and r.content == b'x' * 10
                return (time.perf_counter() - start) * 1000
            for _ in range(3):
                await request()
            tracemalloc.start()
            for _ in range(20):
                samples.append(await request())
            _, peak = tracemalloc.get_traced_memory()
            tracemalloc.stop()
        result = {'method': 'in-process ASGI, warm OS file cache, 3 warmups; no network emulation',
                  'python': sys.version.split()[0], 'samples': 20, 'assetBytes': payload.stat().st_size,
                  'requestedBytes': 10, 'peakTracedBytes': peak, 'p50Ms': statistics.median(samples),
                  'p95Ms': sorted(samples)[18], 'p99Ms': None, 'p99Reason': '20 samples is insufficient for a useful tail estimate',
                  'latenciesMs': samples}
        Path(sys.argv[2]).write_text(json.dumps(result, indent=2))
        print(json.dumps({k: v for k, v in result.items() if k != 'latenciesMs'}))


asyncio.run(main())
