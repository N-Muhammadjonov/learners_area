# V14 contracts — extends V13; existing endpoints only

Existing GET/PUT /api/listening/full/:id/authored-state and API25s whole-request
abort bound retained. Authored values remain100KiB bounded string records. Server
retains identity/ownership/status/sequence/publication/grading/reveal authority.
No /api/frontend proposal is deployed. No backend changes or browser grader.

Checkpoint coordinator: one active mutation, newest own snapshot, one start-transition
barrier. No automatic retry of checkpoint mutations; failure latches until explicit
retry, edits remain buffered. Same active body suppressed; stale ACK ignored for UI;
newest undo still persists. A failed transport can already have committed server-side.
Submitted/exited ACK must confirm same transition, same own key and exact canonical
40 unique typed results. Server-closed open attempt reconciles from authorized ACK.

Opaque storage protocol adds retryOnly:true with empty values, exact existing
frame/token/channel validation. Parent handles only nativePersistence and does not
persist the empty retry message. No new sandbox permission/HTTP endpoint. Parent
checkpoint-state notifications carry phase/message/blocked only. iframe checkpoint
storage hydration is memory-only, no echo write. Frozen closed inputs do not change
source identities/options or introduce a replacement renderer.

Local scoped :start = attemptKey + previousKey; never sent as auth/session proof.
Fresh server GET precedes replay. Missing start replays only against unchanged
predecessor and no foreign active key. Otherwise409 retains own outbox. Successful
canonical ACK clears own :pending/:start. Scoped memory fallback contains <=3 own
records (existing100KiB cap each); clears on outer route abort and survives only
same-route authorized remount. Without browser storage AND server confirmation,
reload/close durability is impossible and explicitly warned. No secret/material key
is added. Notes remain session-only, timer remains V13 source-led UX, not anti-cheat.

401/403/404 tear down the inaccessible frame/media; fresh authorized retry required.
409/429/5xx/timeout/network/malformed feedback shows localized detail and does not
fake progress, submit or answer release.429 is manual wait/retry; backend still
rate-limits. Other progress/practice and V12 Retry contracts unchanged.

Universal media remains V13 PARTIAL; explicit Blob fallback is NOT progressive.
CSP unchanged; allow-scripts ONLY; never private media URL/credential/key to child.
35 staff routes/author desk reserved, no learner author/publish. Owner HTML/privateR2
pipeline/Reading AI-assisted import deferred. No backend/database/cloud/production.
