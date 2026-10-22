# V39 Listening — GPT Work handoff

**Status: Listening NOT COMPLETE. No route or component promoted in V39.** Route counts stay 9 CODE COMPLETE / 6 IN PROGRESS / 1 Staff. Full audit: `docs/V39_LISTENING_HUB_ACTIVITY.md`. Baseline for this handoff: V38 `6208ce8558130d132a20fa28846c1e1e37cfb7fd`; V39 commit is recorded in the implementation report and final chat message.

## What is safe to rely on

- Two source-grounded native repairs, each reproduced first and PASS after:
  - `modules/listening/route-v7.js`: activity segments `0`, `6`, malformed ids and non-numeric non-practice segments return not-found with no request (original `tests/[id]/[activity]/page.tsx` rule; `02` is activity 2).
  - `modules/listening/practice.js`: Previous/Next clears the prediction field (original `ListeningPractice.tsx` line 32).
- `tests/browser-listening-v39.mjs`: 78 PASS / 0 FAIL (final run 14). Evidence: `docs/evidence/v39/final-run14-browser-listening-v39.txt` and `docs/evidence/v39/browser-listening-v39-results.json`.
- Unit tests: `npm test` 605 PASS / 0 FAIL (`docs/evidence/v39/unit-npm-test-final.txt`). Assets: `npm run check:assets` PASS.
- Regression reruns (scratch copy, same code): browser-v7 26/0, browser-v8 79/0, browser-v9 29/0, browser-v10 53/0 (all equal to repo historical baselines); browser 27/0, browser-v2 14/0, browser-v3 49/0, browser-v4 72/0, browser-v5 52/0, browser-v6 77/0, browser-v11 18/0, timing 14/0, assets PASS, listening-v38 5/0, revision-v37 1/0. Logs in `docs/evidence/v39/regression/`.
- The `← Test hub` inner link on the Activity screen is the original's untranslated literal (`FullListeningActivity.tsx` line 237, every locale). Native matches. This is parity, not a defect.
- The original sources and the 32 original Listening HTML tests are not edited. `src/` diff is empty.

## What is NOT safe to rely on

- **Visual, hub 768 UZ day:** strict FAIL unresolved (2 pixels, max channel delta 1, geometry 18/18). Tolerance is unchanged. Diagnostic: `docs/evidence/v39/hub-diagnostic.json`. A fresh-vs-fresh control for this exact viewport was not measured.
- **Visual, V37 strict FAILs still open:** revision 1440 EN/UZ day/night and revision 768 EN night (all max channel delta 1, geometry equal). Not investigated in V39.
- **Actual-source chain** (`ORIGINAL_SOURCE_ROOT=/home/user/learners_area npm run test:original-source:v27`): V38 HEAD 418/0. V39 run 1 gave 417/1 (`V15 repeated SPA Back/Forward and rapid mounts`, 8000 ms iframe `#hub` timeout). The same journey passes alone (40/0), and the full-chain rerun passes 418/0. Classified as an intermittent, timing-sensitive failure; root cause not isolated. Details in the V39 doc, section *Regression evidence*.
- **Equivalent controls** (`V22_SOURCE=1 V22_BENCH=1`): the two controlled hash-navigation cases PASS in a 33/0 V22 run.
- **Not run in V39:** Activity lexical assistance (`lexical-policy.ts`), Activity 5 Study/Say-it (`speechSynthesis`), touch and back/forward on activity screens, 403 on activity writes/start, activity 2–4 clip media lifecycle, UZ on practice.

## Candidate for GPT Work integration

- Code: `modules/listening/route-v7.js`, `modules/listening/practice.js` (both small, both source-cited).
- Tests: `tests/browser-listening-v39.mjs`, `tests/browser-listening-visual-v39-diagnostic.mjs`.
- Evidence: `docs/evidence/v39/`, including `harness-iterations/` (earlier failing runs kept for audit).
- Ledgers: `docs/route-ledger-v37.json` and `docs/component-ledger-v37.json` gained `v39` keys only; no status changed.

## Next actions, in order

1. Activity lexical assistance: audit `src/app/app/(focus)/listening/tests/[id]/[activity]/page.tsx` and `src/lib/listening/lexical-policy.ts` against native lexical use; add browser cases before any Activity promotion.
2. Activity 5 Study / Say-it: audit the `speechSynthesis` path against the original; add cases.
3. Activity screens: add touch, back/forward, 403, and UZ practice cases; add activity 2–4 clip media lifecycle.
4. Watch the actual-source intermittent (V15 SPA Back/Forward). If it recurs on the current code, compare its trace against HEAD before any change.
5. Hub 768 UZ day: measure the fresh-vs-fresh reference control for this viewport. Do not change tolerance or palette.
6. Attempt detail `/app/listening/attempts/:id` (`src/app/app/(focus)/listening/attempts/[id]/page.tsx`): close the source provider and authored media gate (ledger note: still partial).
7. Revision `/app/listening/attempts/:id/revision`: investigate V37 strict FAILs (1440 EN/UZ day/night, 768 EN night) the way hub 768 UZ day was investigated; then close the source/provider/media permission and all-caller gate.
8. MCQ library `/app/listening/mcq` (`src/app/app/(shell)/listening/mcq/page.tsx`): enumerate source states; live data stays external.
9. MCQ Day `/app/listening/mcq/day/:day` (`src/app/app/(shell)/listening/mcq/day/[day]/`): same source-state audit; add a case for the day-completion `history.replaceState` + `context.refresh()` path.

## Owner decisions (separate from implementation)

- Phase2 A–J release decision: unsigned. Not required for route promotion; not approved here.
- Production access, live integration, hardware Safari with real audio: not verified; external, not frontend defects.
- Tests 10 and 25 (authoritative external data issues): unchanged; no clamping or regeneration.
- Tests 11/22 storage-key discrepancies: need source authority; not silently chosen.
- Untranslated `← Test hub` literal in the original Activity screen: observation for the owner.
