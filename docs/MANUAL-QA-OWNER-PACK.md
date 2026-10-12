# MANUAL QA — OWNER PACK

**Purpose.** Let you open the candidate and start testing immediately, without another engineering
investigation just to locate the application. This pack is deliberately short enough to use *during* a
review, not to read beforehand.

Everything here was verified against one frozen revision. If the candidate SHA changes, the automated
evidence below has to be re-run before it means anything again.

---

## A. PREVIEW ACCESS

| | |
| --- | --- |
| **Candidate SHA** | `ac2495e53d7f88e6dca13d01020e48397ebcd167` |
| **Tree SHA** | see §12 of the delivery report |
| **Branch** | `arena/1052c0fd-learners-area` (never merged to `main`) |
| **Build ID** | `z8C0ar-sN9o7xRdWT09HU` — 126/126 static pages, compiled clean |
| **Vercel deployment** | https://vercel.com/learners-area/learners-area/44kFN28cM7fyZVhDvFAWUi2A8duC |
| **Migrations** | 53 files, 53 recorded — parity, **0 added** by this work |

**Credentials are deliberately NOT written in this file**, because this file is in Git. The demo
identities are the ones the repository's own QA harness uses and are listed there:
`scripts/verify-security-matrix.mjs` (constant `ACCOUNTS`). Roles available for review:

| Role | Identity | What to use it for |
| --- | --- | --- |
| Student (with history) | `demo.student@learnersarea.uz` | Most learner journeys — has attempts, vocabulary, progress |
| Student (empty states) | `new.student@learnersarea.uz` | Empty-state and first-run copy |
| Student (pending) | `pending.student@learnersarea.uz` | Must be **denied** access to learner areas |
| Teacher | `teacher@learnersarea.uz` | Assignments, roster, feedback |
| Teacher (second) | `teacher2@learnersarea.uz` | Teacher-vs-teacher authorization boundaries |
| Admin | `admin@learnersarea.uz` | Content publication, people, imports |
| Owner | `owner@learnersarea.uz` | Owner-only surfaces, role protection |

> **Before you start:** confirm which database the Preview is pointed at. If the Preview uses a database
> that does not contain these accounts, log in will fail and that is an **environment** limitation, not a
> product defect — tell me and I will arrange safe fixtures. Do not point any destructive test at
> Production Supabase.

**Authentication works:** verified on the built candidate — login returns HTTP 200 with a `la_session`
cookie, anonymous callers are refused 401 on protected APIs, and a forged cookie is refused.

---

## B. RECOMMENDED TESTING ORDER

Testing in this order means a failure early explains failures later, so you do not waste time.

1. **Shell and navigation** (5 min) — log in, confirm the sidebar, breadcrumbs, language switch, theme
   switch. Everything else lives inside this shell.
2. **Learner modules** (30 min) — Speaking, Reading, Listening, Writing, Vocabulary, Grammar, Lessons.
3. **Work and feedback** (15 min) — Assignments as teacher, then as learner; Coach; Progress.
4. **Live Classes** (5 min) — join a class that is open.
5. **Cross-cutting** (15 min) — EN/UZ, Day/Night, 390 px mobile, keyboard-only.
6. **Staff and owner surfaces last** (15 min) — admin publication, roster, people, imports.

---

## C. MANUAL INTERACTIONS

Format for each: **URL → what to click → what should appear → what must persist → what must NOT happen →
how to recognize a defect.**

### C1. Speaking Practice — `/app/speaking/practice`

- **Click** a Part (Part 1 / Part 2 / Part 3). **Should appear:** a topic list with a count per topic and
  a status line describing the step.
- **Click** a topic. **Should appear:** that topic's questions, each with its own recorder, preparation and
  answer timers.
- **Refresh the page.** **Must persist:** the same Part and topic, and the same question list. The URL
  carries `?part=` and `?topic=`; a shared link must land on the same step.
- **Press Back.** Must return to the topic list without a full reload losing your place.
- **Type in the search box.** The list must narrow as you type; a search with no match must say so
  explicitly rather than showing an empty panel with no explanation.
