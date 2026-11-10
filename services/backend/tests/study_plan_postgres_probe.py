"""Study-plan HTTP acceptance against an isolated PostgreSQL engine."""
import asyncio
from datetime import datetime, timedelta, timezone
import json
import os
import sys
from uuid import uuid4

from fastapi.testclient import TestClient
from riwi_postgres_probe import Connection
from app import main as core
from app.asgi import application
from app.security import SESSION_COOKIE, issue_token


class BatchConnection(Connection):
    calls = 0

    async def fetch(self, statement, *values):
        self.calls += 1
        try:
            return await super().fetch(statement, *values)
        except Exception as error:
            print(f"{error}: {statement}", file=sys.stderr)
            raise

    async def execute(self, statement, *values):
        self.calls += 1
        try:
            return await super().execute(statement, *values)
        except Exception as error:
            print(f"{error}: {statement}", file=sys.stderr)
            raise

    async def executemany(self, sql, values):
        for params in values:
            await self.execute(sql, *params)


con = BatchConnection()
async def pool():
    return con


core.pool = pool
os.environ["AUTH_SECRET"] = "isolated-study-plan-testing-secret"
uids = {key: str(uuid4()) for key in ("learner", "other", "teacher", "admin")}
now = datetime.now(timezone.utc)
checks = 0


def check(condition, response=None):
    global checks
    assert condition, response.text if response is not None else None
    checks += 1


def sql(query, *args):
    return asyncio.run(con.fetchval(query, *args))


def make_client(role):
    client = TestClient(application)
    kind = "student" if role in ("learner", "other") else role
    uid = uids[role]
    sql("""INSERT INTO users(id,name,email,role,account_status) VALUES($1,$2,$3,$4,'active') RETURNING id""",
        uid,role,role+"@study-plan.invalid",kind)
    token = issue_token({"id":uid,"name":role,"role":kind,"locale":"en"})
    client.cookies.set(SESSION_COOKIE,token)
    return client


learner, other, teacher, admin = map(make_client,uids)
public = TestClient(application)
path = "/api/study-plan"
check(public.get(path).status_code == 401)
check(teacher.get(path).status_code == admin.get(path).status_code == 403)
empty = learner.get(path)
check(empty.status_code == 200 and empty.json()["latest"] == {} and not empty.json()["goals"]["configured"],empty)
prefs = {"target":8,"minutes":120,"weekdays":list(range(7)),"timezone":"Asia/Tashkent",
         "examDate":(now+timedelta(days=60)).date().isoformat(),"focusSkills":["reading"],"skillTargets":{"reading":8.5}}
check(learner.put(path+"/preferences",json={**prefs,"target":8.2}).status_code == 400)
check(learner.put(path+"/preferences",json={**prefs,"userId":uids["other"]}).status_code == 400)

prompt = str(uuid4())
sql("""INSERT INTO writing_prompts(id,task_type,category,prompt,target_word_count,publication_state)
  VALUES($1,'task2','Public writing','What should cities do to improve transport?',250,'published') RETURNING id""",prompt)
assignment = str(uuid4())
sql("""INSERT INTO assignments(id,title,target_user_id,created_by_user_id,due_at)
  VALUES($1,'Private homework',$2,$3,now()+interval '1 day') RETURNING id""",assignment,uids["learner"],uids["teacher"])
sql("INSERT INTO assignment_targets(assignment_id,student_user_id) VALUES($1,$2) RETURNING id",assignment,uids["learner"])

plan = learner.put(path+"/preferences",json=prefs)
check(plan.status_code == 200,plan)
data = plan.json()
check(len(data["days"]) == 7 and data["goals"]["examDate"] == prefs["examDate"] and data["forecast"] is None,plan)
tasks = [task for day in data["days"] for task in day["tasks"]]
check(tasks[0]["reason"] == "assignment" and tasks[0]["title"] == "Private homework",plan)
key = "writing:"+prompt
task = next(t for t in tasks if t["key"] == key)
check(task["href"].endswith(prompt),plan)
check(learner.put(path+"/reschedule",json={"key":"assignment:"+assignment,"date":data["days"][1]["date"]}).status_code == 409)
moved = learner.put(path+"/reschedule",json={"key":key,"date":data["days"][2]["date"]})
check(moved.status_code == 200 and any(t["key"] == key for t in moved.json()["days"][2]["tasks"]),moved)
check(other.get(path).json()["days"] == [])
before = con.calls
today_view = learner.get(path+"?view=today")
warm_queries = con.calls-before
check(today_view.status_code == 200 and len(today_view.json()["days"]) == 1,today_view)
check(warm_queries <= 12)
check("no-store" in today_view.headers["Cache-Control"])
check(other.put(path+"/reschedule",json={"key":key,"date":data["days"][2]["date"]}).status_code == 409)
check(learner.post(path+"/completion",json={"key":key,"points":2000}).status_code == 404)

for _ in range(2):
    sql("""INSERT INTO writing_submissions(user_id,prompt_id,content,word_count,status,submitted_at)
      VALUES($1,$2,'This is practice.',3,'submitted',now()) RETURNING id""",uids["learner"],prompt)
