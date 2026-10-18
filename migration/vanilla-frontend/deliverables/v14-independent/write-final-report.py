from pathlib import Path
import json,hashlib
out=Path(__file__).resolve().parent;base=out.parents[1];j=json.loads((out/'summary.json').read_text());assert j['status']=='PASS'
text=f'''V14 — EXACT V13 CONTINUATION / RESUMABLE PARTIAL CHECKPOINT

Verified baseline: {j['baseline']}
Branch: arena/96836bcf-learners-area ONLY.
Source ZIP commit: {j['sourcePackageCommit']}
Final local/remote SHA and clean tree checked after delivery commit; see Git.
No reset/rebase/stash/clean/switch/restart/force push/merge/deploy.
All edits migration/vanilla-frontend ONLY; source/staff/backend read-only.

IMPLEMENTED — FULL IELTS ONLY, EXISTING ENGINE RETAINED
Single-flight/coalesced checkpoint transport with required in_progress start barrier;
no automatic mutation retries. Failed writes latch, edits buffered, explicit retry
sends latest once; duplicate clicks do not queue extra transports. Old ACK cannot
replace newest draft. Edit-then-undo persists after a held save; failed transport
invalidates server-known fingerprint. Already-saved identical body creates no false
pending outbox. Cancellation cannot undo a server commit; no idempotency guarantee.
Own missing-start intent includes attemptKey/previous authoritative key. Fresh GET
precedes replay: only unchanged predecessor permits start then close; foreign active
identity409, never silently overwritten. No new backend endpoint/permission.
401/403/404 stop inaccessible frame/media/owned URLs and require authorized remount;
409/429/5xx/network/timeout/malformed/duplicate/foreign/open-as-close ACK show accurate
EN/UZ details and retain own draft.429 tells user to wait; backend still rate-limits.
Existing token-bound storage retryOnly used, no sandbox allowlist weakening.
Canonical source memory storage hydration does not echo a write. Submitted/exit
inputs freeze while pending and after results; canonical own answers restored;
server-closed open attempts reconcile/stop timer/audio from server verdict only.
Local quota/security failure warns. Same-route bounded3-key own memory fallback
survives authorized remount, clears on outer route abort. Confirmed server draft
reloads. Unconfirmed memory-only draft cannot survive reload/close if browser
storage is unavailable; this limit is explicitly warned, not hidden.
V13 exam timer/question/focus/notes/dictionary/canonical grading gates and V12 Retry
and media preserved. No replacement exam engine, new framework or browser grader.

ACTIVITY GATES (FRONTEND / FIXTURE / ORIGINAL / LIVE independently)
Full IELTS Test: PARTIAL / documented V14 subset VERIFIED / PARTIAL / UNVERIFIED.
Review & Revision: PARTIAL / inherited focused subset / PARTIAL / UNVERIFIED.
V14 Review completion implementation/pass NOT started ahead of Full gate.
Script/MCQ/actualMap/ChooseTWO/Completion/Vocabulary: unchanged PARTIAL.
Retry Weak Areas: supported V12 frontend leaf CODE COMPLETE / preserved VERIFIED /
PARTIAL comprehensive original / UNVERIFIED live.
FRONTEND COMPLETE1/9, PARTIAL8/9; COMPREHENSIVE ORIGINAL VERIFIED0/9; LIVE ACCEPTED0/9.
No activity/route/component promotions merely from new test count.

FRESH INDEPENDENT EXACT-ZIP VALIDATION
Fresh extraction/CRC/all836 source hashes PASS; npm ci --ignore-scripts PASS;
build without original source tree PASS.
Unit378 PASS/0FAIL/0SKIP/0CANCEL: all363 V13+15 new.
Chromium499 PASS/0FAIL/0SKIP: complete unfiltered strict preserved regression.
Original-source64 PASS/0FAIL/0SKIP: all43 V13+21 new, unfiltered; authorized read-only
HTML/adaptation with isolated controlled APIs/encoded media, NOT live acceptance.
Source SHA unchanged: f33c621a737ea75215f62d2aacbfde49350d44ade6cd3dacbaebf8675c8c601e.
Inherited all40 native control/flag/note/navigation/reload journeys cover1440x900,
768x1024,390x844,EN/UZ,day/night. New21 include12 failures plus9 recovery/lifecycle/
source-mapping paths, held submit/exit/autosave, start-before-close replay, quota,
canonical freezing, BackForward and full SOURCE-defined clock via simulated elapsed
time. Four actual trainer and40 actual authorized evidence-button timestamp
arguments compared to original definitions. Not private recording alignment proof.
Real recording/full-duration physical playback/provider/device/backend UNVERIFIED;
protected corpus/audio/keys/transcripts NOT in ZIP. No fake scores in production;
known fixture verdicts are isolated API responses, not runtime fallback grades.
Assets25 PASS; source CSS exact; compiled CSS deterministic unchanged:
{j['sourceCssSha256']} (source)
{j['compiledCssSha256']} (compiled)
TWO byte-identical deterministic repacks PASS. Code-byte differences0. Independent
generated evidence preserved externally before restoring ONLY disposable generated
evidence for exact repacks; never code restored to force equality.

INITIAL FAILURES RETAINED (NOT ERASED)
Initial targeted18:7PASS11FAIL. Nine retries exposed unallowlisted custom op; fixed
production to existing frame/token-bound storage retryOnly, no allowlist/CSP change.
Two403/404 tests tried entering correctly removed inaccessible frame; now prove
no-frame/no-score. Baseline assertions not weakened. Subsequent18/20/21 targeted
passes are distinct snapshots. Final fresh full64/499 are separate evidence.
Raw original failures and development findings retained in ZIP/evidence and external
copies. No claim all development runs passed first time.

SCOPE / SECURITY / MEDIA
Global routes22 COMPLETE/15 PARTIAL/71 NOTSTARTED of108 inventory candidates;
components62/17/127 of206. Listening routes9/6/1 of16; components9/10/5 of24.
Source entry objects/statuses unchanged from V13.35staffroutes reserved:
23Admin/6Owner/6Teacher. Staff lesson author stays staff-only NOTSTARTED; no learner
CRUD/publish added. Learner Listening remains PARTIAL independently; Reading NOT
STARTED. Owner HTML→validate/extract→privateR2→register/maps→preview→explicitpublish
and Owner-supervised AI Reading imports remain DEFERRED.
Universal media PARTIAL. V13 audio-after-paint/256KiB authenticated Range/8MiB LRU/
two transports/quota+decoder/deadline/cleanup preserved. Stable early duration,
indexed unbuffered seek, proactive decoded/aggregate Blob bounds,long sessions/all
callers/provider/Safari/hardware open. Blob fallback explicitly NOT progressive.
Sandbox allow-scripts ONLY; CSP unchanged; no private URL/key/credential to child.
HttpOnly identity/server grading/ownership/status/publication/sequence/key redaction
remain authoritative. Proposed frontend API503, no live backend claimed.
Runtime audit0 vulnerabilities; development5HIGH/0critical (pinned tooling).
Matched-original rendered acceptance0, live original acceptance0. Viewport/theme/
locale interactions are NOT matched-original visual proof. No guaranteed1–100ms.
Backend/database/cloud/Railway/Cloudflare/R2/main/staff/production changes NONE.
All V1–V13 archives+sidecars byte-identical to verified V13 Git baseline.

REMAINING — CONTINUE FULL IELTS FIRST
Repeated rapid-route/reentry/cross-tab conflict and SSE-revocation during held
start/close; encoded Full audio-error/early-end/position permutations; highlight/
fullscreen and complete accessibility/lifecycle sweep; broader malformed ancillary
checkpoint-shape hardening. Do not label independently executable checks complete
because recording credentials are absent. Real recording/timing/alignment/backend/
provider/device are a separate UNVERIFIED gate. THEN Review coherently, then Script,
MCQ, actual Map, Choose TWO, Completion, Vocabulary; preserve Retry. Do not restart,
rebuild accepted modules or expand parallel partial engines.

THREE METRICS
Overall frontend: UNDETERMINED weighted product denominator; objective inventory
22/108 route and62/206 source-component CODE COMPLETE, not accepted product ratios.
Functional/security: UNDETERMINED product coverage denominator; bounded executed
378/378 units,499/499 Chromium,64/64 source cases, not universal acceptance.
Visual/live: UNDETERMINED aggregate denominator; matched-original rendered0,
live original0/9; comprehensive original0/9. No subjective percentage invented.

ARCHIVE
{j['archive']}
{j['bytes']} bytes;836 source+2manifest files.
SHA256 {j['sha256']}
External report/evidence: V14_VALIDATION.txt, v14-independent/summary.json,
generated-evidence/, exact repack/security/boundary/history/audit/install/build/
unit/chromium/original-source logs, and EVIDENCE_SHA256SUMS.
Owner approval remains required before any production replacement. No merge/deploy.
'''
(base/'deliverables/V14_VALIDATION.txt').write_text(text)
rows=[]
for p in sorted(out.rglob('*')):
 if p.is_file() and p.name!='EVIDENCE_SHA256SUMS' and '__pycache__' not in p.parts:rows.append(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(out).as_posix()}\n')
(out/'EVIDENCE_SHA256SUMS').write_text(''.join(rows));print('Final report and',len(rows),'external proof hashes written')
