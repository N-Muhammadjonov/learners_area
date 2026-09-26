# UI action matrix

Every control on every surface: what it does, what it says, what states it has,
who may use it, and what proves it. Written from the tested build
(`/tmp/bt/matrix.mjs` 157/157, plus the per-surface rigs listed at the end).

Two rules held throughout, because the owner's complaints were almost all
violations of them:

- **no dead controls** — a button either does something visible, or it is
  disabled with a reason, or it does not exist. No `href="#"`, no permanent
  spinner, no control that only looks like a link.
- **pending always terminates** — every async control is wrapped so that the
  pending state ends in success or in a visible, recoverable error (`try/finally`
  and a rendered error state, never a stuck spinner).

Status vocabulary for content a student works through, everywhere:
**Boshlanmagan / Jarayonda / Bajarilgan** (`not started / in progress / completed`).

---

## 1. Shell

| Control | Purpose | States | Who | Evidence |
| --- | --- | --- | --- | --- |
| Sidebar brand block | product identity: approved mark + name and strapline as real text | mark is decorative to screen readers; the name is text | all | `shell.mjs` 36/36, `brand.mjs` 25/25 |
| Sidebar groups | MAIN (Dashboard, Live classes, Assignments) · MODULES (Listening, TED/Video, Reading, Writing, Speaking, Grammar, Vocabulary) · PROGRESS (My progress, Mock tests) · BOTTOM (Support) | active row marked with `aria-current="page"` | all | `matrix.mjs` nav walk |
| Management entry | switch to management mode; label is a sentence, not an icon | shown only for staff, only in learning mode | TEACHER/ADMIN/OWNER | `matrix.mjs` per role |
| Management mode | its own navigation + a visible `← Back to learning` row | derived from the route, never from a click — a bookmark, a refresh or a shared link lands in the correct mode | staff | `matrix.mjs` (management routes walked per role) |
| No IELTS row | there is one course and nothing to switch to; the row promised a switcher that does not exist | — | — | `shell.mjs` asserts the row is absent |
| Back + breadcrumbs | the *meaningful* parent (e.g. Reading → passage → attempt), not browser history | on every private page; the parent is a real link | all | `matrix.mjs` hard reload + client nav checks |
| Global search | find a passage, a word, a listening test, a class | idle · typing (<2 chars: hint) · 300 ms debounce · results grouped by category, only categories with matches · empty · error | all, results filtered by role server-side | `matrix.mjs` search checks; `/api/search` re-checks the role |
| `Cmd/Ctrl + K` | focus the search field | ignores the shortcut while typing in an input | all | `GlobalSearch.tsx`, keyboard branch tested in `matrix.mjs` |
| Day / Night | two separate 44×44 buttons `[☀] [☾]`, the selected one visibly active | persists via a server-written cookie; no wrong-theme flash (the server sets `data-theme` before the first byte) | all | `brand.mjs`, `matrix.mjs` theme persistence |
| Language `UZ / EN` | switch the interface language | applied server-side for the next render; every new string exists in both dictionaries | all | `matrix.mjs` locale switch + revert |
| Profile menu | who you are signed in as; sign out | aria-expanded; sign out ends the session server-side | all | `theme.mjs`/`matrix.mjs` |
| Focus mode (floating, bottom-right) | hide the rail and non-essential chrome, centre the workspace | **practice pages only**; `F` toggles (ignored while typing in a field), `Esc` exits, the drawer never traps the keyboard; timer, save and submit stay available | all (learning surfaces) | `FocusToggle.tsx`, shell checks |
| Report a problem (floating, bottom-right) | send a report from the page the problem happened on | opens the form; sends as the signed-in user | all | `verify-support.mjs`, `verify-theme.mjs` |
| Mobile drawer | the same navigation tree on a narrow screen | opens below 768px; the rail takes over from 768px | all | `matrix.mjs` 390/320 assertions |

## 2. Reading

| Control | Purpose | States | Who | Evidence |
| --- | --- | --- | --- | --- |
| Hub tabs | Essential videos · Academic reading (count from the DB) · General training · Question types · Retention | each tab is a URL (`?tab=…`), so it is shareable and survives reload | student | `reading.mjs` 28/28 |
| Library filters | status (Barchasi / Passage 1 / Passage 2 / Passage 3 / Bajarilgan) + topic + question type | AND semantics, reset control, state lives in the URL | student | `reading.mjs` |
| Library pagination | 24 per page | `← / →` only when a page exists; page number in the copy | student | `reading.mjs` |
| Passage card CTA | start, continue or rework | Boshlash · Davom etish · Qayta ishlash, from the attempt state; a finished attempt shows its raw score | student | `reading.mjs`, `practice.mjs` |
| Practice workspace | passage (58–62%) beside questions (38–42%) | mobile: Passage / Questions tabs; the split is measured by `practice.mjs` | student | `practice.mjs` 27/27 |
| Paragraph letters | A, B, C … shown in the passage where the source has them | an unlabelled paragraph gets a neutral marker, never an invented number | student | `practice.mjs` |
| Group instructions | the real task text ("Choose TWO letters, A–E") above its questions | shared option lists render once per group | student | `practice.mjs` |
| Question input | a blank inside the sentence for text answers; letter chips or a radio list for choices | answered / unanswered; the constraint (one word, a number allowed, choose N letters) is stated | student | `practice.mjs` |
| Autosave | keep the attempt when the tab closes | `Saving…` · `Saved` · `Could not save` + **Retry**; 900 ms debounce; on submit-from-another-tab it says so instead of overwriting | student | `practice.mjs` (reload restores answers) |
| Timer | how long the attempt has been open | local clock, from the server's `startedAt` | student | `practice.mjs` |
| Word lookup | tap any word: meaning, translation, example, collocations, pronunciation | "Save to vocabulary"; a word with no meaning is refused by name, never invented | student | `verify-reading.mjs`, `verify-vocabulary.mjs` |
| Submit | lock the answers and show the analysis | confirm first; pending has a visible state; failure is shown inline with a retry | student | `practice.mjs` |
| Review | raw score, each answer, the correct answer, accepted variants, and the evidence quote | a question without source evidence says so instead of showing a fabricated line | student | `practice.mjs`, `verify-reading.mjs` |
| Retention tab | recall drill that claims no score | "nothing is scored" is stated on the page | student | `verify-reading.mjs` |
| Admin passage page | the passage and its questions | ADMIN/OWNER only; drafts are visibly drafts | ADMIN/OWNER | `verify-publication.mjs` |

