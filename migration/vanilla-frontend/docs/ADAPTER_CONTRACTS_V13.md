# V13 adapter contracts — extends V12, no new HTTP endpoints

All ADAPTER_CONTRACTS_V12 invariants retained. Existing GET/PUT authored-state
accepts record<string,string>,100KiB total; source-state server schema passthrough
is read-only confirmed. New la-original-exam-v13 value has ONLY attemptKey,
question1..40, reviewDeadline finite positive (up to current time+120s when read).
It is a UI resume hint, NOT server timing/authorization proof. Different attempts
ignore it; no new session/token, protected content, grading or progress is cached.

Original storage, answers, flags, canonical results and outbox remain existing
scope/session/test partitioned contracts. Expected attempt identity is now checked
for in-progress as well as submitted/exited ACK. Parent still requires exact40
unique typed canonical result rows before closing an exam. In-frame study and
new-attempt blocking remain pending until matching canonical ACK. Server retains
all identity/role/status/sequence/ownership/grading/reveal authority. Aborting a
request cannot roll back an already committed write; no idempotency guarantee.

Parent exam dictionary lock starts before hydration, tracks in_progress drafts,
and releases only matching canonical latest ACK. In-flight lookup checks lock again
before painting. No API is invented/deployed; /api/frontend projections remain
proposed/disconnected503. CSP and opaque sandbox allow-scripts ONLY unchanged.

Final-review silence is implemented by intentionally suppressing ONLY the original
startExam playback call on that resume path; native/parent media state is not
fabricated. Existing media controllers, authorized parent audio and source windows
are reused. Playback position/duration/provider policy remain their V12 contracts.
Session notes remain source sessionStorage-only. Deadline UX is not anti-tamper or
cross-device latest-writer enforcement. Universal media and production remain open.

Staff35 routes and reserved author desk untouched; future reconciliation manual
against latest V13, not older V4. Owner single-HTML validation/extract/privateR2/
register/preview/explicitpublish and Reading AI-assisted imports deferred.
