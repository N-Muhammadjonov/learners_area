from datetime import date, timedelta

from app.study_plan_rules import Candidate, allocate, band_value, estimate, study_streak


def task(key, minutes=20, priority=50, due=None):
    return Candidate(key, "reading", key, "/app/reading", "diagnostic", minutes, priority, due_on=due)


def test_assignments_beat_pinned_practice_and_preserve_capacity():
    monday = date(2026,11,9)
    lesson, homework = task("lesson"), task("assignment", priority=0, due=monday)
    assert allocate([lesson, homework],monday,{0,1},30,{},{"lesson":monday},{"lesson"}) == {
        "assignment":monday,"lesson":monday+timedelta(days=1)}
    assert allocate([lesson],monday,{0},30,{monday:15},{},set()) == {}


def test_streak_uses_previous_day_and_stops_at_gap():
    today = date(2027,1,1)
    days = {today-timedelta(days=n) for n in (1,2,4)}
    assert study_streak(days,today) == 2
    assert study_streak(days|{today},today) == 3
    assert study_streak(days,today+timedelta(days=1)) == 0


def test_forecast_needs_distinct_graded_days_and_positive_trend():
    today = date(2026,11,10)
    history = [{"skill":"overall","day":today-timedelta(days=7*(5-i)),"band":5+i*.5} for i in range(6)]
    assert estimate(history[:2],8.0,today) is None
    result = estimate(history,8.0,today)
    assert result["confidence"] == "medium"
    assert result["from"] <= result["through"]
    assert estimate([{**sample,"band":6.0} for sample in history],8.0,today) is None


def test_band_input_only_accepts_numeric_half_steps():
    assert all(band_value(n) for n in (1,6.5,8,9))
    assert not any(band_value(n) for n in (False,True,0,10,"8",8.1,None,float("nan")))
