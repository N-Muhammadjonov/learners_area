"""Local disposable-service capacity probe; never accepts a remote origin/DSN."""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import json
import os
from pathlib import Path
import statistics
import time
from urllib.parse import urlsplit

import aiohttp

LOCAL = {'127.0.0.1', 'localhost', '::1'}


async def batch(origin: str, count: int, path: str, *, method: str = 'GET',
                cookies: list[str] | None = None) -> dict:
    async def one(index: int) -> tuple[str, float]:
        jar = aiohttp.CookieJar(unsafe=True)
        if cookies:
            jar.update_cookies({'la_session': cookies[index % len(cookies)]})
        timeout = aiohttp.ClientTimeout(total=30)
        start = time.perf_counter()
        try:
            async with aiohttp.ClientSession(cookie_jar=jar, timeout=timeout) as session:
                options = {'headers': {'Origin': origin}} if method == 'POST' else {}
                if method == 'POST':
                    options['json'] = {'email': f'capacity-{index}@example.invalid',
                                       'password': 'Capacity-test-only-2026!'}
                async with session.request(method, origin + path, allow_redirects=False, **options) as response:
                    await response.read()
                    result = str(response.status)
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            result = type(exc).__name__
        return result, (time.perf_counter() - start) * 1000
    started = time.perf_counter()
    rows = await asyncio.gather(*(one(index) for index in range(count)))
    durations = sorted(row[1] for row in rows)
    return {'path': path, 'concurrency': count, 'statuses': dict(Counter(row[0] for row in rows)),
            'elapsed_seconds': round(time.perf_counter() - started, 3),
            'median_ms': round(statistics.median(durations), 2),
            'p95_ms': round(durations[min(len(rows)-1, int(len(rows)*.95))], 2)}


async def reset_rates() -> None:
    dsn = os.environ.get('CAPACITY_DATABASE_URL', '')
    parsed = urlsplit(dsn)
    if (parsed.scheme not in {'postgres', 'postgresql'} or parsed.hostname not in LOCAL
            or not (parsed.path == '/coin_qa' or parsed.path.startswith('/capacity_'))):
        raise ValueError('Rate reset requires a loopback-only disposable coin_qa/capacity_* DSN')
    import asyncpg
    connection = await asyncpg.connect(dsn)
    try:
        await connection.execute('TRUNCATE api_rate_buckets')
    finally:
        await connection.close()


async def run(args: argparse.Namespace) -> None:
    origin = args.origin.rstrip('/')
    parsed = urlsplit(origin)
    if (parsed.scheme not in {'http', 'https'} or parsed.hostname not in LOCAL
            or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password):
        raise ValueError('Only a local disposable HTTP service is allowed')
    cookies = json.loads(Path(args.cookies).read_text()) if args.cookies else []
    if not isinstance(cookies, list) or any(not isinstance(value, str) or not value for value in cookies):
        raise ValueError('Cookies must be a JSON array of local test-session cookie values')
    rows = []
    for path, method in [('/', 'GET'), ('/api/auth/login', 'POST')]:
        if args.reset_rates:
            await reset_rates()
        rows.append(await batch(origin, args.users, path, method=method))
    for path in ['/api/frontend/session', '/api/frontend/view?route=/app&region=dashboard']:
        if not cookies:
            rows.append({'path': path, 'skipped': 'Local authenticated session cookies were not supplied'})
            continue
        if args.reset_rates:
            await reset_rates()
        rows.append(await batch(origin, args.users, path, cookies=cookies))
    print(json.dumps({'phase': args.phase, 'origin': origin, 'rows': rows}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--origin', default='http://127.0.0.1:8093')
    parser.add_argument('--users', type=int, choices=range(1, 201), default=30, metavar='1..200')
    parser.add_argument('--phase', choices=['before', 'after'], required=True)
    parser.add_argument('--cookies', help='JSON file containing only disposable local session cookies')
    parser.add_argument('--reset-rates', action='store_true')
    asyncio.run(run(parser.parse_args()))
