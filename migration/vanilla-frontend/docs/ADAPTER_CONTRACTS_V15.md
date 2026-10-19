# V15 contracts — V14 retained, no new production endpoint

Existing authorized GET/PUT `/api/listening/full/:id/authored-state`, resource
capability/stream, `/api/auth/changes` and `/api/auth/state` only. Session ownership,
role, availability, sequence, publication, grading and release remain server authority.
The `/api/frontend/*` adapters remain proposals/isolated fixtures, NOT deployed APIs.

V14 CheckpointWriter, one in-flight/latest coalescing/start barrier/manual retry,
typed canonical ACK, undo, replay, freeze, memory fallback and closed reconciliation
remain. Added ancillary native shape checks: bounded string records/answers,
UUID/status, unique numeric flags and review parts, finite position, typed unique
result rows with no extra answer-key fields; closed records still require the
existing exact canonical40 rows. Contradictory explicit status fields fail closed.
Source native in_progress saves attach their already-active own UUID to the transport snapshot:
the synchronous first setItem otherwise briefly lacks the wrapper's second stamp.
No authority is inferred from this identifier.

Every native mutation performs a fresh authorized GET and compares the semantic
own exam identity/status/answers/flags baseline before PUT. An exact desired
already-committed semantic state can be read-confirmed without duplicate mutation;
closed canonical40-row checks still apply. A real `navigator.locks` cooperative
mutex serializes loading/recovery and writes across SAME-BROWSER cooperating tabs.
This is NOT a server or cross-device lock and is NOT an authorization mechanism.
Without Web Locks only the fresh-read conflict gate is available. The existing
backend exposes no atomic revision/CAS/If-Match ordering. Another browser/device or
noncooperating writer can change state BETWEEN GET and PUT. That backend TOCTOU
ordering gate remains unresolved; do not claim prevention, rollback, or exactly-once
server commits. Canceled/failed requests may already have committed server-side.

Three recovery records remain per user/test/browsing context (base, :pending,
:start). :start carries the last semantic baseline, not a new fourth recovery record.
A session-only random context identifier plus a nonsecret window name distinguish
cloned/new tabs while preserving reload. No session/role/token is stored there.
Unavailable context storage keeps a stable page-memory fallback and warning;
reload/close durability is NOT promised in blocked/quota modes. Legacy three-record
recovery moves only after durable copies are byte-verified; failed copies keep the
original bytes. Own local answers are not erased by another tab's explicit server
load. 409 exposes a deliberate server-load action with retained own answers in
route-memory details. Leaving the route clears that retained display; it is not
cross-device storage or a permanent backup.

Media capability401 uses existing auth invalidation;403/404 remove inaccessible
frame/media. Late/disposed media emissions and playback recovery cannot revive old
transport; explicit pause cancellation does not trigger spurious recovery. Existing
256KiB Range /8MiB LRU/two-read generic transport stays unchanged. Native capability
URL playback and explicit Blob fallback remain distinct modes; Blob is NOT
progressive. No universal memory/codec/provider/Safari/hardware acceptance is made.

Sandbox remains `allow-scripts` ONLY, never allow-same-origin. No CSP weakening,
private URL/key/credential transfer, new grader, staff capability or backend change.
Highlights retain numeric offsets in iframe memory only, never protected material
text. Native fullscreen and its source dialogs remain owned by the existing frame.

Review continuation: semantic stamps also protect own revision answers/checked parts,
not audio clock/navigation metadata. Review revision strings retain the existing
course /progress4000-character bound (exam answers remain existing500). Existing
original Review renderer/self-study controls and authorized evidence are reused;
no new verdict function or /practice kind is invented. This first slice is PARTIAL,
not comprehensive Review or server grading/production acceptance.

Closed canonical predecessor records are NEVER relabeled with the next attempt UUID;
a fresh reload→retake source case enforces missing-start rejection and proves the
proper new in_progress predecessor before any close. No new grading logic.
