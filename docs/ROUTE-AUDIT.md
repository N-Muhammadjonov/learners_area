# Route audit

Every destination the application can serve, what guards it, and what evidence
says a real browser can reach it.

The owner's report included "broken/error routes" and "empty-looking pages", and
the honest way to answer that is to enumerate the routes and then walk them in a
real browser rather than read the code and assume. Both were done:

1. a static inventory of every `page.tsx` and `route.ts` (guards as written);
2. `/tmp/bt/matrix.mjs` — five accounts (OWNER, ADMIN, TEACHER, an ACTIVE
   student, a PENDING student) walking every visible navigation destination, at
   1512px, 820px, 390px and 320px, in Day and Night, in UZ and EN, with a hard
   reload and a client-side navigation — **157/157 checks, 0 failures**.

## What the walk found (and what was fixed)

Two destinations were *visible in the sidebar* and returned 404:

| Destination | Who saw it | Status before | Fix |
| --- | --- | --- | --- |
| `/support` | every role (BOTTOM group) | 404 | page written: the report form plus the other ways to get help |
| `/admin/content` | OWNER and ADMIN | 404 | page written: the content library with real per-kind counts |

That is the whole class of defect the owner described as "broken routes": the
navigation promised a page that did not exist. Both are now real pages with real
data, and the matrix re-run is green.

A third defect of the same family was found by measuring, not by clicking: at
390px the desktop rail stayed in the flex row and squeezed the whole application
into a 126px column. Every page still "worked" (HTTP 200, no horizontal
overflow), so only a width measurement caught it. Fixed by hiding the rail below
768px and giving it back from 768px up, with the drawer at exactly the same
breakpoint. The matrix now asserts, per role and per route, that the main column
is at least 360px wide at 390px and that the rail is hidden.

## Authorization is a database read, not a menu decision

The guard column below is a static observation: "this file calls this guard".
It is **not** evidence of authorization. The evidence is:

- `scripts/verify-access.mjs` and `scripts/verify-publication.mjs` drive the real
  HTTP API as each role and assert what is refused;
- `scripts/verify-a11y.mjs` re-checks the inaccessible-by-menu claims in the
  rendered HTML;
- `/tmp/bt/matrix.mjs` proves that hiding a row is not the only protection: the
  management surfaces answer `/dashboard` to a student and `/login` to an
  anonymous caller, and the write endpoint answers 403 to a student
  (`/tmp/bt/materials.mjs`).

Static guards per route file, as written in the source:

## Pages (64)

| Route | Guard in the file |
| --- | --- |
| `/login` | public |
| `/management` | public |
| `/onboarding` | public |
| `/page.tsx` | public |
| `/pending` | public |
| `/register` | public |
| `/reset-password` | public |
| `/reset-password/confirm` | public |
| `/assignments` | ACTIVE USER |
| `/coach` | ACTIVE USER |
| `/courses/ielts` | ACTIVE USER |
| `/courses/ielts/lessons/[lessonId]` | ACTIVE USER |
| `/dashboard` | ACTIVE USER |
| `/grammar` | ACTIVE USER |
| `/grammar/[topicId]` | ACTIVE USER |
| `/listening` | ACTIVE USER |
| `/listening/attempts/[id]` | ACTIVE USER |
| `/listening/attempts/[id]/revision` | ACTIVE USER |
| `/listening/history` | ACTIVE USER |
| `/live-classes` | ACTIVE USER |
| `/mocks` | ACTIVE USER |
| `/notifications` | ACTIVE USER |
| `/progress` | ACTIVE USER |
| `/reading` | ACTIVE USER |
| `/reading/attempts/[id]` | ACTIVE USER |
| `/reading/history` | ACTIVE USER |
| `/reading/retention` | ACTIVE USER |
| `/speaking` | ACTIVE USER |
| `/speaking/history` | ACTIVE USER |
| `/speaking/practice` | ACTIVE USER |
| `/speaking/shadowing` | ACTIVE USER |
| `/support` | ACTIVE USER |
| `/video-lessons` | ACTIVE USER |
| `/vocabulary` | ACTIVE USER |
| `/vocabulary/review` | ACTIVE USER |
| `/writing` | ACTIVE USER |
| `/writing/history` | ACTIVE USER |
| `/writing/submissions/[id]` | ACTIVE USER |
| `/teacher/live-classes` | STAFF |
| `/teacher/live-classes/[id]` | STAFF |
| `/teacher/speaking` | STAFF |
| `/teacher/students` | STAFF |
| `/teacher/students/[id]` | STAFF |
| `/teacher/support` | STAFF |
| `/admin/admissions` | ADMIN+ |
| `/admin/content` | ADMIN+ |
| `/admin/grammar` | ADMIN+ |
| `/admin/grammar/[id]` | ADMIN+ |
| `/admin/listening` | ADMIN+ |
| `/admin/listening/[id]` | ADMIN+ |
| `/admin/materials` | ADMIN+ |
| `/admin/materials/[type]` | ADMIN+ |
| `/admin/materials/[type]/[id]` | ADMIN+ |
| `/admin/people` | ADMIN+ |
| `/admin/reading` | ADMIN+ |
| `/admin/reading/[id]` | ADMIN+ |
| `/admin/users` | ADMIN+ |
| `/admin/video-lessons` | ADMIN+ |
| `/admin/writing-prompts` | ADMIN+ |
| `/owner` | OWNER |
| `/owner/audit` | OWNER |
| `/owner/integrations` | OWNER |
| `/owner/retention` | OWNER |
| `/owner/transfer` | OWNER |
## API routes (76)

