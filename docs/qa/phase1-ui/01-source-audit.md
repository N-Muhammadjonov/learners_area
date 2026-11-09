# Phase 1 source audit

Baseline: `0a3acd9c8937662c10bb44ba811074ffba6bcd61`, `arena/learners-area-next`.
The checkout is a materialized subset. Remote writes preserve the complete existing tree and use a guarded parent SHA.

Vanilla ESM SPA: `js/main.js`, `router.js`, `workspace.js`; native DOM in `js/native.js`, shared generated presentation, module-specific controllers. `css/source.css` is Tailwind input; `global.css` is the checked-in generated stylesheet. `campus.css` contains overlapping historical palettes. Python only packages the already-built browser assets. No framework change is needed.

Reference review: all 205 PDF pages rendered and inspected in 13 contact sheets. Relevant unique views: Home 1–2, Practice 3, Speaking 7/25–26/54–55/90–92/95/102–110, Vocabulary 8/89/96–100, Progress 9/101, Listening 27–38, Reading 39–48, Writing 49–53, Article/Podcast 56–88. Remaining frames include repeated scrolling, pricing/leaderboards and Telegram redirects. ZIP is a minified production bundle, not source. Observed blue #3a56cc buttons, .18s hover/press, 12–16px corners, low-opacity skill gradients and three-column catalogues. No reference code or character is copied.

| Task | Existing | Desired | Implementation boundary |
|---|---|---|---|
| 1 Design | Mixed glass/flat palettes and important overrides | One quiet day/night token family | Shared stylesheet, ordinary shell scope |
| 2 Dock | 400ms opening capture/window effect | Immediate existing SPA routing; optional labelled list | Remove opening path; preserve router/history/scroll |
| 3 Buttons | Solid pills and repeated gradients | Primary/secondary/destructive hierarchy, 12px corners | Shared classes; isolate obsolete palettes |
| 4 States | Existing badges and per-module labels | Consistent icon/text/state presentation | Preserve every backend state and action |
| 5 Cards | 16px cards, mixed grids | 20px shared cards; 3-column catalogues | Presentation only |
| 6 Dashboard | Mock charts precede learner summary | Greeting, real summary, tasks, skills, supporting stats | Preserve three independent reads and all nullable data |
| 7 Hierarchy | Repeated high-emphasis CTAs | One main action per context | Native DOM order and spacing |
| 8 Motion/mascot | Heavy opening effect, no companion | Short hover/press and original SVG | No microphone or game logic |
| 9 Desktop | 1440px shell and narrower nested pages | Content-aware wider dashboard | Keep deep exam layout |
| 10 Mobile | Scrollable glass Dock | Contained icons, stable labels, safe area | Existing keyboard and scroll policies |
| 11 Skills | Reading orange, listening blue, mixed accents | Teal/blue/green/purple tokens | Separate skill identity from status meaning |
| 12 Empty | Shared EmptyState plus manual variants | One illustrated pattern distinct from errors | Keep retry callbacks and unavailable states |
| 13 Accessibility | Existing semantic controls and focus, legacy motion exceptions | Visible focus, contrast, touch and reduced motion | Preserve modal traps and role boundaries |
| 14 Exam | Detached focus frames and timing controllers | Preserve focus, timer, question/answer behavior | No exam mechanics edits |

QA uses repository synthetic fixtures in a GET-only local preview, never live production data. Screenshots name page, theme, embedded viewport and before/after. Browser checks inspect the real application rendered in isolated iframe viewports, including a 1920px desktop. Product runtime excludes tests and QA fixtures.
