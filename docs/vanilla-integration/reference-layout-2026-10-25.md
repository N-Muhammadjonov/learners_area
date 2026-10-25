# Main screenshot reference corrections

The supplied Main screenshots revealed missing Writing metadata, incomplete Grade presentation, an incorrect workflow grid and body-level return links. The native interface now restores these details, keeps route returns in the topbar, and uses the campus module colors for button and content-box borders.

## Reference and scope

Reviewed all 20 supplied screenshots, representing 19 distinct images. They cover Dashboard, Listening tests/MCQ, Reading Academic/General/Retention, Writing Exam/Typing/Topic Vocabulary/Grade/Language Stealing, Speaking home/Live Partner/solo practice, Vocabulary Words/folders and Games. Main source is pinned to `b62b78f469e4f73aa80f441f630b012dc422af39`; the independent comparison verifies its 684 source checksums before running. Native changes are based on the visual/behavioral contract and use DOM construction, CSS and the existing FastAPI endpoints.

## Corrections

| Area | Result |
| --- | --- |
| Workspace borders | The actual campus configuration supplies the module hue. Cards, inputs, buttons, painted text boxes and dialogs use colored edges with a restrained static glow. Map rendering retains its existing styles. |
| Route returns | Ordinary pages and detached Listening/Reading detail frames place the route return in the topbar. Body-level route links are consolidated. Timed Reading retains its own header. Local question controls, leave/submit/cancel actions and breadcrumbs keep their behavior. |
| Responsive return | Phones and portrait tablets retain the arrow-only Back. Desktop/landscape tablet show Back text. Visible tab workspaces retain Main; detached details use Back to history or the registered parent. |
| Focus theme | The section band uses the flat Day/Night palette. Reading intro remains a white surface with readable metadata, actions and topbar locale controls. |
| Writing width | Removed a module CSS override that expanded the intended maximum content width. |
| Writing Exam entry | Three cards include the 20/40/60-minute durations, 150+/250+/Full minimums, real question availability and disabled states. Resume includes mode/deadline; recent papers include dates and state. |
| Grade My Work | New/My essays show the active subtab. The boxed form and marking-explanation sidebar match the reference structure. Essays include task/date/word count/question/score. Server readiness controls the AI-unavailable notice. |
| Language Stealing | Seven responsive workflow steps, two-column pattern library, empty notices, function/task/band/topic/example/usage metadata and existing save/adaptation controls. |
| Topic Vocabulary | Reference intro width, section spacing and empty-result surface, retaining URL filters, canonical saves and Activation links. |
| Vocabulary | Removed the extra body title while retaining the learning hint and search. Search includes status, Uzbek translation, outside-click closing and keyboard selection. A stale reply cannot replace a newly typed query. Re-selecting an open word keeps it open. |

The readiness read occurs before acquiring the page database connection. The open-paper countdown comes from the owned server deadline. No navigation-level session polling or database migration was added.

## Validation

- Final native suite: 1009 passed, 0 failed, 11 existing skips (1020 total).
- Backend suite: 2572 passed.
- Main component comparison: 43 rendered control states, 0 differences (order, accessible names, classes and disabled state).
- Real ASGI plus isolated embedded PostgreSQL: 66 migrations, 126 typed tables, 333 HTTP checks, 148 decoder checks and 120 native DOM checks passed. Fresh responses supply the theme audit.
- Targeted tests cover the restored metadata and controls, stale search ordering, actual shell colors, responsive return, Focus palette and preservation of media/draft node identity when adding the return frame.
- Final contrast/return audit: 105 route/query states × 4 palette combinations = 420 cases, 21,708 direct-text checks, 0 failures and 0 unresolved colors. All 8 visible return candidates in the audited detached frames were inside the topbar; no generic body return remained in those samples.
- Python-only asset package: 459 runtime files, 119 routes; startup check passed.

Screenshots were visually inspected. Runtime verification uses isolated data and DOM/CSS probes, with fixture availability recorded. Browser geometry, image pixels, iframe contents and every possible production state remain outside that automated evidence. This report does not claim whole-site pixel parity.
