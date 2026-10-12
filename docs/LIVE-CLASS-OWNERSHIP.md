# §7 Live-class ownership matrix

`live_classes` carries `teacher_user_id` and the create route stamps it with the acting teacher,
so a class has an owner. The update route gated on `isStaff` (teacher | admin | owner) and then
wrote `where id = :id`, and `listAllForTeacher()` had no `where` at all — so any teacher could
read and rewrite any other teacher's class, including the `meeting_url` learners are handed.

The repository's own role model settles which behaviour is intended: `isStaff` is "anyone who may
author or review content in the centre", while `isAdministrator` is "may run centre-wide
administration". Centre-wide reach over other teachers' classes is an administrator capability.

**13 / 13 rows PASS · 0 FAIL.**

| actor | action | HTTP | expected | actual | expected DB effect | actual DB effect | result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TEACHER_A | POST /api/teacher/live-classes (create a class) | 200 | allowed | allowed | row owned by A | row owned by A | PASS |
| TEACHER_A | PATCH own class status=live | 200 | allowed | allowed | status=live | status=live | PASS |
| TEACHER_B | PATCH A's class status=cancelled | 404 | denied | denied | status=live | status=live | PASS |
| TEACHER_B | PATCH A's class meeting_url to an attacker URL | 404 | denied | denied | meeting_url=https://centre.example/room-a | meeting_url=https://centre.example/room-a | PASS |
| TEACHER_B | PATCH A's class recording_url | 404 | denied | denied | recording_url=NULL | recording_url=NULL | PASS |
| ADMIN | PATCH A's class status=upcoming | 200 | allowed | allowed | status=upcoming | status=upcoming | PASS |
| STUDENT | PATCH A's class status=cancelled | 403 | denied | denied | status=upcoming | status=upcoming | PASS |
| TEACHER_A | GET /app/teacher/live-classes (read side) | 200 | allowed | allowed | own class listed | own class listed | PASS |
| TEACHER_B | GET /app/teacher/live-classes (read side) | 200 | denied | denied | A's class not listed | A's class not listed | PASS |
| ADMIN | GET /app/teacher/live-classes (read side) | 200 | allowed | allowed | A's class listed (centre-wide) | A's class listed | PASS |
| STUDENT | GET /app/teacher/live-classes (read side) | 200 | denied | denied | redirected, no meeting URL | redirected, no meeting URL | PASS |
| TEACHER_A | attendee counts rendered vs PostgreSQL (grouped COUNT equivalence) | 200 | allowed | allowed | rendered counts equal the grouped DB counts | equal on 3 cards, 2 non-zero | PASS |
| TEACHER_A | MEASURED query count for the live-classes page (pg_stat_statements) | 200 | bounded | measured | attendance counted in one grouped query | live_class_attendance statements=1, calls=1 | PASS |

## Notes

- **TEACHER_A — POST /api/teacher/live-classes (create a class)**: id=27d3569f; meeting_url=https://centre.example/room-a; status=upcoming. This is the fixture every later row attacks.
- **TEACHER_A — PATCH own class status=live**: Positive control: if this row fails, the endpoint refuses everyone and the negative controls below prove nothing.
- **TEACHER_B — PATCH A's class status=cancelled**: response body="{"error":"not_found"}". A teacher cancelling another teacher's class is a centre-wide action.
- **TEACHER_B — PATCH A's class meeting_url to an attacker URL**: The severe case: learners are handed this URL to join, so overwriting it redirects a whole class to an attacker's meeting. body="{"error":"not_found"}"
- **TEACHER_B — PATCH A's class recording_url**: body="{"error":"not_found"}"
- **ADMIN — PATCH A's class status=upcoming**: Positive control against over-restriction: roles.ts documents isAdministrator as 'may run centre-wide administration', so the fix must not lock admins out of another teacher's class.
- **STUDENT — PATCH A's class status=cancelled**: Already enforced by the isStaff gate; recorded so the matrix shows the whole actor set.
- **TEACHER_A — GET /app/teacher/live-classes (read side)**: marker present=true; meeting URL rendered=false
- **TEACHER_B — GET /app/teacher/live-classes (read side)**: This is the read half of the same defect: listAllForTeacher() had no where clause despite its name. Unlike a learner's dashboard, this page is the management timetable, so another teacher's class must not appear at all. A's meeting URL rendered for B=false; cards=0
- **ADMIN — GET /app/teacher/live-classes (read side)**: Positive control: an administrator runs centre-wide administration and must still see every class.
- **STUDENT — GET /app/teacher/live-classes (read side)**: final path=/app; the class TITLE is present=true, which is correct — the learner dashboard lists upcoming IELTS classes by title and start time; meeting URL present=false; attacker URL present=false; status controls offered=0
- **TEACHER_A — attendee counts rendered vs PostgreSQL (grouped COUNT equivalence)**: A 2/1/0 attendance spread was built across A's own classes so the equivalence is measured on non-zero data: rendered=[0,2,1], database=[1,2]. Requiring at least two non-zero cards is what stops this row from passing vacuously on an empty table.
- **TEACHER_A — MEASURED query count for the live-classes page (pg_stat_statements)**: The page loops over every class and runs findMany() on live_class_attendance purely to take .length, so attendance calls scale with the number of classes: 1 calls for the classes on the page. Total statement calls during the load=9.

