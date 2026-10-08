# Reading V4 — implementation checkpoints (not frozen)

Baseline: `2b5f07e0c11375fa8235feafa09e0ce333b58a43`; branch `arena/1052c0fd-learners-area`.
Migration journal remains at 53 entries. No migration has been introduced.

## Lessons: 935bf8c

Reading index/detail/staff adapters use the generic lesson library with explicit
`learning_area=reading`, existing versioned lesson bodies, teacher notes, and private
(user, stable lesson) notes. No second lesson store or student admin entry.

Focused lesson / private-note / Listening reuse regressions: 25 total, 25 pass,
0 fail, 0 skip. Typecheck and lint pass. Local and remote SHA equality verified.
Vercel commit status: success, Deployment has completed (checked separately).

## Doorway and bounded discovery

- Five product destinations, History secondary. No catalogue queries on the root.
- Legacy General Training was a distinct empty tab: its old URL returns to the
  doorway, not to unrelated learning/history. Existing practice aliases preserve
  their actual prior interpretation. Filter-only bookmarks remain General library
  bookmarks, including `type`; they are not silently reassigned to Question Types.
- General retains the existing URL-backed, DB-filtered 24-card learning library,
  concurrent/independent facet and library regions, and canonical passage links.
  Set pagination uses `setsPage`; the prior `page` still means library page.
- Academic catalogue applies three authored live slots and nonempty question
  membership before pagination. Start page remains explicit. This is discovery
  validation, not proof of immutable attempt content or start-API safety.
- Question Types derives canonical identities/alias compatibility from the shared
  registry, intersects published material, uses distinct facets and EXISTS passage
  membership, and bounds pages to 24 plus a sentinel. General practice explicitly
  says the whole passage opens rather than claiming type-only focus.

Focused doorway + actual PGlite catalogue/type-index SQL: 6 total, 6 pass,
0 fail, 0 skip. Typecheck/lint pass. These are NOT built-server HTTP or browser tests.

## Open release blockers / remaining verification

Academic immutable V1/V2 read/grade/history and deletion safety are unresolved.
Active-exam highlight, post-submit eligible Dictionary, General Check explanation,
registry-complete rendering/import, and Retention direct-entry audit remain open.
No Reading production freeze, fresh full gate, QA2 HTTP campaign, or Reading Vercel
release claim has been made. Prior Listening/TED full-gate results are not Reading
V4 evidence. Pointer/highlight and 390/768/1440 rendering: externally unverified.

## General Check: df23a15

Server returns authored explanation and evidence only on explicit Check; UI renders
both as plain support text and labels missing source rather than inventing it.
Check/save also gates the individual passage's publication, not only its parent set.
PGlite behavioral test: 1/1 pass, no fail/skip. General DOM suite: 5/5 pass,
no fail/skip. Typecheck/lint/diff check pass. Remote equality verified; Vercel
status success, Deployment has completed (checked separately).

## Shared highlight integration

Academic and General use the existing ClickableText offset renderer. Lexical-off
text can explicitly opt into highlighting without word targets, popup, lookup,
or occurrence props. Native-selection offsets and removal keep text unchanged;
keyboard selection can expose the highlight control. General retains Dictionary
and occurrence-based lookup. Reading highlight state is mounted owner/attempt
memory only: passage tabs retain it, leaving/reload clears it; no storage/schema
or cross-device persistence is claimed.

Reading/General/shared highlight DOM suite: 15 total, 15 pass, 0 fail, 0 skip.
Listening controls/section highlights/notes/results and TED closure/UX/voice DOM
regressions: 95 total, 95 pass, 0 fail, 0 skip. Reading V4 focused unit/SQL group:
8 total, 8 pass, 0 fail, 0 skip. Typecheck/lint/diff check pass. Real pointer and
viewport painting remain externally unverified. These suites overlap earlier
checkpoint suites and must not be summed as a full-gate total.

The open-blocker list above is historical at the discovery checkpoint: General
explanation and highlight implementation now exist with this focused evidence.
Academic V1/V2 history remains P0: `persistReading` in `content/authors.ts` deletes
existing passages by sourceRef; attempt foreign keys can block draft creation,
and question answer rows have cascading deletion. No migration has been proposed
or created; the existing version target/snapshot capability needs a safe Reading
materialization design and a real draft/publish/old-attempt proof before closure.
Academic review Dictionary, registry-complete import/rendering, HTTP and fresh
full-gate verification remain open. Nothing here declares the repository frozen.