reloaded = learner.get(path)
check(reloaded.status_code == 200,reloaded)
check(any(t["key"] == key and t["status"] == "completed" for d in reloaded.json()["days"] for t in d["tasks"]),reloaded)
balance = learner.get(path+"/rewards")
check(balance.status_code == 200 and balance.json()["balance"] == 5,balance)
check(learner.get(path+"/rewards").json()["balance"] == 5)
second_device = TestClient(application,cookies=learner.cookies)
check(second_device.get(path+"/rewards").json()["balance"] == 5)
check(learner.put(path+"/rewards/blue-frame").status_code == 409)
sql("""INSERT INTO study_reward_ledger(user_id,event_key,points,earned_at)
   VALUES($1,'local-acceptance-fixture',30,now()) RETURNING user_id""",uids["learner"])
first = learner.put(path+"/rewards/blue-frame")
check(first.status_code == 200 and first.json()["balance"] == 15,first)
check(learner.put(path+"/rewards/blue-frame").json()["balance"] == 15)
check(learner.put(path+"/rewards/violet-theme").status_code == 409)
check(other.put(path+"/rewards/blue-frame").status_code == 409)

check(learner.get(path+"/leaderboard").json()["entries"] == [])
opt = learner.put(path+"/leaderboard/participation",json={"enabled":True})
check(opt.status_code == 200 and opt.json()["alias"].startswith("Learner-"),opt)
rank = other.get(path+"/leaderboard")
check(rank.status_code == 200 and set(rank.json()["entries"][0]) == {"alias","points","rank","mine"},rank)
check(learner.put(path+"/leaderboard/participation",json={"enabled":False}).status_code == 200)
check(other.get(path+"/leaderboard").json()["entries"] == [])

check(learner.post(path+"/share",json={"consent":False}).status_code == 400)
share = learner.post(path+"/share",json={"consent":True})
check(share.status_code == 201,share)
token = share.json()["url"].split("#")[1]
snapshot = public.post(path+"/shared",json={"token":token})
check(snapshot.status_code == 200 and len(snapshot.json()["days"]) == 7 and "Private homework" not in snapshot.text,snapshot)
check("no-store" in snapshot.headers["Cache-Control"] and "noindex" in snapshot.headers["X-Robots-Tag"])
check(other.delete(path+"/share/"+share.json()["id"]).status_code == 404)
check(learner.delete(path+"/share/"+share.json()["id"]).status_code == 200)
check(public.post(path+"/shared",json={"token":token}).status_code == 404)

# Grade genuine Reading attempts, resolve a matching exercise, and verify that
# the ordinary Reading endpoint updates the plan without a completion claim.
reading_set = str(uuid4())
sql("INSERT INTO general_reading_sets(id,title) VALUES($1,'Headings practice set') RETURNING id",reading_set)
def add_passage(title):
    pid = str(uuid4())
    sql("""INSERT INTO reading_passages(id,title,body_text,publication_state,suggested_minutes)
      VALUES($1,$2,'An introduction to our new library.','published',20) RETURNING id""",pid,title)
    questions = [str(uuid4()) for _ in range(3)]
    for number,qid in enumerate(questions,1):
        sql("""INSERT INTO reading_questions(id,passage_id,"order",type,type_code,question_text,correct_answer,explanation)
          VALUES($1,$2,$3,'multiple_choice','MH','Choose a heading','i','The passage introduces the library.') RETURNING id""",qid,pid,number)
    return pid,questions

history_passage, historical_questions = add_passage("Previous assessment")
for ago in (12, 6, 3):
    attempt = sql("""INSERT INTO reading_attempts(user_id,passage_id,status,score,total_questions,submitted_at)
      VALUES($1,$2,'completed',0,3,$3) RETURNING id""",uids["learner"],history_passage,now-timedelta(days=ago))
    for qid in historical_questions:
        sql("""INSERT INTO reading_answers(attempt_id,question_id,user_answer,is_correct)
           VALUES($1,$2,'ii',false) RETURNING id""",attempt,qid)
passage,questions = add_passage("Matching Headings practice")
sql("INSERT INTO general_reading_passages(set_id,passage_id,passage_no) VALUES($1,$2,1) RETURNING passage_id",reading_set,passage)
targeted = learner.get(path)
check(targeted.status_code == 200,targeted)
reading_task = next(t for day in targeted.json()["days"] for t in day["tasks"] if t["key"] == "reading-practice:"+passage)
check(reading_task["reason"] == "reading:matching_headings" and reading_task["href"].endswith("?passage=1"),targeted)
result = learner.post("/api/reading/general/progress",json={"passageId":passage,"answers":{qid:"i" for qid in questions},"check":True})
check(result.status_code == 200 and result.json()["score"] == 3,result)
reviewed = learner.get(path)
check(reviewed.status_code == 200 and any(t["key"] == reading_task["key"] and t["status"] == "completed"
  for day in reviewed.json()["days"] for t in day["tasks"]),reviewed)