- **Scroll a long topic / click "Load more".** More questions must appear, appended, with **no duplicates
  and no gaps**.
- **Open Study Support** on one question. Vocabulary, Model Answers and Ideas appear. Model answers are
  behind a **hold-to-reveal** (press and hold ~3 s) — that is intentional.
- **Select a different question.** The support panel must show the NEW question's content, never the
  previous one's.
- **Must NOT happen:** the whole question bank loading at once; a failed request ejecting you back to the
  Part list; a Retry button that does nothing.
- **Defect recognition:** if a request fails you should see an error message **and a Retry button that
  actually recovers**. If clicking Retry does nothing, or you are silently sent back a step, report it.

### C2. Speaking Practice with AI — `/app/speaking/ai`

- **Click** each mode: Full exam, Part 1, Part 2, Part 3. **Should appear:** an examiner script and the
  first question with a recorder.
- **Start the same mode twice.** The questions should usually **differ** — selection is randomized
  server-side and must be able to reach questions throughout the whole bank, not only the first page.
- **Advance** through the questions. **Must NOT happen:** a new script being fetched for every question,
  or an in-progress recording being reset by a network response.
- **End session.** Must return to the mode grid locally.
- **Defect recognition:** if a mode button appears to do nothing after a failure, or the same question set
  repeats every single time, report it.

### C3. Reading — `/app/reading`

- Open a passage → start → answer questions → submit → view the result and review.
- **Must persist after refresh:** your answers while in progress; the result after submission.
- **Exam privacy:** opening another learner's attempt URL directly must **not** show their content. The
  page renders a not-found view. See **E3** for the known HTTP-status caveat.

### C4. Listening — `/app/listening`

- Four destinations are offered. Practice modes (MCQ, study, revision) behave per mode.
- Audio must play; answers must submit once; a second submit must be refused rather than double-counted.
- **Known limitation:** authored Listening packages are an owner asset — see **E1**.

### C5. Writing — `/app/writing`

- Select a task → draft → submit → view evaluation and history.
- A draft must survive refresh. Submitting twice must not create two submissions.
- Opening another learner's submission URL must not show their text (see **E3** for the status caveat).

### C6. Vocabulary — `/app/vocabulary`

- Dictionary lookup, saving a word, SRS review, games, progress.
- **Must persist:** saved words and review state after refresh.
- Saving a word from Speaking Study Support must land in your library.

### C7. Grammar — `/app/grammar`

- Topic list → topic → practice → produce (written answer).
- **Produce** calls the evaluator. If evaluation fails you should get a clear failure and be able to
  retry; a failed evaluation must **not** leave a recorded wrong answer behind. This was fixed in this
  candidate — worth a deliberate check.

### C8. Lessons / Courses — `/app/courses/ielts`, `/app/lessons`

- Course → lesson → navigation → completion → notes. Notes are private to you.

### C9. Assignments — teacher then learner

- **As teacher** `/app/assignments`: create an assignment for **one** learner, choosing published content.
- **As that learner**: the assignment appears; open it; complete it; the status changes.
- **As a different learner**: it must NOT appear.
- **Back as teacher**: progress and feedback must reflect the learner who actually did the work.
- **Contract note:** public assignment creation is **single-target by design** — one assignment, one
  learner. See **E4**.

### C10. Live Classes — `/app/live-classes`

- Open a class that is inside its join window and join.
- **Rapidly click join twice**, or join from two tabs at once: you must be recorded **once**, not twice.
  This was a real concurrency defect fixed in this candidate — a deliberate double-join is a good check.
- A cancelled or closed class must refuse the join and say why.

### C11. Progress, Notifications, Profile, Coach

- **Progress** must agree with results you actually produced (do a Reading test, then check Progress).
- **Notifications**: unread state, deduplication (the same event must not appear twice).
- **Profile**: change language and theme; both must persist after refresh.
- **Coach**: weakness profile must reflect evaluated work.

### C12. Staff and owner surfaces

