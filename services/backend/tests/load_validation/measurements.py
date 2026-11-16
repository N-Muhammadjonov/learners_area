"""Bounded, all-request histograms for sustained HTTP measurements."""
from __future__ import annotations

from collections import Counter
import math


class Histogram:
    """One-millisecond upper bounds, with an explicit overflow bucket."""
    def __init__(self, maximum_ms: int = 60000) -> None:
        self.maximum_ms = maximum_ms
        self.buckets: Counter[int] = Counter()
        self.count = 0

    def add(self, milliseconds: float) -> None:
        if not math.isfinite(milliseconds) or milliseconds < 0:
            raise ValueError('invalid_latency')
        bucket = min(math.ceil(milliseconds), self.maximum_ms + 1)
        self.buckets[bucket] += 1
        self.count += 1

    def percentile(self, point: float) -> int | None:
        if not 0 < point <= 1:
            raise ValueError('invalid_percentile')
        if not self.count:
            return None
        target = max(1, math.ceil(self.count * point))
        seen = 0
        for bucket, count in sorted(self.buckets.items()):
            seen += count
            if seen >= target:
                return bucket if bucket <= self.maximum_ms else None
        raise AssertionError('histogram_count_mismatch')


class Measurements:
    def __init__(self) -> None:
        self.times = Histogram()
        self.status: Counter[int] = Counter()
        self.errors: Counter[str] = Counter()
        self.endpoints: dict[str, Measurements] = {}

    def add(self, name: str, code: int, milliseconds: float, reason: str | None) -> None:
        self.times.add(milliseconds)
        self.status[code] += 1
        if reason:
            self.errors[reason] += 1
        if name:
            endpoint = self.endpoints.setdefault(name, Measurements())
            endpoint.add('', code, milliseconds, reason)
            if code == 200:
                success = endpoint.endpoints.setdefault('success', Measurements())
                success.times.add(milliseconds)

    def summary(self) -> dict:
        endpoints = {name: {
            'requests': row.times.count, 'status': dict(row.status),
            'p95Ms': row.times.percentile(.95),
            'successfulP95Ms': row.endpoints['success'].times.percentile(.95) if 'success' in row.endpoints else None,
        } for name, row in sorted(self.endpoints.items())}
        p95, p99 = self.times.percentile(.95), self.times.percentile(.99)
        return {
            'requests': self.times.count, 'status': dict(self.status),
            'p50Ms': self.times.percentile(.5), 'p95Ms': p95, 'p99Ms': p99,
            'errors': dict(self.errors), 'endpoints': endpoints,
            'latencyResolutionMs': 1, 'latencyOverflow': self.times.buckets[self.times.maximum_ms + 1],
            'readObjectiveMet': self.times.count > 0 and self.status[200] == self.times.count
                and p95 is not None and p95 <= 300 and p99 is not None and p99 <= 1500
                and all(row['p95Ms'] is not None and row['p95Ms'] <= 300 for row in endpoints.values()),
        }
