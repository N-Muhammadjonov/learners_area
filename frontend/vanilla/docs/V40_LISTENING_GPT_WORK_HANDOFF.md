# V40 Listening GPT Work handoff

**Status: Listening NOT COMPLETE.** No route promoted. Ledger counts unchanged: 9 CODE COMPLETE / 6 PARTIAL / 1 Staff of 15 learner routes (desired 11/4/1 not reached). Hub and Activity closure: `V40_LISTENING_HUB_CLOSURE.md`, `V40_LISTENING_ACTIVITY_CLOSURE.md`.

## Safe to rely on

- Repair: `modules/listening/speed-practice.js`. Activity 2 speed Check no longer loses the typed answer, score or open panel on the post-Check refresh. Before-fix failing run and after-fix passing run are in `docs/evidence/v40/logs/`. Native state lives in router `context.state`, cleared on navigation.
- Test suite: `tests/browser-listening-v40.mjs`, 47 PASS / 0 FAIL. Writes only to `docs/evidence/v40/`. Its results file is `docs/evidence/v40/browser-listening-v40-results.json`.
- Corrected finding: Activity 2 first attempt does have typed inputs (`ListeningSpeedPractice`, native identical). Parity PASS.
- Regressions: V39 78/0, browser-v8 79/0, `npm test` 605/0.
- Visual Hub 768 UZ Day: diagnostic re-run shows nondeterministic residual (A and B 0 px; C 0 px this run; D 2 px max delta 1; settle 0/8). Strict FAIL stays. Tolerance unchanged.
- V15 SPA Back/Forward: passes alone 3/3 with `ORIGINAL_SOURCE_ROOT=/home/user/learners_area`. Historical 417/1 retained; not reproduced alone.
- The 32 original Listening HTML sources are byte-identical to baseline. `src/` and `content/` are unchanged.

## Not safe to rely on

- Hub authored-frame media lifecycle: no V40 browser cases.
- Activity at 768 and 390 for interaction (layout only was checked), practice at 768 and 390, Activity Back/Forward per branch, attempt-identity replacement during an in-flight write, other-user attempt data.
- Activity strict visual: not run.
- Hub strict visual 768 UZ Day: FAIL (historical). Needs a determinism mechanism or owner decision.
- Media Range/LRU/transport limits and private-media 401/403 on audio: not re-verified in V40.

## Harness notes (for the next agent)

- The preview serves `build/`, not `src/` or `modules/`. Run `npm run build` after any `modules/` or `js/` change before a browser run.
- Browser runs share port 4173. Run one at a time. V39 and V40 suites rewrite tracked JSON; restore tracked files with `git checkout --` after runs (V39 results, V39 diagnostic JSON, V8 screenshots, V15 folder), or write to a new folder.
- Playwright `waitForFunction` predicates are blocked by the preview CSP (`script-src 'self'`). Use evaluate-based polling.
- The V15 chain requires `ORIGINAL_SOURCE_ROOT=/home/user/learners_area`. Without it the runner throws at startup.
- Lexical regions include question texts. Tab order reaches question regions before the transcript.

## Next actions, in order

1. Hub authored-frame media browser cases (init, teardown, source replacement, stale callbacks, error, revocation). Add to a new suite. Keep `sandbox="allow-scripts"` only.
2. Activity interaction matrix at 768 and 390 for practice Matching, Completion, Retry, Map and for Save or Complete on Activities 2-4.
3. Owner decision on the Activity ledger gate note (General/provider/authored/full Listening). If resolved, promote Activity; otherwise keep IN PROGRESS.
4. Hub 768 UZ Day strict FAIL: owner decision on determinism or tolerance. Do not change tolerance unilaterally.
5. Next route: attempt detail `/app/listening/attempts/:id`, then revision `/app/listening/attempts/:id/revision` (five V37 strict FAILs, not four), then MCQ library `/app/listening/mcq`, then MCQ Day `/app/listening/mcq/day/:day`. Not started in V40.

## Owner decisions (separate from implementation)

- Phase2 A-J approval: unsigned. Not issued.
- Production access, live backend, hardware Safari with real audio: not verified; external.
- Tests 10 and 25: blocked by authoritative external data. No clamping.
- Tests 11 and 22: need source authority. Not silently chosen.
- Untranslated `← Test hub` literal in the original Activity screen: preserved; owner may request localization.
