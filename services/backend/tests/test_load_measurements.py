"""Sustained measurements must count every failure without retaining every reply."""
from load_validation.measurements import Histogram, Measurements


def test_percentiles_are_conservative_and_overflow_cannot_pass() -> None:
    values = Histogram(maximum_ms=10)
    for number in (.1, 1.01, 2.2, 9.8):
        values.add(number)
    assert values.percentile(.5) == 2 and values.percentile(.95) == 10
    values.add(1000)
    assert values.percentile(.99) is None
    assert max(values.buckets) == 11


def test_sustained_histogram_counts_all_rejections_with_bounded_storage() -> None:
    values = Measurements()
    for _ in range(100000):
        values.add('account', 200, 1.25, None)
    values.add('account', 503, 2.5, 'busy')
    result = values.summary()
    assert result['requests'] == 100001 and result['status'] == {200: 100000, 503: 1}
    assert result['errors'] == {'busy': 1} and result['readObjectiveMet'] is False
    assert result['p95Ms'] == 2 and len(values.times.buckets) == 2
    assert result['endpoints']['account']['successfulP95Ms'] == 2
