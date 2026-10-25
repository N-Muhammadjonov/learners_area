# V18 — resumable Review authority/lifecycle checkpoint; NOT Review completion

Exact verified V17 continuation: 1d224600a0b3e5f599718234f5cf5b5f8de805f0.
Only accepted V17 ZIP: FINAL_VERIFIED, SHA da255c7c47aac05a5624c97483454817f755c6acc57f50546560dbecf4c7389d.
Clean same branch/local=remote verified before edits. No stale checkout, backup/FF/reset
needed. Branch arena/96836bcf-learners-area only. All19 historical ZIPs pinned unchanged.
Latest remote main observed cd96165; read-only, no production-deployment assertion.

## Actual implementation (existing controllers retained)
- Review progress transport now fresh-reads canonical submitted own attempt BEFORE
  POST and AFTER response, rejecting changed/active attempts before accepting an ACK.
  This is NOT atomic cross-device CAS. A rejected late response may have committed.
- Original Review part/activity view changes invalidate the visible UI epoch while preserving the SAME single-flight writer
  and pending journal. Route/reload/session disposal aborts the owned transport.
  Reentry does NOT replay. New explicit Check/recovery uses the existing serializer.
- Disposed writer removes its shared abort listener; repeated part changes do not
  accumulate retired writer listeners. Existing exam barriers/coalescing unchanged.
- Journal ACK explicitly succeeds only for exact current pending body. Storage reads
  no longer hide externally updated durable records behind stale memory. Failed
  persistence uses marked owned-memory fallback with visible warning.
- Conflicting work may be explicitly retained in one bounded separate slot. Exact
  bytes are verified before removing the matching active record. Existing retained
  work is never overwritten. Answers remain visible after reload; no auto-mutation.
- Stored intent accepts only own identifiers/part/answers, no extra credential,
  transcript/feedback/key fields. Malformed/foreign data is retained, not trusted.
- Progress envelopes reject foreign/unknown identity fields and inconsistent flags.
  Foreign canonical exam-storage keys fail closed while legitimate same-course
  practice/note keys remain supported. No new server payload/endpoint introduced.
- Invalid new noncollapsed selection clears the prior cached lexical term; valid
  cross-DOM original text keeps exact spelling/identity. All native modes retain V17
  server permission preflight, unresolved presentation and active-exam restrictions.
- Long retained own answers wrap at mobile bounds. Retain action is attached ONLY
  after conflict, not hidden via an attribute overridden by existing button CSS.
  Source CSS unchanged; compiled CSS adds only pre-wrap/overflow-wrap utilities.

## Executed targeted scope / historical evidence
13 additional units (456 total expected),47 additional actual-source journeys
(196 full expected =149 preserved +47). These are counts, NOT a completion gate.
New cases: eight progress failures/malformed/foreign envelopes; four held operation
exits; SSE progress/lookup revocation+media cleanup; before/after foreign attempts;
old intent retention; external same-context journal changes; quota/disabled storage;
403/404/503/decoder Review media retry; missing/duplicate/malformed/foreign load;
three forged active-exam lexical/course modes; invalid/cross-DOM selection; and
12 keyboard recovery/wrapping viewport×locale×theme conditions.
Final exact-ZIP executed output, not these expected counts, is authoritative.

Retained initial failures:7 unit failures; first23PASS/1FAIL wrong fixture retry label;
foreign-key fence initially overreached practice keys (repaired to exam-key pattern,
added regression preserving own practice/notes); next32PASS/1FAIL early reload iframe
assertion (added causal hub-ready/recovery wait, assertion unchanged);33PASS/12FAIL
exposed genuinely visible hidden retention action (attach only on conflict). Invalid
selection probe failed false!==true; fixed cache clearing, not assertion weakening.
All raw before/after evidence retained in docs/evidence/v18. No historical assertion
removed, filtered out of the full run, or weakened.

## Completion gate NOT passed / exact ordinary work still open
Review FRONTEND PARTIAL; fixture verification limited to executed cases. Original
behavior PARTIAL, live UNVERIFIED. Full+Retry supported frontend COMPLETE unchanged.
Script PARTIAL/not advanced. Reading NOT STARTED. No expansion of later activities.
- Closed-tab pending work is still context-scoped: discovery/adoption/reconciliation
  from a DIFFERENT browsing context is NOT implemented. Same-context reload/reentry
  and explicit bounded conflict retention are supported; never silently claim more.
