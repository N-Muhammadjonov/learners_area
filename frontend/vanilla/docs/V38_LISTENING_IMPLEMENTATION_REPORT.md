# V38 Listening Implementation Report

**Verdict: NOT CODE COMPLETE.** V38 did not deliver the working frontend for the six partial learner routes that the V38 directive requires. It delivered a verified audit of all six routes against their original source, two genuine behavior repairs, a focused browser suite, and a full mandatory regression run. The remaining original work is listed per route below. No route, component or workflow is promoted.

Baseline V37 `79a289298f25a26e4804168df9d228129294a024` (branch `arena/96836bcf-learners-area`). V38 commit: the commit that contains this report is listed in the final chat message, with clean-tree evidence.

## 1. Branch and commit

- Branch: `arena/96836bcf-learners-area` (fixed; not renamed).
- Base: V37 `79a2892` (pushed, clean at V38 start).
- V38 changes are one code commit plus V38 documents and evidence. No main merge, no deploy, no ZIP.

## 2. Six routes, before and after

| Route | V37 | V38 | Change in V38 |
|---|---|---|---|
| `/app/listening/tests/:id` (Hub) | IN PROGRESS | IN PROGRESS | none (audit: no missing branch found) |
| `/app/listening/tests/:id/:activity` | IN PROGRESS | IN PROGRESS | none (audit: no missing branch found) |
| `/app/listening/attempts/:id` | IN PROGRESS | IN PROGRESS | legacy submit error mapping |
| `/app/listening/attempts/:id/revision` | IN PROGRESS | IN PROGRESS | none (V37 SpeedTrainer fix preserved) |
| `/app/listening/mcq` | IN PROGRESS | IN PROGRESS | none (audit: faithful) |
| `/app/listening/mcq/day/:day` | IN PROGRESS | IN PROGRESS | reasoned completion uses replaceState + refresh (no transient heading focus) |

Routes stay 9 CODE COMPLETE / 6 IN PROGRESS / 1 Staff NOT STARTED. Details: `V38_LISTENING_ROUTE_CLOSURE_MATRIX.md`.

## 3. Nine preservation proofs

Preservation evidence: the mandatory runner's `historical-evidence-preservation.json` (1679 files, equal), and `git status` after the final run shows no tracked evidence file modified. `git diff` of `src/` against V37 is empty (0 lines). `preservation-listening-v37.py` was NOT run in V38. Preserved: V30 exact 544/499/418/14/4; V31 12/12; V32; V33; V34; V35; V36; V37 final; the 32 original Listening source files (not edited; `src/` untouched); the V36 preservation archive at `/home/user/v36-preserved/`; the V37 runtime and test files (`script-v37.js`, `listening-v37.test.mjs`, `original-script-v37-journeys.mjs`, `browser-listening-visual-v37.mjs`, `browser-listening-revision-v37.mjs`, `reference-listening-v37.json`); the V37 SpeedTrainer attempt-ID fix; V37 evidence.

## 4. Source changes (the only product code in V38)

1. `migration/vanilla-frontend/modules/listening/legacy.js`: in-progress legacy exam submit catch now uses `failure(e,dict)` from `js/request-errors.js` (429 → rate-limited, network → network, other → server). 409 still refreshes. Import added.
2. `migration/vanilla-frontend/modules/listening/mcq.js`: MCQ Day reasoned completion uses a same-path-guarded `history.replaceState` followed by `context.refresh()`, matching original `router.replace` + `router.refresh`. Verified discriminating (see browser verification §2).

No API, adapter contract, auth, grading, progress, or backend change. No new endpoint, service, or live request.

## 5. New files

