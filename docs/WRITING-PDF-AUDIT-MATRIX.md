# Writing — 19-page reference PDF audit matrix (Part K)

Reference: `docs/owner-references/booster-ui-reference/BOOSTER_8_WRITING_UI_REFERENCE_19_PAGES.pdf`, used for **information architecture only**. We copy no names, logos, essays, statistics or other third-party content.

The page purposes below come from the PDF's own text layer, extracted locally with pypdf. Code and test references are from the Typing-closure commit and later (page 11 updated after the 1/2/3-minute presets landed).

How to read the columns:
- **Functional** is backed by code and automated tests in this repo. It is local evidence only, not Preview evidence.
- **Visual** is always `SOURCE-ALIGNED / EXTERNALLY UNVERIFIED`. No browser could run in this sandbox, so we never claim a screen "matches the PDF". Visual parity needs owner checks on the final Preview SHA at 1440–320, in Day/Night and in UZ/EN.

| # | PDF page purpose | Learners Area route / component | Functional status | Tests | Visual |
|---|---|---|---|---|---|
| 1 | Writing overview with 8 tabs | `/writing` (URL-backed `?tab=`), `components/writing/workspace` | IMPLEMENTED | writing-workspace | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 2 | Lessons: Task 1 list + workspace | `/writing?tab=lessons`, `/writing/lessons/[id]` | IMPLEMENTED (content comes from Management; lists are empty until staff publish) | writing-workspace, writing-admin J6 | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 3 | Lessons: Task 2, same workspace | same as page 2 | IMPLEMENTED (lesson counts are counted from the DB; the PDF's 12/15 are not copied) | writing-workspace | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 4 | Exam mode: Task 1 / Task 2 / Full | `/writing?tab=exam`, `lib/writing/exam-modes.ts` | IMPLEMENTED | writing-exam | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 5 | Task 1 attempt, 20:00, 150+ words | `/writing/exam/[id]` (server-held deadline, autosave) | IMPLEMENTED; publishing a Task 1 prompt needs an uploaded visual (J8) | writing-exam, writing-admin J8 | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 6 | Task 2 attempt, 40:00, 250+ words | `/writing/exam/[id]` | IMPLEMENTED | writing-exam | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 7 | Full paper, 60 min, both tasks | `/writing/exam/[id]` mode `full` (migration 0032, **not applied to shared DBs**) | IMPLEMENTED LOCALLY; needs the 0032 approval | writing-exam | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 8 | Translation picker (question type, band) | `/writing?tab=translation` | IMPLEMENTED | writing-translation | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 9 | Sentence-by-sentence translation | `/writing/translation/[id]` (no future answers sent) | IMPLEMENTED | writing-translation | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 10 | Assessment after the final sentence | translation result view (deterministic; not labelled as AI) | IMPLEMENTED | writing-translation | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 11 | Typing trainer on model texts | `/writing?tab=typing`, `TypingTrainer.tsx` (Band 8–9 model texts; 1 / 2 / 3-minute presets + untimed full text, chosen before Start) | IMPLEMENTED. The preset is bound into the server-signed start token; elapsed time is capped at the preset; the token expires preset + 30 s; input locks and auto-finalizes at 0:00; history records the preset (migration 0034, **not applied to shared DBs**) | writing-typing, writing-typing-presets TY10–TY19, writing-admin J12 | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 12 | Run result (WPM / accuracy) | typing result panel (server-computed metrics) | IMPLEMENTED (no figures from the PDF are copied) | writing-typing | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 13 | Topic Vocabulary by topic | `/writing?tab=topic-vocabulary` (canonical vocabulary packs; no Writing word table) | IMPLEMENTED; the topic count depends on content (the PDF's "60" is not claimed) | writing-topic-vocabulary, writing-admin J22 | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 14 | Grade my work: submit | `/writing?tab=grade` (existing OpenAI coach path on the server) | IMPLEMENTED; live AI is **EXTERNALLY UNVERIFIED** (no secrets here) | writing-grade, writing-ai-readiness | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 15 | Examiner comment, 4 criteria | `/writing/grade/[id]` (overall derived on the server, half-bands, TA for Task 1) | IMPLEMENTED; when AI is unavailable the essay is kept and no band is shown | writing-grade | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 16 | Sentence corrections + next actions | `FeedbackView.tsx` | IMPLEMENTED (filled only by real provider output) | writing-grade | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 17 | My essays history | `/writing/history` (no provider call) | IMPLEMENTED | writing-grade | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 18 | Activation Lab | `/writing?tab=activation`, `components/writing/activation` | IMPLEMENTED (deterministic scoring; honest when unavailable) | writing-activation | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |
| 19 | Language Stealing, 7-step cycle | `/writing?tab=language-stealing`, `/writing/language-stealing/[id]` (migration 0033, **not applied to shared DBs**) | IMPLEMENTED LOCALLY; needs the 0033 approval | writing-language-stealing, -flow | SOURCE-ALIGNED / EXTERNALLY UNVERIFIED |

Staff side, which has no PDF page: `/admin/writing` is the one ADMIN/OWNER Management area for lessons, exam prompts with Task 1 visuals, translation sets, model texts and patterns. It uses the shared publication rules and audit (tests J1–J24 in `tests/writing-admin.test.ts`).

## Totals (denominator 19)
- IMPLEMENTED with local tests: 15
- IMPLEMENTED LOCALLY but blocked on shared-DB migration approval: 3 (page 7 → 0032, page 11 presets history → 0034, page 19 → 0033)
- PARTIAL: 0
- Content-dependent count, not claimed: 1 (page 13)
- Visual verified: 0 of 19. All are EXTERNALLY UNVERIFIED.
