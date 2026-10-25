# V14 — exact V13 continuation; Full IELTS remains PARTIAL

Verified entry d6ed38b9d01d62d8addd8b656a41451e9842d5f4 on existing
arena/96836bcf-learners-area, clean local=remote. No reset/rebase/stash/clean/branch
switch/restart/reconciliation. All edits migration/vanilla-frontend ONLY.
V1–V13 archives immutable; staff35 routes/backend/database/cloud/main untouched.

## Implemented coherent Full IELTS checkpoint recovery

Existing exam HTML/engine/V13 controls/timer/focus/notes and V12 Retry/media reused.
checkpoint-v14.js is a transport coordinator, NOT a replacement exam engine.
One active checkpoint transport, newest queued own snapshot and ONE start barrier.
Old intermediate edits coalesce, but in_progress for a new identity is never
coalesced away before submit/exit. Failed starts remain retryable before closing.
Superseded ACKs cannot overwrite newer UI/own answers or clear its recovery outbox.
Identical saved bodies do not duplicate requests; edit-then-undo during a held save
still sends the authoritative newest undo. Failed writes invalidate server-known
fingerprints because a write may already have committed. No rollback/idempotency
or cross-device latest-writer guarantee is claimed.

No automatic checkpoint mutation retries. After failure, newest edits remain
buffered; explicit Retry sends latest once, duplicate clicks while active do not
queue transports.401/403/404 suspend and remove the inaccessible frame, stop media,
clear owned URLs and retain own draft; fresh authorized remount required.409/429/
5xx/network/25s timeout/malformed/duplicate/foreign replies fail closed with visible
EN/UZ details, not a generic success. No invented Retry-After contract;429 tells the
learner to wait, server rate limits remain authoritative. Existing progress/retry
engines and their distinct transports are NOT rewritten.

Native checkpoint ACK now updates the iframe's in-memory storage WITHOUT echoing a
mutation. New source checkpoint notice freezes submitted/exit controls, restores
canonical own answers, reconciles a server-closed active attempt, cancels timer/
audio, and retains V11 grade/result gating. A submitted/exited mutation cannot be
acknowledged by an open or different closed transition. Expected identity/status
checks augment existing exact40 unique typed canonical rows; no browser grading.
The retry control reuses existing token/frame-bound storage protocol with retryOnly,
not a new permission or weakened sandbox allowlist. Only native persistence handles it.

Own start intent records attemptKey/previous authoritative key under scoped :start.
On reload, a missing start may be replayed before the pending close ONLY when the
fresh authoritative checkpoint still matches that known predecessor; changed active
identity is409, never silently overwritten. This is a client recovery hint, NOT
server auth proof; every GET/PUT still requires existing server policy. No new API.
Local storage failure warns; a bounded three-key memory fallback keeps own draft
through authorized remount in the same route. Confirmed server draft survives
reload. Unconfirmed memory-only drafts cannot survive tab close/reload when browser
storage is unavailable: warning is explicit, no durability is fabricated.

## Gate and exact scope

Full IELTS FRONTEND PARTIAL; documented fixture/source paths verified only to
executed extent below; comprehensive original behavior PARTIAL; live UNVERIFIED.
No whole-activity/route/component promotion. Original frontend1/9 (V12 supported
Retry leaf),8partial. Comprehensive original0/9; live0/9. Review V14 NOT STARTED.

Remaining independently executable Full client acceptance: repeated rapid-route/
reentry/cross-tab conflicts, SSE revocation during held start/close, encoded
full-exam audio fault/early-end/position permutations, highlight/fullscreen and
complete accessibility/lifecycle sweep. Actual recording/provider/device/backend
acceptance is a SEPARATE UNVERIFIED gate, not an excuse to call those client checks
complete. Continue Full first, THEN Review, then remaining ordered activities.

Manifests378units (all363 preserved+15new),499 Chromium preserved,64 opt-in actual
source (all43 preserved+21new). V14 source cases exercise actual source controls,
all listed save failures, autosave, delayed canonical freeze, missing start/reload,
quota warning, server-closed reconciliation, pending exit/retake, BackForward route
cleanup and realistic SOURCE-defined full-length timer using SIMULATED wall time.
Authorized source review DOM's four trainer windows and40 evidence-button arguments
are compared to its definitions. This is NOT private recording alignment proof.
V13 all40/three viewport/EN-UZ/daynight journeys preserved. Actual read-only source
corpus/audio/keys/transcripts never copied into ZIP.

Initial targeted18:7PASS11FAIL retained. Nine manual retries exposed a NEW protocol
integration bug (unallowlisted custom retry op); fixed by reusing token-bound storage
retryOnly. Two access tests tried to enter a frame intentionally removed on403/404;
assert no-frame/no-score instead, retaining the restriction. New tests/harness only;
no old assertion weakened. Subsequent18/20 targeted passes are explicitly different
snapshots; final independent exact-ZIP execution is authority in external
V14_VALIDATION.txt and v14-independent/summary.json. No first-pass success invention.

Global routes22/15/71 of108, components62/17/127 of206. Listening9/6/1 of16 routes,
9/10/5 of24 components.35 staff canonical routes reserved (23Admin/6Owner/6Teacher);
staff-only author may stay NOT STARTED. Learner Listening remains partial separately.
Reading NOT STARTED. Owner HTML→validate/extract→privateR2→register→preview→explicit
publish and Owner-supervised AI Reading imports remain DEFERRED; no cloud work.

Universal media PARTIAL, existing256KiB/8MiBLRU/two reads/quota/decoder/deadline/cleanup
preserved. Stable early duration/indexed seek/proactive decoded/aggregate Blob bounds/
long sessions/all callers/provider/Safari/hardware open. Blob fallback NOT progressive.
Sandbox allow-scripts ONLY, CSP unchanged; no private URLs/keys/credentials to child.
No new matched-original rendered/live acceptance or guaranteed1–100ms claim.
Implementation/functional-security/visual-live aggregate metrics UNDETERMINED;
objective source counts and executable fixture ratios are separate. Production NONE.
