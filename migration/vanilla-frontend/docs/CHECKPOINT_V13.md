# V13 — exact V12 continuation; Listening remains PARTIAL

Baseline 8ffbb39a8d1187bf9b0a4ce7a75cfec2a980aa97, existing branch
arena/96836bcf-learners-area. Initial checkout clean, local=remote; NO reset,
stash, restore, reconciliation or foundation restart. V1–V12 archives immutable.
All edits confined to migration/vanilla-frontend/. No staff/backend/DB/cloud/main
or production changes. Deferred Owner HTML/private-R2/import/publish untouched.

## Work performed: Full IELTS Test ONLY

Existing original source, parent transport, server grader, V11 canonical-result
policy, V12 Retry and media reused. original-exam-v13.js adds own attempt-scoped
question/deadline recovery; no answers/material/keys/verdicts in the new UI draft.
Resume returns to the actual question/part. Final review resumes its original
absolute two-minute deadline, silently (no brief recording restart), and expires
once rather than granting another120s. Listening uses elapsed wall time, carrying
late callback excess into final review; offline listening retains the original
source audio-position resume behavior. This is client UX timing, NOT a new server
duration/anti-tamper enforcement claim. Actual recording duration stays source-led.

Start button is explicitly rebound: original buildActivities stored the OLD
function reference before wrapper installation. Unit harness now models that
reference binding; real-source tests caught the integration defect. No test was
relaxed. Raw initial13 failures (12 reload + final-review) retained. Second run
15PASS/1FAIL caught test observation ordering: request event occurred before route
handler counted it. Awaiting RESPONSE fixes the fixture observation; identical
reads===1 assertion retained. Fresh extracted acceptance is reported separately.

Question focus and native labels/current/answered/flagged semantics follow source
navigation; text accepts existing500-character API limit. Paired control changes
restore the other original control after duplicate removal. Source modal/notes
retain native rendering with Tab containment/Escape cancel/focus return. Notes
remain session-only by original design, not silently made persistent. Duplicate
start/submit, retake during pending exit, and delayed audio-start after disposal
are guarded. Page exit stops the source exam timer/audio.

Parent dictionary selection is explicitly blocked before hydration, during an
active exam, and during pending submission until canonical ACK. Late lookup cannot
paint a popup after exam starts. In-progress ACK must match expected attempt key,
not only closed ACKs. No server authorization/grading/publication is replaced.

## Honest activity gate

Full IELTS Test FRONTEND PARTIAL; fixture verified ONLY for documented paths.
Original behavioral evidence PARTIAL (actual read-only HTML, isolated APIs/media),
LIVE UNVERIFIED. Comprehensive original0/9; live0/9. Retry supported frontend leaf
remains1/9 CODE COMPLETE; other8 PARTIAL. No V13 full-activity closure claimed.
Review & Revision NOT started for V13; do NOT advance ahead of Full IELTS.

Remaining Full IELTS: complete timeout/status/conflict/revocation/retake/race and
rapid navigation/reentry matrix with real recording/end/seek/transcript alignment;
long actual-duration and device/activation/provider acceptance. Existing V11–V12
outbox/malformed/foreign/error/source tests preserved, not mislabelled new complete
coverage. Then proceed Review & Revision, Script, MCQ, Map, Choose TWO, Completion,
Vocabulary in that order, preserving Retry. No parallel partial activity engines.

## Validation / exact accounting

Manifest:363 units (all351 V12+12 V13),499 preserved Chromium,43 opt-in actual-source
cases (all27 V12+16 V13). Executed results, independent extraction, SHA and exact
repack proofs: deliverables/V13_VALIDATION.txt and v13-independent/summary.json.
No matched-original rendered visual acceptance or live acceptance is inferred from
viewport/locale/theme interactions. No guaranteed1–100ms claim.

Routes22 COMPLETE/15 PARTIAL/71 NOT STARTED of108; components62/17/127 of206.
Listening routes9/6/1 of16, components9/10/5 of24. No promotions.35 staff routes
(23 Admin/6 Owner/6 Teacher) reserved; staff-only lesson author may remain NOT
STARTED. Learner scope is reported separately; no learner author permissions.
Reading NOT STARTED; active learner Listening gate remains open.

Universal media STILL PARTIAL: unchanged V12 hub-before-audio,256KiB authenticated
Range, global8MiB encoded LRU/two reads/15s body deadlines, quota/decoder recovery,
explicit non-progressive Blob fallback and cleanup. Stable pre-acquisition duration,
indexed seek/proactive decoded/aggregate Blob bounds, long encoded sessions/all
callers/provider/Safari/hardware acceptance remain open. New timer is NOT a claim
that universal media is solved. sandbox allow-scripts ONLY/CSP unchanged; no private
URL/keys/credentials enter child; actual corpus/audio/keys/transcripts never ZIPped.

Metrics: implementation aggregate UNDETERMINED (no weighted denominator); functional/
security aggregate UNDETERMINED (bounded executable tests, not product coverage);
visual/live aggregate UNDETERMINED (0 matched original-rendered/0 live acceptances).
Production replacement requires Owner approval; no merge/deploy performed.
