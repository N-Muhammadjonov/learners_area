# V16 — Review continuation, PARTIAL (no Script advancement)

Exact V15 baseline8f498ce914bfa7b30866ce592e00379a701bda88. Initial branch/local/remote
verified equal; working tree clean. No stale359 reconciliation was needed. Same fixed
arena/96836bcf-learners-area only; no reset/rebase/stash/clean/switch/force/discard.
All implementation paths migration/vanilla-frontend; original source read-only.
V1–V15 ZIPs byte-verified against exact V15 Git blobs; pins in evidence/v16.

## Executed engineering, not a new engine

Retain original-review-v15.js, original source renderer, self-study answerOk, authored
HTML/media bridge, V14 CheckpointWriter and V15 canonical/conflict/recovery protections.
V16 wraps source renderTrainer only for an already-live SAME Review part/bounds.
Check no longer destroys its trainer, pauses audio, seeks to part start or resets
speed. Part switch still uses source cleanup; reentry rebuilds a cleaned trainer.
Detached evidence clip controls are stopped, never retained after redraw.

Native source feedback/answer/transcript/part/question/clip shapes fail visibly before
rendering malformed material. No new verdict or explanation function. Full authentic
runtime transcript is offered only after the original Review Check, for all4 parts.
Text is never shortened, generated or persisted as learner data. Evidence highlights
ONLY a unique verbatim source substring; absent/ambiguous wording is explicitly
unmatched and directs learners to the existing authored clip. No invented alignment.
Question navigation, keyboard selection, transcript Escape/focus, original tab labels,
checked/retry state, own revisions and reload restoration are retained/extended.

Review course /progress uses another instance of the EXISTING transport class, not
an exam engine or unsupported Review /practice kind. One active write, merged latest
own work across parts, typed server progress, no automatic mutation retries, explicit
safe retry and part-scoped state. An older active failure is directed to the newest
queued part so it cannot remain stuck Saving. Server course status alone changes
completion; local Review checking is self-study, never exam grading or course success.
401 uses existing global logout;403/404 tear down; other errors preserve revisions.
Scope abort suppresses late updates but may NOT roll back already committed writes.

## Honesty gate

Review FRONTEND PARTIAL. Ordinary work still remains: authorized selected-word popup
and keyboard/focus/dismissal lifecycle; durable pending course work across reload;
complete Review-specific authority/SSE/reentry/media/foreign feedback/error contracts.
The new transport is session-owned; it does NOT promise a durable course outbox.
Native confirmed revision inputs/checked state remain in the existing checkpoint.
Do not mistake passing focused slices for complete Review. Script NOT advanced.
Full IELTS and Retry retain V15 supported CODE COMPLETE; frontend2/9,7partial;
comprehensive original0/9, live0/9. Reading NOT STARTED. Staff35 untouched.

Expected inventory428 units,499 Chromium,126 actual-source journeys (99 preserved
+27 V16). Expected counts are NOT execution proof: deliverables/V16_VALIDATION.txt
records independent final ZIP install/build/actual counts/assets/CSS/two repacks/SHA.
Initial failures retained: CSP disallowed waitForFunction eval (fixed harness uses
in-page RAF without CSP weakening);401 expected a local Retry although correct
behavior is /login; trainer wrapper shadowed source trainer state; queued-part failure
reported to the obsolete part (old-build reproduction and repaired probe retained).

Synthetic encoded Range MP3 is NOT private recording alignment/provider/Safari/
hardware acceptance.256KiB/8MiB LRU/two transports retained; Blob NOT progressive.
Opaque sandbox allow-scripts ONLY; no allow-same-origin/CSP weakening/private material
bundle. No local auth, browser exam grader, secret/session storage or backend changes.
Cross-device/noncooperating GET→PUT race still lacks backend CAS; Web Locks are only
cooperative. Source/CSS identity is NOT matched rendered parity. No production/live
acceptance, merge or deployment. Runtime/dev audits recorded in final report.

Metrics remain objective inventories:22/15/71 routes of108;62/17/127 components of206;
Listening9/6/1 routes of16 and9/10/5 components of24. No fabricated weighted overall,
functional/security or visual/live percentage; aggregates UNDETERMINED.1–100ms target
is not a latency guarantee. Owner approval needed before production replacement.

First extracted ZIP source run124PASS/2FAIL retained in evidence/v16/independent-first.
Transcript navigation controls now sit outside original evidence-clip controls,
preserving the exact40 original playWindow argument assertions. The encoded native
resume probe exposed a queued-seek/first-playing race: OwnedMediaController now
waits for the previous seek and native seek completion before play, with version,
abort and timeout guards. Original media engine is not rewritten. Initial extra
temporary-listener accounting failure is retained; the no-seek fast path preserves
the existing exact18-listener assertion without weakening it. Both repaired source
probes passed. Final fresh archive full-suite counts, not these probes, govern delivery.
