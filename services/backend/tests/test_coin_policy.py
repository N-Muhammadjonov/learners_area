"""Coin rules that must hold without a database."""
from datetime import datetime, timedelta, timezone

from app.coin_policy import (advance_playback, answers_complete, coin_level, credit_timeline,
                             grammar_submission_ok, short_media_ready, vocab_milestone_coins)

T0 = datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc)


def beat(state, seconds, position_s, rate=1, playing=True, duration_s=None):
    return advance_playback(
        state, T0 + timedelta(seconds=seconds), position_ms=int(position_s * 1000),
        playback_rate=rate, playing=playing,
        duration_ms=None if duration_s is None else int(duration_s * 1000))


def test_partial_and_replay_answers_pay_nothing():
    assert answers_complete(["yes"]) is True
    assert answers_complete(["yes", "  "]) is False
    assert answers_complete([]) is False
    assert vocab_milestone_coins(4) == 0
    assert vocab_milestone_coins(5) == 1
    assert vocab_milestone_coins(10) == 2


def test_level_uses_lifetime_not_a_spend_balance():
    assert coin_level(0) == 1
    assert coin_level(9) == 1
    assert coin_level(10) == 2
    assert coin_level(750) == 10
    assert coin_level(1000) == 11


def test_five_minutes_of_real_playback_pays_one_bucket_and_replay_pays_none():
    step = beat(None, 0, 0)
    state = step["state"]
    paid = []
    for index in range(1, 22):
        step = beat(state, index * 15, index * 15)
        state = step["state"]
        paid.extend(step["buckets"])
    assert paid == [0]
    replay = beat(state, 22 * 15, 15)
    assert replay["buckets"] == []
    assert replay["credit_ms"] == 0


def test_pause_and_seek_do_not_mint_time():
    first = beat(None, 0, 0)
    paused = beat(first["state"], 30, 0, playing=False)
    assert paused["credit_ms"] == 0 and paused["buckets"] == []
    sought = beat(paused["state"], 50, 120)
    assert sought["credit_ms"] == 0 and sought["buckets"] == []


def test_double_speed_credits_content_time_not_wall_clock_twice():
    first = beat(None, 0, 0, rate=2)
    step = beat(first["state"], 10, 20, rate=2)
    assert step["credit_ms"] == 20000
    assert step["buckets"] == []


def test_short_media_needs_eighty_percent_verified():
    assert short_media_ready(60_000, 47_000, 47_000) is False
    assert short_media_ready(60_000, 48_000, 48_000) is True
    assert short_media_ready(600_000, 500_000, 500_000) is False
    coverage, paid = {}, set()
    assert credit_timeline(coverage, paid, 0, 300_000) == [0]
    assert credit_timeline(coverage, paid, 0, 300_000) == []


def test_grammar_book_requires_every_answer_and_refuses_local_audio():
    mcq = {"kind": "mcq", "items": [{"a": "A"}, {"a": "B"}]}
    assert grammar_submission_ok(mcq, ["x", "wrong"]) is True
    assert grammar_submission_ok(mcq, ["x"]) is False
    assert grammar_submission_ok({"kind": "speak", "items": [{"q": "hi"}]}, ["said it"]) is False
    write = {"kind": "write", "min": 3}
    assert grammar_submission_ok(write, ["one two"]) is False
    assert grammar_submission_ok(write, ["one two three"]) is True