- **As admin** `/app/admin/*`: content publication, materials, people, roster, imports.
- **As teacher**: admin surfaces must be refused.
- **As owner**: an admin must NOT be able to demote the owner; a student must NOT be able to promote
  themselves. Both are verified automatically, but they are worth a manual look.

---

## D. RESPONSIVE, LANGUAGE AND THEME REVIEW

Check these on the surfaces you care about most — Speaking Practice, Assignments, Progress and one admin
page are the highest-value four.

| Axis | What to check |
| --- | --- |
| **320 px** | No horizontal scrolling; nothing cut off; tap targets usable |
| **390 px** | Mobile navigation reachable; Speaking recorder controls not clipped |
| **768 px** | Tablet layout does not fall between mobile and desktop awkwardly |
| **1024 px** | Sidebar and content both usable |
| **1440 px** | No over-stretched lines of text |
| **EN** | All copy English |
| **UZ** | All copy **Uzbek Latin** — report any English left behind, and any Cyrillic |
| **Day** | Skeletons and recessed panels **visible** (this candidate fixed 39 invisible surfaces) |
| **Night** | Same, and no white flashes; contrast readable |
| **Keyboard only** | Tab through a whole journey; focus ring always visible; Enter/Space activates |

**Specifically worth checking in this candidate:** loading skeletons. Before this fix, `bg-ink-50` produced
no CSS at all, so ~39 skeleton and recessed-panel elements across the dashboard, assignments, grammar,
live classes, mocks, progress, speaking lessons, video lessons, writing and several vocabulary/reading/
listening panels rendered with **no background**. They now render with the approved sunken-surface colour
in both themes. If you still see an invisible pulse area, that is a defect — report the URL.

---

## E. KNOWN LIMITATIONS (only real ones)

### E1. Owner assets — `OWNER_ASSET_REQUIRED`

| Asset | Effect | Blocks manual QA? |
| --- | --- | --- |
| Canonical **Speaking bank** (`SPEAKING_BANK_SOURCE`) | Practice/AI run against the seeded demo bank only. Scalability is proven with **synthetic** prompts at 100 / 1 000 / 10 000. Populated-bank performance is **not measured and has not been invented**. | No — surfaces work; content volume is yours to supply |
| Authored **Listening packages** | Listening has no authored content to open | Partly — Listening content review blocked |
| Frozen **Dictionary catalogue** (`nested.json.gz`) | Dictionary release paths skipped | Partly — dictionary depth blocked |
| Reading sets | Reading content limited to seeded fixtures | Partly |

These are **not** counted as PASS anywhere. 6 QA2 tests skip for exactly this reason and are reported as
skips.

### E2. External integrations — `EXTERNAL_ENVIRONMENT_BLOCKED`

- **No AI provider is configured here.** Every AI-evaluated path (writing evaluation, grammar production,
  coach evaluation) is verified for authorization, atomicity, failure handling and retry — but **not** for
  the quality of a real model response.
- **No real microphone / WebRTC hardware.** Recording, prep and answer timers, mic ownership and the
  recorder contract are verified structurally and in-browser, but **audio capture, upload and playback of
  real speech are not**. This row is **SKIP, never PASS**.
- **No R2/S3 credentials**; storage runs local.

### E3. HTTP status on protected not-found pages — `OWNER_DECISION_REQUIRED`

Three security-matrix rows (a Reading attempt page and a Writing submission page opened by the wrong
learner) return **HTTP 200 with a not-found body** instead of HTTP 404.

- **Privacy holds.** The other learner's content is verified **absent** from the response — this is *not*
  an IDOR and no data leaks. It is not counted as PASS either.
- **Why it happens:** in the Next.js App Router, the shell and its `loading` boundary stream first, which
  commits HTTP 200 before the page can call `notFound()`. The page already validates the id and resolves
  the row *before* touching any dynamic API, which is as early as the page itself can act.
- **Why it is not silently "fixed":** the only ways to get a true 404 are to remove the shell's shared
  `loading.tsx` (which you have asked to preserve, and which would degrade every loading state on the
  site) or to add an authorization pass in front of every route (expensive duplicate queries). Both are
  consequential architecture changes, so this is your decision, not mine to make unilaterally.

