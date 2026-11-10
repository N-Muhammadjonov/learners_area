from datetime import date, timedelta

from app.study_plan_diagnostic import BANK, FALLBACK_LISTENING, diagnose, public_form
from app.study_plan_month import make_schedule, view_schedule

SAMPLE = ("The library should stay open later so people who work can visit it. "
          "For example, a nurse finishing at six could collect reserved books on the way home. "
          "The library could test two late evenings first and use the results to decide whether to expand the hours.")
GOAL = {"minutes":30,"weekdays":[0,2,4],"focusSkills":[]}
START = date(2026,11,10)


def answer_key():
    return {q["id"]:q["answer"] for rows in (*BANK.values(),FALLBACK_LISTENING["items"]) for q in rows}


def test_diagnostic_keeps_keys_server_side_and_checks_all_four_skills():
    form = public_form("fixture",FALLBACK_LISTENING)
    assert len(form["sections"]) == 4
    assert all("answer" not in q for section in form["sections"] for q in section["questions"])
    answers = answer_key()
    result = diagnose(FALLBACK_LISTENING,answers,SAMPLE)
    assert result["writing"]["correct"] == result["writing"]["total"]
    assert result["writing"]["sample"]["sentences"] == 3
    assert diagnose(FALLBACK_LISTENING,{**answers,"g1":True},SAMPLE) is None
    assert diagnose(FALLBACK_LISTENING,{**answers,"unowned":1},SAMPLE) is None
    assert diagnose(FALLBACK_LISTENING,answers,"Too short.") is None


def test_plan_personalizes_and_keeps_the_daily_budget_and_rest_days():
    answers = answer_key()
    good = diagnose(FALLBACK_LISTENING,answers,SAMPLE)
    weak = diagnose(FALLBACK_LISTENING,{**answers,**{q["id"]:(q["answer"]+1)%3 for q in BANK["grammar"]}},SAMPLE)
    balanced = make_schedule(START,START,GOAL,good,[],{})
    plan = make_schedule(START,START,GOAL,weak,[],{})
    assert plan != balanced
    assert len(plan) == 30 and plan[-1]["date"] == (START+timedelta(days=29)).isoformat()
    tasks = [task for day in plan for task in day["tasks"]]
    assert tasks[0]["skill"] == "grammar"
    assert sum(task["skill"] == "grammar" for task in tasks) > sum(
        task["skill"] == "grammar" for day in balanced for task in day["tasks"])
    assert {task["skill"] for task in tasks} == {"listening","reading","writing","grammar"}
    assert all(sum(task["minutes"] for task in day["tasks"]) <= 30 for day in plan)
    assert all(not day["tasks"] for day in plan if date.fromisoformat(day["date"]).weekday() not in GOAL["weekdays"])


def test_next_day_adaptation_preserves_history_and_requires_verified_activity():
    diagnosis = diagnose(FALLBACK_LISTENING,answer_key(),SAMPLE)
    plan = make_schedule(START,START,GOAL,diagnosis,[],{})
    done = plan[1]
    practice = {done["date"]:{done["tasks"][0]["skill"]}}
    today = START+timedelta(days=3)
    adjusted = make_schedule(START,today,{**GOAL,"minutes":60},diagnosis,plan,practice)
    assert adjusted[:3] == plan[:3]
    assert sum(task["minutes"] for task in adjusted[3]["tasks"]) == 60
    payload = view_schedule(adjusted,practice,today)
    assert payload[1]["tasks"][0]["status"] == "practiced"
    assert all(task["status"] == "planned" for task in payload[3]["tasks"])
