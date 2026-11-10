"""Deterministic study scheduling and readiness estimates from graded evidence."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from statistics import median

SKILLS = ("listening", "reading", "writing", "speaking")
FORECAST_VERSION = "assessment-trend-v1"


@dataclass(frozen=True)
class Candidate:
    key: str
    skill: str
    title: str
    href: str
    reason: str
    minutes: int
    priority: int
    state: str = "planned"
    due_on: date | None = None
    opens_on: date | None = None


def allocate(
    candidates: list[Candidate],
    today: date,
    weekdays: set[int],
    minutes: int,
    reserved: dict[date, int],
    previous: dict[str, date],
    pinned: set[str],
) -> dict[str, date]:
    """Place due work first and preserve planned dates when capacity allows."""
    days = [today + timedelta(days=offset) for offset in range(7)]
    remaining = {day: max(0, minutes - reserved.get(day, 0)) for day in days}
    allocated = {}
    for item in sorted(candidates, key=lambda task: (
        task.priority, task.due_on or date.max, task.key
    )):
        eligible = [
            day for day in days
            if (day.weekday() in weekdays or day == item.due_on)
            and (item.opens_on is None or day >= item.opens_on)
            and (item.due_on is None or day <= max(today, item.due_on))
            and remaining[day] >= item.minutes
        ]
        preferred = previous.get(item.key)
        chosen = preferred if item.key in pinned and preferred in eligible else next(iter(eligible), None)
        if chosen:
            allocated[item.key] = chosen
            remaining[chosen] -= item.minutes
    return allocated


def estimate(history: list[dict], target: float | None, today: date) -> dict | None:
    """Estimate an interval using observed change across complete skill snapshots."""
    if target is None:
        return None
    by_day = {}
    for sample in history:
        day = sample["day"]
        if sample["skill"] == "overall" and today - timedelta(days=120) <= day <= today:
            by_day[day] = sample["band"]
    points = sorted(by_day.items())[-8:]
    if len(points) < 4 or (points[-1][0] - points[0][0]).days < 21:
        return None
    latest_day, latest_band = points[-1]
    if (today - latest_day).days > 28:
        return None
    slopes = [
        (right_band - left_band) / (right_day - left_day).days
        for index, (left_day, left_band) in enumerate(points)
        for right_day, right_band in points[index + 1:]
        if (right_day - left_day).days >= 7
    ]
    rate = median(slopes) if slopes else 0
    if latest_band >= target:
        return {"from": latest_day.isoformat(), "through": today.isoformat(),
                "confidence": "observed", "version": FORECAST_VERSION, "samples": len(points)}
    if rate <= 0 or sum(slope > 0 for slope in slopes) * 3 < len(slopes) * 2:
        return None
    days = (target - latest_band) / rate
    if days > 180:
        return None
    low = max(today, latest_day + timedelta(days=max(7, round(days * 0.75))))
    high = max(low, latest_day + timedelta(days=round(days * 1.35) + 7))
    spread = median(abs(slope - rate) for slope in slopes)
    confidence = "medium" if len(points) >= 6 and spread <= rate / 2 else "low"
    return {"from": low.isoformat(), "through": high.isoformat(), "confidence": confidence,
            "version": FORECAST_VERSION, "samples": len(points)}


def study_streak(days: set[date], today: date) -> int:
    anchor = today if today in days else today - timedelta(days=1)
    length = 0
    while anchor - timedelta(days=length) in days:
        length += 1
    return length


def band_value(value: object) -> bool:
    return type(value) in (float, int) and 1 <= value <= 9 and value * 2 % 1 == 0