| Route | Methods | Guard in the file |
| --- | --- | --- |
| `/api/admin/admission/[id]/decide` | POST | ADMIN+ |
| `/api/admin/content/[type]/[id]/publication` | POST | ADMIN+ |
| `/api/admin/grammar/topics` | POST | ACTIVE USER |
| `/api/admin/grammar/topics/[id]/exercises` | POST | ACTIVE USER |
| `/api/admin/listening/tests` | POST | ACTIVE USER |
| `/api/admin/listening/tests/[id]/questions` | POST | ACTIVE USER |
| `/api/admin/reading/passages` | POST | ACTIVE USER |
| `/api/admin/reading/passages/[id]/questions` | POST | ACTIVE USER |
| `/api/admin/uploads/cleanup` | POST | ACTIVE USER |
| `/api/admin/users/[id]/role` | PATCH | ADMIN+ |
| `/api/admin/users/[id]/status` | POST | ADMIN+ |
| `/api/admin/video-lessons` | GET,POST | STAFF |
| `/api/admin/writing-prompts` | POST | ACTIVE USER |
| `/api/admission/request` | POST | public |
| `/api/assignments` | GET,POST | ACTIVE USER |
| `/api/assignments/[id]/evaluate` | POST | ACTIVE USER |
| `/api/auth/login` | POST | public |
| `/api/auth/logout` | POST | public |
| `/api/auth/register` | POST | public |
| `/api/auth/reset/confirm` | POST | public |
| `/api/auth/reset/request` | POST | public |
| `/api/auth/telegram/callback` | GET | public |
| `/api/grammar/exercises/[id]/practice` | POST | ACTIVE USER |
| `/api/grammar/exercises/[id]/produce` | POST | ACTIVE USER |
| `/api/grammar/topics/[id]/submit` | POST | ACTIVE USER |
| `/api/lessons/[id]/notes` | POST | ACTIVE USER |
| `/api/lessons/[id]/state` | POST | ACTIVE USER |
| `/api/listening/attempts` | POST | ACTIVE USER |
| `/api/listening/attempts/[id]/submit` | POST | ACTIVE USER |
| `/api/listening/mcq` | POST | ACTIVE USER |
| `/api/listening/mcq/[id]` | GET,PATCH | ACTIVE USER |
| `/api/live-classes/[id]/join` | POST | ACTIVE USER |
| `/api/locale` | POST | public |
| `/api/materials/[type]/[id]` | GET,PUT | ACTIVE USER |
| `/api/notifications` | GET,POST | USER |
| `/api/onboarding` | POST | ACTIVE USER |
| `/api/owner/retention` | POST | OWNER |
| `/api/owner/transfer` | POST | OWNER |
| `/api/reading/attempts` | POST | ACTIVE USER |
| `/api/reading/attempts/[id]` | PATCH | ACTIVE USER |
| `/api/reading/attempts/[id]/submit` | POST | ACTIVE USER |
| `/api/resources/[...key]` | GET | ACTIVE USER |
| `/api/search` | GET | ACTIVE USER |
| `/api/speaking/attempts` | POST,GET | ACTIVE USER |
| `/api/speaking/attempts/[id]` | GET,DELETE,PATCH | ACTIVE USER |
| `/api/speaking/attempts/[id]/submit` | POST | ACTIVE USER |
| `/api/speaking/attempts/[id]/transcript` | POST | ACTIVE USER |
| `/api/speaking/materials` | POST | ACTIVE USER |
| `/api/speaking/materials/[id]` | PATCH,DELETE | ACTIVE USER |
| `/api/speaking/prompts` | GET | ACTIVE USER |
| `/api/support/reports` | POST,GET | ACTIVE USER |
| `/api/support/reports/[id]` | PATCH | ACTIVE USER |
| `/api/teacher/feedback` | POST | ACTIVE USER |
| `/api/teacher/live-classes` | POST | ACTIVE USER |
| `/api/teacher/live-classes/[id]` | PATCH | ACTIVE USER |
| `/api/theme` | POST | public |
| `/api/uploads` | POST | ACTIVE USER |
| `/api/uploads/[id]` | DELETE | ACTIVE USER |
| `/api/uploads/finalize` | POST | ACTIVE USER |
| `/api/uploads/intent` | POST | ACTIVE USER |
| `/api/video-lessons/[id]/answers` | POST | ACTIVE USER |
| `/api/video-lessons/[id]/progress` | POST,GET | ACTIVE USER |
| `/api/video-lessons/[id]/response` | POST | ACTIVE USER |
| `/api/vocabulary` | GET,POST | ACTIVE USER |
| `/api/vocabulary/[id]/review` | POST | ACTIVE USER |
| `/api/vocabulary/[id]/use` | POST | ACTIVE USER |
| `/api/vocabulary/folders` | GET,POST | ACTIVE USER |
| `/api/vocabulary/games` | GET,POST | ACTIVE USER |
| `/api/vocabulary/leaderboard` | GET | ACTIVE USER |
| `/api/vocabulary/packs` | GET,POST | ACTIVE USER |
| `/api/vocabulary/search` | GET | ACTIVE USER |
| `/api/vocabulary/sentences` | GET | ACTIVE USER |
| `/api/writing/submissions` | POST | ACTIVE USER |
| `/api/writing/submissions/[id]` | PATCH | ACTIVE USER |
| `/api/writing/submissions/[id]/submit` | POST | ACTIVE USER |
| `/api/writing/typing` | GET,POST | ACTIVE USER |
## Routes that intentionally do not exist

