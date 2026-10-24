# V38 Listening Workflow Closure Matrix

Nine workflows from the V38 directive. Statuses are the V37 completion-matrix statuses (`docs/V37_LISTENING_COMPLETION_MATRIX.md`), **not promoted by V38**. Frontend-code-complete labels are historical fixture/source scope and are not production acceptance.

| Workflow | V37 status | V38 status | V38 evidence / change | Still open (exact source work) |
|---|---|---|---|---|
| Full IELTS Test | FRONTEND CODE COMPLETE (historical scope) | FRONTEND CODE COMPLETE (historical scope, unchanged) | Legacy in-progress exam submit now maps 429/network/500 to the correct `en.auth` messages (`browser-listening-v38.mjs` case b). | Comprehensive source/workflow set not closed; authorized live eligibility and original-state visuals not closed. Integration candidate; owner selection pending. |
| Review & Revision | PARTIAL | PARTIAL | No Review code change. Revision V37 attempt-ID fix preserved (`browser-listening-revision-v37.mjs`). | Phase2 A–J release is a BLOCKED owner decision (separate). Implementation of all independently buildable Review branches is not claimed complete in V38; ReviewAuthorityBarrier, ReviewJournal, CheckpointWriter, exact-byte ACK, single-flight, Retry/Adopt are unchanged. |
| Script Completion | PARTIAL | PARTIAL | No Script change. V37 `script-v37.js` decorator preserved. | Source-specific interaction, part changes, saved state, answers, feedback, evidence navigation and lifecycle are still open for the non-blocked sources. Tests 10 and 25 are BLOCKED (external timing; no clamping, guessed timestamps or timestamp edits). Source 8 has no original Script surface. |
| MCQ Mastery | PARTIAL | PARTIAL | `mcq.js` reasoned completion uses replaceState + refresh (no transient heading focus); the discriminating `focusin` assertion is in `browser-listening-v38.mjs` case c. | Live authorized mastery writes and session-expiry behavior UNVERIFIED; original-state visual not closed. |
| Map Mastery | PARTIAL | PARTIAL | None. | Per-source map journeys, `ListeningMap` drag/keyboard parity, and strict visual not closed in V38. |
| Choose TWO Mastery | PARTIAL | PARTIAL | None. | Per-source journeys and strict visual not closed in V38. |
| Completion Mastery | PARTIAL | PARTIAL | None. | Per-source journeys and strict visual not closed in V38. |
| Vocabulary Builder | PARTIAL | PARTIAL | None. | Vocabulary save/lexical policy flows not re-verified in V38 (lexical fresh-permission policy unchanged). |
| Retry Weak Areas | FRONTEND CODE COMPLETE (historical scope) | FRONTEND CODE COMPLETE (historical scope, unchanged) | None. | Live eligibility not verified; no V38 change. |

Notes:
- "Frontend code complete" labels are kept exactly as the V37 matrix states them. V38 does not restate them as production acceptance.
- Workflows that V38 did not implement are reported as open source work, not as partially complete features.
- Staff workflows (`FullListeningLibrary`, `ListeningTestActions`, `ListeningImport`, `ListeningLegacyImport`, `audio-probe`) are excluded.