mh = next(row for row in reviewed.json()["weaknesses"] if row["category"] == "matching_headings")
check(mh["history"][-1]["correct"] == 3 and mh["status"] == "improving",reviewed)
check(learner.get(path+"?view=progress").json()["weaknesses"][0]["category"] == "matching_headings")
lexeme = sql("INSERT INTO lexemes(term,definition_en,sense_key) VALUES('library','A place with books','study-plan-library') RETURNING id")
entry = sql("INSERT INTO user_vocabulary(user_id,lexeme_id,next_review_at) VALUES($1,$2,now()-interval '1 hour') RETURNING id",uids["learner"],lexeme)
due = learner.get(path)
check(due.status_code == 200 and due.json()["vocabulary"]["due"] == 1,due)
check(any(task["skill"] == "vocabulary" for day in due.json()["days"] for task in day["tasks"]),due)
review = learner.post("/api/vocabulary/"+str(entry)+"/review",json={"outcome":"correct"})
check(review.status_code == 200,review)
check(learner.post("/api/vocabulary/"+str(entry)+"/review",json={"outcome":"correct"}).status_code == 409)
srs = learner.get(path)
check(srs.json()["vocabulary"]["recall"] == 100 and srs.json()["vocabulary"]["mastery"]["learning"] == 1,srs)
check(any(task["skill"] == "vocabulary" and task["status"] == "completed"
          for day in srs.json()["days"] for task in day["tasks"]),srs)

# Monthly plan is an opt-in, owned assessment and does not replace the weekly view.
month = path + "/monthly"
check(public.get(month).status_code == 401)
check(teacher.get(month).status_code == 403)
check(other.get(month).json()["state"] == "setup")
check(learner.get(month).json()["state"] == "available")
started = learner.post(month+"/start")
check(started.status_code == 200,started)
form = started.json()["form"]
check(len(form["sections"]) == 4 and all("answer" not in q for section in form["sections"] for q in section["questions"]))
check(learner.post(month+"/start").json()["form"]["id"] == form["id"])
answers = {q["id"]:0 for section in form["sections"] for q in section["questions"]}
sample = ("The library should stay open later so people who work can visit it. "
          "For example, a nurse finishing at six could collect reserved books on the way home. "
          "The library could test two late evenings first and use the results to decide whether to expand the hours.")
body = {"id":form["id"],"version":form["version"],"answers":answers,"sample":sample}
check(learner.post(month+"/assessment",json={**body,"sample":"Short."}).status_code == 400)
check(other.put(path+"/preferences",json=prefs).status_code == 200)
check(other.post(month+"/assessment",json=body).status_code == 404)
active = learner.post(month+"/assessment",json=body)
check(active.status_code == 200,active)
planned = active.json()
check(planned["state"] == "active" and len(planned["days"]) == 30,active)
check(set(planned["diagnosis"]) == {"listening","reading","writing","grammar"})
check(all(sum(task["minutes"] for task in day["tasks"]) <= prefs["minutes"] for day in planned["days"]))
check(learner.post(month+"/assessment",json=body).json() == learner.get(month).json())
check(len(learner.get(path).json()["days"]) == 7)
check(other.get(month).json()["state"] == "available")
check(sql("SELECT diagnosis->'writing'->'sample'->>'words' FROM study_plan_months WHERE user_id=$1",uids["learner"]) is not None)


general_id = sql("""INSERT INTO listening_tests(created_by_user_id,title,audio_type,publication_state)
    VALUES($1,'General diagnostic fixture','audio','published') RETURNING id""",uids["teacher"])
audio_source = {
    "collection":"general","audio":{"durationSec":90},
    "sections":[{"number":1,"transcript":"Fixture private transcript."}],
    "questions":[{"kind":"mcq","number":1,"text":"Fixture question","key":"B","options":["First","Second","Third"]},
                 *[{"kind":"completion","number":n,"text":"Complete the detail","key":"library","alternatives":["the library"]}
                   for n in range(2,6)]],
}
sql("""INSERT INTO listening_packages(test_id,source_id,payload,source_hash,audio_object_key)
    VALUES($1,'monthly-test-source',$2::jsonb,$3,'listening/placement.mp3') RETURNING test_id""",general_id,audio_source,'a'*64)
general = other.post(month+"/start")
check(general.status_code == 200,general)
general_form = general.json()["form"]
listen = general_form["sections"][0]
check(listen["audio"] == "/api/resources/listening/placement.mp3" and listen["canFallback"])
check(len(listen["questions"]) == 5 and "Fixture private transcript." not in general.text)
backup = other.post(month+"/start?fallback=true")
check(backup.status_code == 200,backup)
backup_form = backup.json()["form"]
check(backup_form["id"] != general_form["id"] and not backup_form["sections"][0]["canFallback"])
check(other.post(month+"/assessment",json={**body,"id":general_form["id"]}).status_code == 404)

print(json.dumps({"event":"done","checks":checks,"probeKind":"study_plan","measurements":{"warmDashboardSqlStatements":warm_queries}}),flush=True)