## 3. The universal material composer

One composer, eight content kinds (`lesson, reading, listening, writing, speaking,
grammar, assignment, live_class`). Management surfaces:
`/admin/materials` → `/admin/materials/<kind>` → `/admin/materials/<kind>/<id>`.

| Block / control | Behaviour |
| --- | --- |
| Add block | pick text · link · image · audio · file |
| Text | character field, must not be blank |
| Link | must parse as a URL, must not be `javascript:` |
| Image / audio / file | preflight check (type, size) → server-issued intent → upload with real byte progress → finalize → the server HEAD-verifies it before it is claimable |
| Per-block states | idle · uploading (with progress) · uploaded · **failed with the reason and a retry** · removal |
| Save | sends the whole ordered list; enabled only when something changed; `Saving…` → `Saved` or an error with retry |
| Empty state | a dashed line that says there is nothing yet |
| Removal | the row disappears; deleting the block does not touch the learner-facing history |
| Visibility | students see the blocks of content that is live; a draft shows nothing |
| Permission | ADMIN/OWNER write; STAFF read; a student reads only live owners. A student PUT is **403** — proven in `materials.mjs` |
| Delivery | `/api/resources/<objectKey>` re-checks authorization on every request; the bucket stays private |

## 4. Other learning surfaces

| Surface | Key controls | States |
| --- | --- | --- |
| Dashboard | "continue where you left off", what is open now, retention card, tasks | real data or a truthful empty state |
| Listening | attempt, transcript (clickable), revision studio, speed training | in progress · analysis · revision |
| Writing | prompt cards, typing trainer, history | the word target is stated; typing numbers are computed by the server |
| Speaking | materials by category, practice studio (record → submit), shadowing, history | honest: no transcript ⇒ the page says there is no transcript |
| Grammar | quiz, Correct it / Translate with it / Activate it, mastery card | mastery is stored per topic |
| Vocabulary | one engine, several views, SRS deck, games | SRS: 1/3/7/16/35 days, DB-backed; games never advance the schedule |
| Progress | what is actually completed | empty until there is something to show |
| Mock tests | what a mock is and is not | the page states the runner honestly rather than pretending |
| Assignments | free-form response, submit for evaluation, the evaluator is named | pending → submitted → checked by <evaluator> |
| Live classes | join window, attendance, recording | opens at a time, closes at a time; joining is recorded |
| Support | report form, plus where else to get help | staff-only link to the inbox |

## 5. Management surfaces

| Surface | Purpose | Guard |
| --- | --- | --- |
| `/management` | the entry screen: what management is, and the way back to learning | STAFF |
| `/admin/people` | who is in the centre, approval decisions | ADMIN/OWNER |
| `/admin/admissions` | pending applications with the information the applicant submitted | ADMIN/OWNER |
| `/admin/content` | content library with per-kind live/draft counts | ADMIN/OWNER |
| `/admin/materials` | the eight content kinds → the composer | ADMIN/OWNER |
| `/admin/reading`, `/admin/listening`, `/admin/writing-prompts`, `/admin/grammar`, `/admin/video-lessons` | authoring and publication | ADMIN/OWNER |
| `/admin/users` | accounts and roles | ADMIN/OWNER |
| `/owner`, `/owner/audit`, `/owner/retention`, `/owner/integrations`, `/owner/transfer` | centre console, audit log, retention policy, integration status, ownership transfer | OWNER |
| `/teacher/students`, `/teacher/support`, `/teacher/live-classes`, `/teacher/speaking` | teaching surfaces | STAFF |

Publication states (`draft → scheduled → published → archived`) are enforced in
one place (`isLive()`), and every change is audited with its previous and new
state (`verify-publication.mjs`).

## 6. What the matrix proves, and what it does not

Proven in this sandbox, on the production build: every visible destination for
five accounts at four widths, Day/Night, UZ/EN, hard reload, client navigation,
no JavaScript errors (`matrix.mjs` 157/157); the shell's independent scrolling
(`shell.mjs` 36/36); the practice workspace (`practice.mjs` 27/27); the composer
on all eight kinds (`materials.mjs` 21/21, `composer.mjs` 16/16).

Not proven here: production routing/behaviour (**EXTERNALLY UNVERIFIED**),
third-party integrations (Telegram, R2 in production, AI providers — statuses
recorded in the integration report), and touch behaviour on a real phone
(measured only as layout, not as finger feel).
