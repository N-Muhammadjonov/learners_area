# V40 Listening Activity closure (`/app/listening/tests/:id/:activity`)

**Status: IN PROGRESS. Not promoted.** Route ledger status unchanged. One real defect was repaired in V40 (Activity 2 speed Check, see below). The promotion is held because the ledger note still lists a General/provider/authored/full-Listening gate that V40 did not re-audit.

Scope: Activity route only. Hub: `V40_LISTENING_HUB_CLOSURE.md`. Matrix: `V40_LISTENING_FUNCTIONAL_MATRIX.md`. Media: `V40_LISTENING_MEDIA_LIFECYCLE.md`.

## Status by dimension

| Dimension | Status | Basis |
|---|---|---|
| Frontend code completeness | IN PROGRESS (no open code defect in the V40 scope) | One defect repaired (below). Promotion held per the ledger gate note. |
| Functional browser verification | PASS for enumerated cases; not a full matrix | V40 suite 47/0 (`docs/evidence/v40/logs/run-07-FINAL-v40-47of47.txt`) plus V39 Activity cases 78/0 in V40 re-run. |
| Strict source-rendered visual | NOT RUN for Activity | No Activity fresh-vs-fresh control was run in V40. |
| Actual Next.js runtime parity | NOT VERIFIED | Standalone browser build only. |
| Live backend integration | NOT VERIFIED | Isolated fixtures only. |
| Hardware / Safari / real audio | NOT VERIFIED | Speech is a JavaScript mock. Media is a generated silent WAV. |
| Phase2 release approval | NOT ISSUED | Unsigned. |

## Defect repaired in V40: Activity 2 speed Check lost state after success

Source: original `ListeningSpeedPractice.tsx` calls `router.refresh()` after a successful Check. React keeps client state across that refresh, so the original keeps the typed answer, the score line and the open panel.

Native defect: `modules/listening/speed-practice.js` called `context.refresh()` but kept rate, answers, result and panel state in the closure. The refresh re-mounted the component. After a successful Check the typed answer cleared, the `<details>` closed and the `n / m` score never appeared.

Reproduction (before fix, pre-fix build): `docs/evidence/v40/logs/run-02-BEFORE-fix-activity2-speed-check-defect.txt`. The case "activity 2 typed answers" fails waiting for the score. A probe showed the input empty, the panel closed and one view refetch after Check.

Fix: the module keeps rate, answers, last result and panel open state in the router-owned `context.state`, keyed by test id. The router keeps `context.state` across `refresh()` and clears it on normal navigation, so the state survives the refresh and is dropped when the learner leaves. The refresh itself, the POST body (`{activity:2, speedRate, answers, complete:true}`), the rate lock (`allowed`), and the failure path are unchanged.

After fix: `run-03-AFTER-fix-activity2-speed-subset-5of5.txt` 5/5 PASS. Leave-and-return boundary: `run-04-...-on-leave.txt` PASS. Full suite: `run-07` 47/47 PASS. The V15 SPA Back/Forward case was rerun alone (3/3); the full actual-source chain was not rerun in V40.

Build note: the preview serves `build/`, so `npm run build` was required before the after-fix run. An early after-fix run failed only because the build was stale; the rebuilt output was then confirmed to contain the change.

## Correction to earlier V40 notes

The earlier note "Activity 2 original has no typed control" was wrong. `FullListeningActivity.tsx` (line 369) mounts `ListeningSpeedPractice` whenever `data.questions` exists, and that component renders a text input (`maxLength 500`) per question, including on the first attempt. Native `FullListeningActivity-v8.js` uses the same condition and the same component. Parity PASS. No control was missing and none was added. The typed inputs and the Check write are now covered by browser cases.

## Activity obligations: V40 disposition

