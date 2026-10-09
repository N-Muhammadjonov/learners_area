# RIWI Step 09 — lifecycle and canonical task runtime

Base: `98e51799576d288175e2349e913e5ff4506ca1ee`
Target: `arena/01a10bac-learners-area`
Publication: pending user Terminal gates and independent remote blob verification.

## Acceptance scope

- C02: bounded microphone acquisition; late permission cleanup; abort before/after allocation; constructor/start/stop failures; shared repeated Stop; cancellation during Stop; missing-stop deadline; actual bytes/MIME and recording-clock duration. AI recorder and Shadowing now cancel pending acquisition. Practice-on-your-own already supplies cancellation and keeps its recorder reachable during Stop.
- C03: microphone check requires measured nonzero energy, resumes its AudioContext, releases analyser/tracks/deadlines, and permits manual editable transcript review when browser recognition is absent. Browser recognition remains optional; no acoustic pronunciation claim.
- C04: persisted server-canonical plan, order-independent seeded selection, related Part 2/3 when available, explicit shortage/unrelated limitations, immutable historical plans, owned refresh/resume and transactional current-item progression with matching replay idempotency. New plans are version 2.
- B02: Reading canonical authored codes and Listening canonical package selection counts determine objective contract/version/rubric evidence before any submission write. Unsupported metadata refuses safely. Official deterministic grading, deadline drafts and row locking remain authoritative.
- C01: step 08 asynchronous transcript finalization plus this batch's pending recorder-stop unmount fix complete the code-level lifecycle acceptance; remote closure remains pending this publication.

## Additional repair, not a closed group

C05 feedback was disappearing because the parent changed the recorder React key after evaluation. The key now remains the persisted item ID; a transport-stubbed actual React journey verifies Stop -> editable review -> explicit Send -> retained feedback -> Next. Concurrent create/advance clicks are guarded. C05 remains PARTIAL: live provider timeout/retry and the full authenticated browser journey are not established here.

## Evidence

Regression tests reproduced failures against the base for recorder lifecycle, permission consumer cleanup, plan selection and disappearing feedback before the repair. New PostgreSQL-compatible PGlite tests execute canonical migrations and production write functions, including owned item binding, conflicting replay, completed-session replay, empty banks, all 14 Reading subtypes, late Reading draft precedence, unsupported metadata zero writes and Listening choose-TWO swapped order. Their authored fixtures are not the original bank acceptance.

- Full UI suite: 248 passed, 0 failed, 0 skipped.
- Focused backend gate: 52 passed, 0 failed, 1 skipped (original Reading source absent).
- Core gate: 21 passed, 0 failed, 0 skipped.
- Reading stabilization after transaction extraction: 6 passed, 0 failed.
- Final full backend, typecheck, lint and production build: see `RIWI-STEP-09-QA-RESULTS.json`.

Three network-socket tests cannot bind 127.0.0.1 in the restricted execution environment (EPERM). They stay enabled and are mandatory in the user Terminal script before commit/push. Original-source, native PostgreSQL, live provider, real microphone/browser, R2 and deployment evidence remains open under R05/R06/C08/C09 and the applicable operational groups; no skip is promoted to PASS.

## Progress accounting

34 equal-weight original groups form the remaining-prompt denominator. Previously verified fully closed groups: B07 and D01, 2/34 = 5.88%. Step 08 fixed the STT portion of C01; pending Stop cleanup is included in this batch, so C01 was not prematurely given full credit. Four new groups B02/C02/C03/C04 account for 11.76 percentage points; completion of C01 adds 2.94. All five are QA-ready, pending mandatory native gates and remote publication verification. Conditional verified total after those gates: 7/34 = 20.59%. Full RIWI/project percentages remain unknown without their reconciled denominators.

## Publication and rollback

The supplied script checks clean native clone HEAD, branch and current remote SHA before applying the exact staged patch. It runs all backend/UI/type/lint/build gates, commits, then pushes the explicit RIWI branch. Any failure stops publication. No force push, reset or cross-branch merge. Expected changed Git blobs are supplied separately for independent verification. Rollback, if later authorized, is a reviewed revert of this isolated commit rather than rewriting shared history.