- Code/test: `migration/vanilla-frontend/tests/browser-listening-v38.mjs` (5 cases).
- Scripts: `package.json` gained `test:listening-v38`.
- Evidence: `docs/evidence/v38/` (`v38-browser-results.json`, `browser-listening-v38-final-run.txt`, `mcq-focusin-discrimination-pre-fix.txt`); `docs/evidence/v37/v38-final/` (mandatory run, 17 commands, all exit 0).
- Documents: `V38_LISTENING_IMPLEMENTATION_REPORT.md`, `V38_LISTENING_ROUTE_CLOSURE_MATRIX.md`, `V38_LISTENING_COMPONENT_CLOSURE_MATRIX.md`, `V38_LISTENING_WORKFLOW_CLOSURE_MATRIX.md`, `V38_LISTENING_BROWSER_VERIFICATION.md`, `V38_LISTENING_VISUAL_PARITY.md`, `V38_LISTENING_GPT_WORK_HANDOFF.md`.
- Ledgers updated (additive `v38` keys only; statuses unchanged): `route-ledger-v37.json` (six routes), `component-ledger-v37.json` (`ListeningExam.tsx`, `McqMastery.tsx`).
- `GPT_WORK_HANDOFF.md`: V38 header prepended.

Not updated (no change to report): `SOURCE_STATE_INVENTORY_V37.md`, `ADAPTER_CONTRACTS_V37.md` (no adapter or source-state change), `V37_DEPENDENCY_INVENTORY.json` (no dependency change).

## 6. HTML preservation

The original Listening HTML tests were not edited: `src/` has a zero-line diff against V37 in this branch. The 32-file byte-identity check (`preservation-listening-v37.py`) was NOT re-run in V38. Authored HTML is rendered through the existing `authored.js` and `AuthoredListeningFrame` path; no HTML was reconstructed, and no question, answer, transcript, audio, timing, ID, CSS or control was changed.

## 7. Audio status

No audio change in V38. Encoded media suites (3/0), browser-v8/v9/v11 media checks are part of the mandatory run and pass. Real audio, Safari hardware and live private audio remain NOT VERIFIED. Synthetic fixture audio is not original audio.

## 8. Progress and revision

- Progress writes: no change. Authorized progress and draft/submit APIs are unchanged; the legacy submit path still calls the existing `/api/listening/attempts/:id/submit`.
- MCQ Day progress: the change only alters how the page is re-derived after a reasoned answer; the PATCH and mastery semantics are unchanged.
- Review & Revision: ReviewAuthorityBarrier, ReviewJournal, CheckpointWriter, exact-byte ACK, single-flight writes, Retry/Adopt, pending learner bytes and foreign-context isolation are unchanged and not re-audited in V38. Phase2 A–J is a separate BLOCKED owner decision.

## 9. Navigation and direct URL

- Legacy attempt route: the focus group keeps `dataset.focus='off'`, matching the original layout (verified by case a).
- MCQ Day: no navigation focus is moved after a reasoned answer (verified by case c, discriminating).
- Direct-URL, back/forward/reload, keyboard and touch passes for all six routes were NOT executed as a V38 matrix. This is an unfinished verification item.

## 10. Auth and ownership

- No auth, ownership or foreign-attempt change. The server remains authoritative; URL, history and storage are not grants.
- Other users' attempt refusal is a server contract and was not re-verified in V38 (no live probes).

## 11. Test results

- Units: 605 PASS / 0 FAIL / 0 SKIP.
- Browser: 499 PASS / 0 FAIL (includes encoded media 3).
- Actual-source: 418 PASS / 0 FAIL / 0 SKIP.
- Timing: 14 PASS / 0 FAIL (diagnostic).
- Equivalent controls: 2 PASS / 0 FAIL.
- V38 focused: 5 PASS / 0 FAIL / 0 SKIP.
- Assets: `scripts/assets-css-v33.mjs` exit 0 (`renderedVisualComparison: false`; not a visual result).
- Script sweep and Script 12-case matrix: not re-run in V38 (Script code unchanged).

Full table: `V38_LISTENING_BROWSER_VERIFICATION.md`.

## 12. Visual results and fixes

- Strict visual (V37, retained): 66 PASS / 6 FAIL. Six FAILs are the V38 targets: revision 1440 EN/UZ day/night, revision 768 EN night, hub 768 UZ day; max channel delta 1, geometry equal.
- V38 did NOT fix them. Cause investigation was not completed. Tolerance, palette and design were not changed. No visual result is claimed as improved.