- Full held-LOADING/evidence/transcript revocation permutations, real two-tab Review
  overlap/retake/direct-URL/rapid Back+Forward acceptance still need dedicated closure.
- Legacy pre-canonical submitted records without a valid server attempt identity are
  not granted inferred authority. Current checkpoint schema must normalize such
  records server-side or an explicit supported adapter contract must be established.
- Full keyboard/focus/lifecycle acceptance beyond the executed matrix remains open,
  including cross-context recovery controls. These are ordinary frontend gates,
  NOT excuses attributed to unavailable production credentials. Do not advance Script.

## External boundaries (not frontend certifications)
Direct authored?vocabulary=1 route lexical-exam policy must be reviewed by the
separate authorized backend GPT Work task: account/sequence checks are not proof of
an atomic server exam-policy check on enrichment; include current/other-tab active
attempts, held reads, lookup/save enforcement, revocation and authorized regressions.
NO unauthorized live probes or backend/Dictionary edits performed here.
No cross-device CAS/exactly-once/cancel-rollback guarantee. Partial numeric progress
is not a per-question receipt. Server completion only; self-study is not exam grading.
Opaque sandbox allow-scripts ONLY; CSP unchanged.256KiB Range/8MiB LRU/two transports,
MSE cleanup/deadlines/audio-after-paint preserved. Blob fallback NON-PROGRESSIVE.
No private URLs/credentials in child. Synthetic silence != original recording/codec
acceptance. No Safari/hardware/live/visual-parity claim; no production change/deploy.

## Inventory / metrics
Global routes22 COMPLETE/15 PARTIAL/71 NOT STARTED of108; components62/17/127 of206.
Listening routes9/6/1 of16; components9/10/5 of24.35 staff routes reserved untouched.
2/9 frontend complete,7 partial; comprehensive original0/9; live0/9. No promotions.
Three metrics implementation / functional-security / visual-live: UNDETERMINED.
V17 synthetic navigation median110.15ms,4/10 within1–100ms: target NOT achieved.
V18 diagnostic, if executed, reported separately; no production/baseline guarantee.
Current-main Tests2–32/catalogue/sequence/publication/MCQ recordings and Reading
PR48–51/Retention differences remain separate integration gaps; no data import.

Owner workflow deferred: one HTML -> validate -> extract audio -> private R2 ->
register material/original activities/transcript mappings -> preview -> explicit Owner
publish. Reading imports Owner-supervised with AI assistance. No backend/cloud work.

## First independent candidate NON-DELIVERY / additional actual repairs
Initial sealed V18 (1f3da8c...e64eebb), ca1c053, retained byte-for-byte outside
checkout +Git history; not delivery. Chromium first suite26PASS1FAIL then wrapper
stopped; source191PASS3FAIL (all194 executed). Full raw evidence retained here.
Two preserved V16 tests caught overlapping requests from part-scope writer disposal.
Repair: keep ONE writer/single-flight/coalescing/error/manual-retry, use UI epoch to
ignore old ACK after a view change (retaining pending bytes); only outer disposal
aborts. Both ORIGINAL held/queued-failure assertions pass unchanged. New unavailable
Review response rejects authorization rather than acknowledging success.
A deterministic rapid notes/Escape probe reproduced question-focus timer stealing
focus. Opening a modal now cancels obsolete question-focus timers; no exam engine
rewrite. New probe +preserved V13 keyboard containment pass unchanged.
Read-only actual courseStatus confirms unavailable zero-unit activities can be
complete OR incomplete depending on exam work. Validator now respects that contract,
rejects contradictory global completion over known partial Review;2 added units
failed before then pass. This is not narrowing server permissions from client counts.
Original smoke locale test could read the already-English label while preference
refresh still owned the form. Wait before click response +old form detachment; all
existing login/locale assertions retained. Playwright waitForFunction(handle) hit CSP;
replaced with element hidden/detached wait, no CSP weakening. Smoke27/27 pass.
Historical generated evidence overwritten by direct focused tools was independently
copied/hashed outside checkout, then ONLY historical evidence bytes restored exactly
from current HEAD. No older source/engine restored. Active V18 evidence is separate.
Final exact-ZIP rerun, not earlier targeted proof, remains required/delivery authority.