| Area | Result |
|---|---|
| Lexical: spelling-only word (no occurrence) | PASS. No lookup request. Unresolved status (`meaningUnchecked`). |
| Lexical: server occurrence | PASS. One `/api/vocabulary/lookup` keyed by `occurrenceId`. Contextual meaning shown. |
| Lexical: 403 refusal | PASS. Generic error (`errorServer`). No meaning. No retry. |
| Lexical: keyboard | PASS. Tab reaches the transcript region, End and Enter look up the last word, Escape closes and returns focus to the region. |
| Lexical: touch 390 px | PASS. One tap, one lookup. |
| Lexical: popover disposal on navigation | PASS. No popover after Test hub. |
| Lexical: stale lookup after navigation | PASS. No late popover or meaning. One request. |
| Lexical: pronounce | PASS. `speak('lookup','en-GB')`. |
| Lexical policy: lexical off | PASS. Plain text, no targets, no lookup. |
| Activity 5 Say it: cancel then speak, en-GB | PASS. Focus stays on the button. |
| Say it: unsupported browser | PASS. Shows `pronunciationUnavailable`; no exception. |
| Say it: leaving the route cancels speech | PASS. Last speech call is `cancel`. |
| Say it: keyboard Enter and Space, UZ, Night | PASS. One speak per key. Term always `en-GB`. |
| Activity 2 speed: allowed rates only | PASS. Locked options disabled; chosen rate sets the element's `playbackRate`. |
| Activity 2 speed: Check body and single write | PASS. `{activity:2, speedRate:1.25, answers:{1:...}, complete:true}`, one write. `1.25` is the original default (`allowed.at(-1)`). |
| Activity 2 speed: Check 500 | PASS. Typed answer kept, failure text, no score, one write. |
| Activity 2 speed: state across refresh and navigation | PASS (after fix). |
| Activity 2 first attempt: Mark reviewed | PASS. Local draft only, no server write. |
| Activity 3 Save 403 | PASS. Typed answer kept. One write, no replay. |
| Activity 3 save in flight, then leave | PASS. Late success ignored. One write. |
| Activity 4 Save 404 | PASS. Chosen meaning kept. One write. |
| Activity 2 Complete 409 | PASS. Save-failed, no fabricated score, no completion. One write. |
| Activity 1 Start 403 | PASS. Failure shown, no navigation, no automatic replay. |
| Activity 3 401 / network / 500 / draft reload | PASS (V39). |
| Activity 2 Complete 429 | PASS (V39). Save-failed, no score. |
| Activity 2 Complete success, server score | PASS (V39). |
| Activity 4 Commit disabled until choice; Save posts once | PASS (V39). |
| Activity 5 vocabulary save and quiz Check all | PASS (V39). |
| Practice Matching, Finish, Previous/Next, completion, retry, map, 500 retry | PASS (V39). |
| Responsive 768x1024 and 390x844, branches 1-5, EN/UZ, Day/Night | PASS, 20/20. Branch renders, primary control visible, no horizontal overflow. This is a layout check, not a pixel comparison. |
| Media lifecycle (Activity 2-4) | See `V40_LISTENING_MEDIA_LIFECYCLE.md`. |
| Source and attempt replacement mid-write | Partly: V39 source switch by popstate. Attempt-identity replacement during an in-flight write not run. |
| Other-user attempt data never shown | NOT RUN. |
| 401 / 429 / 500 / network on every Activity write | Partly: 401 (V39 Activity 3), 429 (V39 Activity 2), network and 500 (V39 Activity 3 and Hub). Not run on every branch. |

## Not verified in V40 (open for Activity)

1. Full 768x1024 and 390x844 matrix with interaction (V40 checked layout only; not Save, Complete, Matching, Completion or Map at those sizes).
2. Practice Matching, Completion, Retry and Map at 768 and 390.
3. Activity route Back and Forward for every branch (V39 covered hub to activity only).
4. Attempt-identity replacement during an in-flight write, and other-user attempt data.
5. Activity strict visual (no fresh-vs-fresh control run).
6. The ledger gate note (General/provider/authored/full-Listening). Owner decision needed before promotion.

## Regressions run in V40

- `tests/browser-listening-v39.mjs`: 78/0 (run on the post-fix build).
- `tests/browser-v8.mjs`: 79/0 (equal to historical baseline). It rewrote two tracked screenshots; restored with `git checkout --`.
- `npm test`: 605/0.
- `tests/original-exam-v15-journeys.mjs` case "repeated SPA Back/Forward": 3/3 PASS alone (see `V40_LISTENING_MEDIA_LIFECYCLE.md` and handoff).

Native `modules/listening/speed-practice.js` is the only product file changed.
