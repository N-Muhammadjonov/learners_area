# Unlimited-Capacity Audit — site-wide

**Owner requirement (2026-10-08 clarification).** No section that is supposed to keep accepting
content may carry an artificial maximum. Day 1…30 may continue to 31, 100, 205, 1000. Materials may
be added indefinitely, removed, and replaced by *new* identities. Gaps in ordinals are fine.
**Same-ordinal reuse is NOT a requirement.**

**Explicitly superseded:** the earlier `CONTENT_BLOCKED_OWNER` on §08 archive+replace. Reusing an
archived ordinal is not a product requirement, so **no migration 0053 was created**, and the
inability to reuse an archived ordinal is **no longer a blocker**.

## Classification used

| class | meaning | verdict |
|---|---|---|
| **A — performance bound** | bounded read WITH a continuation path (offset/cursor/`hasMore`, or a disclosed + searchable cap) | allowed |
| **B — real product limit** | required by the product contract, e.g. exactly 5 MCQs *inside* one published Day | allowed |
| **C — artificial global content cap** | silently makes later real content unreachable | **not allowed** |

Per-item field validation (`MAX_CHARS`, `MAX_TEXT`, body length, upload byte size) is **not** a
corpus cap and is out of scope. "One Day has exactly 5 questions" is **required** (B); "the
programme may contain only 30 Days" is **forbidden** (C).

---

## Findings

### C — found and FIXED this cycle

| location | defect | fix |
|---|---|---|
| `src/lib/data/listening.ts` `legacyListeningCards` | ended in a bare `.limit(200)` with **no offset** and **ignored the page number**. On `/app/admin/listening` legacy test **#201+ was permanently unreachable**, and the same 200 rows re-rendered on every page while the sibling `fullListeningCards` paged correctly. | `legacyListeningCardsPage()` with `LEGACY_LISTENING_PAGE_SIZE = 100`, a +1 lookahead for `hasMore`, a stable `(createdAt, id)` order and a 10 000-page clamp; admin nav now advances on `tests.hasMore \|\| legacy.hasMore`. Regression **CAP-01**, red-verified against the old `.limit(200)`. |

### C — previously fixed, re-verified on this HEAD

- `MCQ_PROGRAM_DAY_TARGET = 30` — **absent** (removed).
- MCQ catalogue `.limit(200)` ceiling — replaced by `MCQ_DAY_PAGE_SIZE = 24` + `MCQ_DAY_MAX_PAGE = 10_000`.
- Learner-facing "30 day / 150 question" programme claims — removed. (The surviving
  `Last 30 days` / `Oxirgi 30 kun` strings are a **retention time window**, not a content cap.)

### A — bounded, with a real continuation path (allowed)

| module | mechanism |
|---|---|
| Reading — General & Academic catalogues | `.limit(25)` = 24 + 1 lookahead, `.offset((page-1)*24)`, page clamp 10 000 → ~240 000 sets reachable |
| Listening — full/package catalogue | `.limit(101).offset((page-1)*100)`, `hasMore: rows.length > 100` |
| Listening — MCQ day catalogue | `MCQ_DAY_PAGE_SIZE = 24`, `MCQ_DAY_MAX_PAGE = 10_000` |
| Lessons — learner library | `LESSON_LIBRARY_PAGE_MAX = 60` + `offset` + `hasMore` |
| Content bank (CMS) | `DEFAULT_LIMIT 25` / `MAX_LIMIT 100` + `offset` |
| Retention bank | `RETENTION_MAX_PAGE_SIZE = 100` + page/offset |
| People / admissions | `MAX_PEOPLE_PAGE = 100_000` |
| Attempt timeline | `TIMELINE_DEFAULT_LIMIT 50` / `TIMELINE_MAX_LIMIT 200`, caller-paged |
| Reporter roster, Reports student list | `LIST_CAP = 1000` **but disclosed in the UI** (`listCapped`, `data-reporter-list-capped`) **and** narrowed by a server-side search filter |
| Uploads janitor `cleanupAbandonedUploads` | `.limit(500)` per run — batch drain, repeated runs clear the rest |
| Owner student export | `.limit(2001)` / `.limit(10001)` — deliberate N+1 overflow sentinels for export safety |

### B — real product limits (must stay)

- `MCQ_DAY_QUESTION_COUNT = 5` — exactly five real, ordered memberships inside a published MCQ Day.
- Academic reading set = 3 passages / 40 questions.
- Field-level validators (`EXAM_MAX_CHARS`, `LESSON_NOTE_MAX`, `RETENTION_BODY_MAX_CHARS`, …).

### C-minor / borderline — **OPEN, NOT FIXED, NOT counted as pass**

These do not lose learner content today and all have large headroom, but each is a bounded read
without a true continuation path. Each needs a UX decision (paginate vs. typeahead vs. disclose),
so none was changed speculatively.

| location | cap | why it is borderline | recommended fix |
|---|---|---|---|
| `src/lib/content/lesson-staff.ts:131` | `.limit(500)` units | staff lesson-placement picker; unit #501 cannot be chosen, **silently** | server-filtered typeahead, or disclose + search like the roster |
| `src/lib/services/writing/stealing.ts:42` | `.limit(300)` patterns | four filter dimensions (task/function/topic/band) + full distinct topic & band lists give a real narrowing path, so content is reachable *in practice*; a single over-300 filtered combination would still truncate | add `hasMore` + a "refine your filter" notice |
| `src/lib/data/speaking-practice.ts:30` | `.limit(1500)` prompts | live-partner question pool loaded whole, no paging | paginate or disclose |
| `src/lib/data/full-listening.ts:264` | `.limit(200)` practice runs | **latent correctness**, not a content cap: `listeningPracticeProgress` reads a user's 200 most recent runs for one test, so a `completed` flag older than 200 runs on the same test could be missed | aggregate per `_practice` kind in SQL |

---

## Delete / archive / history rule — current behaviour

Verified and preserved:

- **P0 (`47d0031`) stands:** re-import must not cascade-delete `listening_mcq_sessions` or the
  historical question rows they reference. Regression GOLDEN-05b.
- **P1 (`7ba1827`) stands:** a *published* Day cannot be degraded below five questions by re-import;
  the importer refuses rather than silently auto-withdrawing. Regression I8.
- Archive is a reversible `publication_state` change; archived content leaves the new learner
  catalogue **without renumbering** survivors; learner history survives withdrawal.
- `listeningQuestionsForLiveTest` retains superseded rows so old attempts stay interpretable.
- A new item after removal/archive takes a **new identity**; no ordinal or UUID reuse is required.

**Known schema consequence (no longer a blocker):** migration 0052's unique index ignores
`publication_state`, so an *archived* ordinal cannot be re-used by a new item. Under the owner's
clarification this is **acceptable** — gaps are fine and new content should take a new ordinal.
No migration 0053 was added.
