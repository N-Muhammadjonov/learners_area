# V40 Listening Hub closure (`/app/listening/tests/:id`)

**Status: IN PROGRESS. Not promoted.** Route ledger status unchanged (`IN PROGRESS`, `frontendCodeComplete: false`, `acceptedComplete: false`).

Scope: Hub only. Activity closure: `V40_LISTENING_ACTIVITY_CLOSURE.md`. Matrix: `V40_LISTENING_FUNCTIONAL_MATRIX.md`. Visual: `V40_LISTENING_VISUAL_DIAGNOSTICS.md`.

## Status by dimension (kept separate)

| Dimension | Status | Basis |
|---|---|---|
| Frontend code completeness | IN PROGRESS | No Hub code defect was found in V40. The authored-frame media lifecycle has no browser verification yet, so the ledger keeps the route open. |
| Functional browser verification | PARTIAL PASS | V39 Hub/Activity suite re-run in V40: 78 PASS / 0 FAIL (`docs/evidence/v40/logs/run-00-v39-baseline-78.txt`, `regress-v39-78of78.txt`). Authored-frame media cases not run. |
| Strict source-rendered visual (768x1024 UZ Day) | FAIL, historical, retained | Strict zero-tolerance assertion still fails. The V40 controlled re-run shows the residual is nondeterministic raster noise (max channel delta 1). Tolerance unchanged. See the visual doc. |
| Actual Next.js runtime parity | NOT VERIFIED | The preview is the standalone browser build (`npm run build`, "No React/Next runtime. NOT a complete route migration"). |
| Live backend integration | NOT VERIFIED | All API calls are isolated fixtures. The preview answers `/api/*` with 503 `backend_not_connected`. |
| Hardware / Safari / real audio | NOT VERIFIED | Media uses a generated silent WAV. No device or Safari audio claim is made. |
| Phase2 release approval | NOT ISSUED | Signed A-J approval remains separate and unsigned. |

## Hub obligations: V40 disposition

Browser evidence for each row comes from `tests/browser-listening-v39.mjs` (78/0, unchanged; re-run in V40) unless marked V40.

| Obligation | Result |
|---|---|
| Direct entry, hub render, card links, EN desktop | PASS (V39) |
| Completed / in-progress badges from server latest scores | PASS (V39) |
| Draft publication notice; published has none | PASS (V39) |
| Card click to activity; Back and Forward restore both screens | PASS (V39) |
| Direct reload refetches the authorized view | PASS (V39) |
| Keyboard: Tab to Back link then CTA; Enter follows the link | PASS (V39) |
| Touch: tap CTA navigates (390 px touch emulation) | PASS (V39) |
| Cold-entry Back link follows its library href | PASS (V39) |
| Locked 403 `sequence_locked` shows locked section; kind `locked` | PASS (V39) |
| 404 not-found; malformed id never requests data | PASS (V39) |
| 500 region error with Try again; network failure; 429; 403 | PASS (V39) |
| 401 ends the session (authority logout to `/login`) | PASS (V39) |
| Unrecognized view kind is a region error | PASS (V39) |
| Extra transcript field refused; transcript never renders | PASS (V39) |
| Authored kind renders sandboxed frame, `sandbox="allow-scripts"` only | PASS (V39) |
| In-app source switch replaces hub with new test only | PASS (V39) |
| In-flight hub request discarded after navigation (stale response) | PASS (V39) |
| Authored-frame media: authorized load, media init, navigation away, teardown, source replacement, stale callbacks, error handling, session revocation | **NOT VERIFIED in V40 (open)** |
| Hub 768x1024 UZ Day strict visual | FAIL retained; diagnostic re-run in V40 (see visual doc) |

The V40 suite did not add any Hub-only case. Its Hub uses only navigation targets (`hubView`) for the Activity tests.

## Hub 768 UZ Day visual

V40 re-ran `tests/browser-listening-visual-v39-diagnostic.mjs` (controlled fresh-vs-fresh). Results: `docs/evidence/v40/visual-control/hub-diagnostic-v40-rerun.json`. Log: `docs/evidence/v40/logs/visual-hub-768-uz-day-diagnostic-rerun.txt`.

- A native vs native: 0 px. B reference vs reference: 0 px. Both stable.
- C fresh-page native vs reference: 0 px in V40 (2 px, max delta 1 in V39).
- D V37 order: 2 px, max delta 1. Same pixels as V39's C, so the difference moves between runs.
- E structure: 18 vs 18 nodes, no diffs.
- Settle trials (8 fresh renders): 0 of 8 non-zero in V40 (4 of 8 in V39).

The residual is run-to-run nondeterminism of about one channel unit on two pixels. It is not a stable CSS defect. A strict zero-tolerance assertion still cannot pass without a determinism mechanism or an owner decision. Tolerance and palette were not changed. The historical FAIL stays in the record.

## Source coverage

- Original Listening HTML sources: 32 tracked under `content/listening/`. 32 unique blobs, zero changes under `content/` or `src/` since baseline `9a7d9fc`. The only HTML change in the branch since baseline is the app shell `migration/vanilla-frontend/index.html`, from earlier V-series work and not part of V40.
- Tests 10 and 25: blocked by authoritative external data issues. No clamping or regeneration.
- Tests 11 and 22: storage-key discrepancy. Needs source authority; not silently chosen.
- Original inner `← Test hub` link is an untranslated literal in the original component. Preserved; localization is an owner decision.

## Route ledger

`docs/route-ledger-v37.json`: `/app/listening/tests/:id` gained a `v40` key only (`statusChanged: false`). Status is unchanged.

## Remaining Hub blockers (frontend)

1. Authored-frame media browser cases (init, navigation away, teardown, source replacement, stale callbacks, error handling, session revocation).
2. Strict 768 UZ Day visual: a determinism mechanism or owner decision is needed. No tolerance change.

External: live backend, Next.js runtime parity, hardware/Safari audio, Phase2 signature.