| Path | Answer | Why |
| --- | --- | --- |
| `/admin/materials/<unknown-kind>` | 404 | an unknown kind cannot mean anything |
| `/admin/materials/<kind>/<not-a-uuid>` | 404 | a malformed id never reaches the database |
| `/admin/materials/<kind>/<unknown-uuid>` | 404 | an id that resolves to no row is not-found, not an orphan page |
| `/reading/attempts/<not-a-uuid>` | 404 | same rule for every user-supplied id |
| `/courses/ielts` (course row) | redirect | there is one course and the roadmap page is the honest destination |

## How to re-run the audit

```bash
# static inventory (route → guard)
node /tmp/inventory.mjs

# real browser walk over every visible destination, five accounts
cd /tmp/bt && node matrix.mjs

# access control over real HTTP
node --env-file=.env scripts/verify-access.mjs
node --env-file=.env scripts/verify-publication.mjs
```

## Not verified in this sandbox

- Production routing (Vercel) is **EXTERNALLY UNVERIFIED**: the sandbox cannot
  reach the deployment. The public pages were checked with a fetching client
  (see the checkpoint notes) and the deployment follows this branch.
- Third-party destinations (Telegram, YouTube, R2 signed URLs) are only checked
  as "the link is rendered with the right target", never by following them.
