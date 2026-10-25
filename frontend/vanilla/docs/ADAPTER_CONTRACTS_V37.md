# V37 Listening consumer contracts

Baseline **62076acc0178602c0bd87025f5c542510242bc1e**, same Arena branch. Listening supersedes course video/Grammar priority. **This is not whole-Listening completion or release approval.** No main merge, deployment, new backend, Staff implementation, educational reconstruction or ZIP. Human project owner authorizes implementation; separate unsigned Phase2 A–J release decision remains BLOCKED and does not block frontend work.

Historical counts are preserved, not silently relabeled: 16 canonical Listening routes = **9 CODE COMPLETE / 6 IN PROGRESS / 1 Staff NOT STARTED**. Target = 15 learner routes; historical frontend-code-complete count remains **9/15**, not 15/15 or 16/16. Full accepted/parity status is not established; do not confuse this historical code count with strict original/live acceptance. 24 components = **9 CODE COMPLETE / 10 IN PROGRESS / 5 NOT STARTED**. Global108 routes22/18/68;206components62/19/125;35 Staff routes reserved. CODE COMPLETE is historical frontend/fixture scope, not accepted production or comprehensive original parity.

## Existing boundaries only
Read the inherited ADAPTER_CONTRACTS_V7–V10 and V14–V33 contracts. The `/api/frontend/view?route=<pathname+query>` version1 exact-route envelope remains a **proposed presentation projection**, not a deployed endpoint claim. Six existing consumers retain their discriminants and validate matching test/attempt identity: attempt section/exam/legacy-exam/review/redirect, own completed revision, activity1–5/matching/completion/map/retry, authored/hub, MCQ summaries and accessible day. Server remains responsible for session, own attempt, classification, publication, locks and answer redaction.

Existing mutations: `/api/listening/full/:id/start`, `/api/listening/attempts`, attempt draft/submit, full activity/study/practice, MCQ POST/PATCH, authored-state GET/PUT, course progress and vocabulary APIs unchanged. No new endpoint, body field, client grading engine or optimistic credit. Existing source-local practice feedback is retained; it is NOT a server progress receipt.

## V37 presentation-only changes
`#script/part/1` through`/4` is interface location, never authorization or canonical attempt. Bare`#script` normalizes to part1. Script question suffixes, zero/out-of-range parts refused. Source-specific `#matching` now uses the same location grammar rather than falling outside history restoration. It does not invent Matching or add an extra canonical workflow to Test1’s nine. Existing `reviewLocation/reviewHash/reviewNavigationBridge` owner now reports/applies supported Script parts using original `[data-spart]` buttons. On initial authorized hydration, non-Review requested locations are applied by the same existing location owner. Review still exclusively uses its fresh authority barrier, journal, source/document/epoch/sequence fences and original action grants. No second route/history controller.

Script decoration wraps existing renderScript, adds tab semantics, keyboard Home/End/left/right, gap names/described-by, max4000 matching course-work bounds and live score role. Existing render/check/retry/media/persistence functions remain owners. No material, answers, keys, timings or recordings in the new module. Source-local feedback must not be represented as server grade/progress acceptance.

Revision SpeedTrainer receives `attempt.id`, exactly as original revision page, rather than `test.id`. Spelling-only text still does not fabricate contextual lookup or dictionary meaning: focused browser proof verifies explicit vocabulary request scope and needs_definition response, no lookup request. This repair does not alter server vocabulary policy.

## Source-specific controls
Tests11/12 use original checkScript/retryScript IDs (not Test1 checkScriptPart/retryGaps); the decorator includes both source IDs. Test8 has no Script surface and does have Matching. Its absent Script destination is safely normalized to Hub; no new activity/content/control is fabricated. Initial read-only source sweep 27PASS/3FAIL/2BLOCKED retained (script-source-matrix.json). Final sweep after the source8/11/12 repairs: **30 PASS / 2 BLOCKED** (final-script-source-matrix.json); blocked = Tests 10 and 25 authoritative mapping defects, not skipped.

## Back focus
The existing child click/location bridge restores the Hub button for the activity just left (including Script/Matching); Review-to-Hub still returns to Review. No second focus manager, route writer or new authorization source.

## Integrity and media
ReviewAuthorityBarrier/ReviewJournal/CheckpointWriter unchanged. Exact-own ACK, pending bytes, one-flight, fresh Check/Retry, explicit Retry/Adopt, no uncertain replay and foreign isolation retained. No aggregate ACK, CAS/exactly-once/cross-device lock/abort rollback claim. 256KiB Range,8MiB LRU,max2 transports,MSE/Blob fallback and original audio owners unchanged. Opaque allow-scripts only, original CSP, no credentials/private URLs in child, no private audio copied. Safari hardware/real audio/live integration remain UNVERIFIED.