## 13. Remaining defects and unfinished source work (exact)

Not implemented in V38, per route:

1. Hub (`tests/:id`): visual FAIL (hub-768-uz-day) cause; keyboard/touch/back-forward/reload/disposal pass; live `/api/frontend/view` integration UNVERIFIED.
2. Activity (`tests/:id/:activity`): per-source journeys for Map, Choose TWO, Completion, Vocabulary across the 32 original sources; Script source coverage beyond the V37 matrix, Tests 10/25 BLOCKED.
3. Attempt (`attempts/:id`): source-specific attempt states beyond the V37 set; legacy in-progress strict visual; other-user refusal re-verification; section/exam path re-verification.
4. Revision (`attempts/:id/revision`): five strict visual FAILs (cause unknown); evidence-navigation, focus and modal pass for every source; Review Phase2 release is a separate BLOCKED owner decision.
5. MCQ library (`mcq`): loading/error/retry pass; live catalogue/mastery UNVERIFIED; responsive/EN-UZ/theme strict coverage beyond the V37 set.
6. MCQ Day (`mcq/day/:day`): day validation and correct-answer disclosure rules not re-audited; session-expiry and live grading UNVERIFIED; original-state visual.

Components: 10 PARTIAL components remain IN PROGRESS (the directive's ten), and 5 Staff/import components remain NOT STARTED (excluded). Workflows: 7 PARTIAL workflows remain PARTIAL. Details: `V38_LISTENING_COMPONENT_CLOSURE_MATRIX.md`, `V38_LISTENING_WORKFLOW_CLOSURE_MATRIX.md`.

Not completed: the directive's Milestones 1–8. V38 performed a read-only audit of the hub and activity routes (Milestone 1), and two repairs touching the attempt and MCQ Day routes (Milestones 2–3). Milestones 4–8 were not started.

## 14. Owner and content decisions

- Phase2 A–J release decision: unsigned, BLOCKED (owner decision; not a frontend blocker).
- Tests 10 (40 invalid timing mappings) and 25 (Q30 1236 > 1235.879; Q40 1525 > 1524.01): authoritative external data required; no clamping, guessing, or regeneration.
- Tests 11/22 storage-key discrepancy: needs source authority; not silently chosen.
- Integration candidate: Full IELTS Test (V37), owner selection pending.

## 15. Live status

LIVE INTEGRATION UNVERIFIED. The preview API returns 503 by design; no live probes, no auth bypass, no expanded diagnostics were performed. `/api/frontend/view` remains proposed, not deployed.

## 16. Staff exclusions

Excluded and untouched: `FullListeningLibrary`, `ListeningTestActions`, `ListeningImport`, `ListeningLegacyImport`, `audio-probe`. The protected learner import redirect is preserved. `/app/listening/lessons/author` and Staff routes remain reserved (35 Staff routes).

## 17. GPT Work candidate

Full IELTS Test (V37 candidate). V38 does not add evidence strong enough to recommend integration: its own visual FAILs and unverified live paths remain. See `V38_LISTENING_GPT_WORK_HANDOFF.md`. Integration happens later on a separate main-based branch, with owner selection.

## 18. Push and clean-tree evidence

Reported in the final chat message with the commit hash, `git status` output and `git ls-remote` match. This document is part of the same commit as the code.

## 19. Genuinely CODE COMPLETE?

**No.** No route, component or workflow reached CODE COMPLETE in V38.

## 20. Next action

Continue Milestone 1 for the hub and activity routes, starting with the six remaining items in §13.1–13.2, using the existing owners (`hub.js`, `authored.js`, `full-activity.js`, `practice.js`, `exam-start.js`). Then attempt-detail and revision (§13.3–13.4), then MCQ library/day (§13.5–13.6). Start with the hub 768 UZ day visual cause, because it blocks any hub promotion. Owner decisions in §14 remain separate.
