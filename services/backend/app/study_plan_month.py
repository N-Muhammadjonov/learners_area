"""Schedule a 30-day cycle from placement evidence and verified practice."""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from .study_plan_diagnostic import SKILLS

MONTH_DAYS = 30
PRACTICE_LINKS = {
    "listening": "/app/listening/general",
    "reading": "/app/reading/general",
    "writing": "/app/writing?tab=exam",
    "grammar": "/app/grammar",
}
PHASES = ("foundation", "accuracy", "timed", "transfer", "review")


def make_schedule(start: date, today: date, goal: dict, diagnosis: dict,
                  previous: list[dict], practiced: dict[str, set[str]]) -> list[dict]:
    """Keep past tasks stable and spread new work over the remaining study days."""
    scheduled = {day["date"]: day for day in previous}
    counts = Counter(task["skill"] for day in previous if day["date"] < today.isoformat() for task in day["tasks"])
    completed = Counter(skill for skills in practiced.values() for skill in skills)
    weights = {}
    accuracy = {}
    topics = {}
    for skill in SKILLS:
        score = diagnosis[skill]
        accuracy[skill] = score["correct"] / score["total"]
        weakness = 1 - accuracy[skill]
        # Existing activity is a pacing signal. It does not change the diagnostic score.
        weights[skill] = 1 + 2 * weakness / (1 + 0.15 * completed[skill]) + (0.35 if skill in goal["focusSkills"] else 0)
        ordered = sorted(score["topics"], key=lambda topic: (
            score["topics"][topic]["correct"] / score["topics"][topic]["total"],
            -score["topics"][topic]["total"], topic,
        ))
        if skill == "writing" and score.get("sample",{}).get("sentences",3) < 3 and "cohesion" in ordered:
            ordered.remove("cohesion")
            ordered.insert(0,"cohesion")
        topics[skill] = ordered

    weekdays = set(goal["weekdays"])
    budget = goal["minutes"]
    blocks = 1 if budget < 35 else 2 if budget < 65 else 3 if budget < 120 else 4
    standard_block = budget//(blocks+1)
    last_skills = set()
    plan = []
    for offset in range(MONTH_DAYS):
        day = start + timedelta(days=offset)
        key = day.isoformat()
        if day < today and key in scheduled:
            plan.append(scheduled[key])
            if scheduled[key]["tasks"]:
                last_skills = {task["skill"] for task in scheduled[key]["tasks"]}
            continue

        phase = PHASES[min(offset//7,len(PHASES)-1)]
        exam = goal.get("examDate")
        if exam and timedelta(0) <= exam-day <= timedelta(days=5) and phase in ("foundation","accuracy"):
            phase = "timed"
        tasks = []
        if day.weekday() in weekdays:
            skills = sorted(SKILLS, key=lambda skill: (
                -(weights[skill]/(1+counts[skill]) * (0.75 if skill in last_skills else 1)),
                SKILLS.index(skill),
            ))[:blocks]
            for index, skill in enumerate(skills):
                stage = phase
                if phase == "foundation" and accuracy[skill] >= 0.8:
                    stage = "accuracy"
                elif phase == "accuracy" and accuracy[skill] < 0.5 and completed[skill] < 2:
                    stage = "foundation"
                ordered = topics[skill]
                focus = [ordered[0],*ordered[:2]] if stage in ("foundation","accuracy") else ordered
                topic = focus[counts[skill] % len(focus)]
                minutes = budget-standard_block*(blocks-1) if index == 0 else standard_block
                tasks.append({"skill":skill,"topic":topic,"phase":stage,
                              "minutes":minutes,"href":PRACTICE_LINKS[skill]})
                counts[skill] += 1
            last_skills = set(skills)
        plan.append({"date":key,"phase":phase,"tasks":tasks})
    return plan


async def verified_practice(con, uid, start: date, zone: ZoneInfo, now: datetime, assessed_at: datetime) -> dict[str,set[str]]:
    from .study_plan_evidence import EVENTS

    end = datetime.combine(start+timedelta(days=MONTH_DAYS),time.min,zone)
    through = min(now,end-timedelta(microseconds=1))
    rows = await con.fetch(f"""SELECT DISTINCT (happened_at AT TIME ZONE $3)::date AS day,
          CASE WHEN source_key LIKE 'reading-practice:%' THEN 'reading' ELSE split_part(source_key,':',1) END AS skill
        FROM ({EVENTS}) e WHERE happened_at <= $4""",uid,assessed_at,zone.key,through)
    result = {}
    for row in rows:
        if row["skill"] in SKILLS:
            result.setdefault(row["day"].isoformat(),set()).add(row["skill"])
    return result


def view_schedule(schedule: list[dict], practiced: dict[str,set[str]], today: date) -> list[dict]:
    today_key = today.isoformat()
    return [{**day,"tasks":[{**task,"status":"practiced" if task["skill"] in practiced.get(day["date"],set())
                             else "missed" if day["date"] < today_key else "planned"}
                            for task in day["tasks"]]} for day in schedule]