### E4. Multi-target assignments — `OWNER_DECISION_REQUIRED`

Public assignment creation is **single-target**: the API accepts one `targetUserId`, the teacher form sends
one student, and no caller anywhere passes more than one. That contract is now proven by a test.

The internal `createAssignment` helper is array-shaped and would accept several students. Because
`assignments.target_user_id` can only name one, enabling multi-target is a **product decision**. The
authorization and attribution paths have been made consistent so that enabling it later cannot silently
attribute one learner's work to another — but multi-target itself is **not** implemented and **not**
claimed.

### E5. Rate limiting — recorded, not claimed

Rate limiting is per-instance (in-memory). On a multi-instance deployment, limits are therefore **not**
globally authoritative. No distributed guarantee is claimed from it, and no Redis has been added without
demonstrated necessity and your authorization. Whether cross-instance enforcement is required **before
manual QA** (it is not) or **before production cutover** (your call) is recorded as a decision point.

### E6. Visual decisions reserved for you

- **44 fixed-palette uses across 14 files.** Previously reviewed: **no contrast defect was demonstrated**
  at those sites. They are a tooling convention, not a visual defect, and have **not** been rewritten.
- **Report-a-problem control** reachable through the collapsible utilities panel. Its first-paint placement
  is your decision and has **not** been moved.

Neither is reported as a verified technical PASS; both are listed here so they are visible during review.

---

## F. HOW TO REPORT A FAILURE

You should not need to reverse-engineer any test command. For each problem, four lines is enough:

```
URL:        /app/speaking/practice?part=part1&topic=...
WHAT I DID: clicked "Load more" twice
WHAT I SAW: the same 100 questions repeated
WHAT I EXPECTED: the next questions, no duplicates
```

Add, when easy: **device width** (or "desktop"), **EN or UZ**, **Day or Night**, and the **role** you were
signed in as. A screenshot is welcome but never required.

If something looks wrong only in one theme, language or width, say which — several defects in this
codebase have been specific to exactly one of those axes.

---

## G. RESULT

**`MANUAL_QA_READY_WITH_DECLARED_LIMITATIONS`**

- All independently executable critical work known at the time of freezing is complete and verified on
  this candidate: Speaking scalability, Speaking AI fairness and security, Live Class concurrency,
  assignment authorization/attribution, grammar failure recovery, cleanup-harness integrity, and the
  invisible-surface theme defect.
- The Preview is reachable and authentication works on the built candidate.
- What remains is **narrowly scoped** and genuinely not mine to close: owner content assets (E1), external
  integrations and hardware (E2), two owner decisions (E3, E4), one operational decision (E5), and two
  reserved visual decisions (E6).
- **This is not Production GO.** Manual QA readiness and production authorization are different states;
  a successful Vercel deployment establishes neither functional correctness nor cutover approval.

---

## Reproduction commands (for whoever reviews this independently)

```bash
npm ci
bash scripts/qa2-local-postgres.sh          # disposable LOCAL PostgreSQL only
DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 \
  AUTH_SECRET=... node --conditions=react-server --import tsx src/db/seed.ts
npm run build
npx next start -H 0.0.0.0 -p 3000           # with DATABASE_URL / AUTH_SECRET / STORAGE_* set

npx tsc --noEmit
npx eslint --max-warnings=0 .
npm run test:qa2                            # run TWICE, no reseed between
node scripts/qa2-db-integrity.mjs snapshot /tmp/base.json
node scripts/qa2-db-integrity.mjs diff /tmp/base.json /tmp/after.json
node scripts/verify-browser-matrix.mjs http://127.0.0.1:3000
node scripts/verify-speaking-journeys.mjs http://127.0.0.1:3000
node scripts/verify-speaking-ai-security.mjs
node scripts/verify-security-matrix.mjs http://127.0.0.1:3000
```

**Never** point the fault-injection or residue probes at Production Supabase. They are written to refuse a
`DATABASE_URL` that is not local.
