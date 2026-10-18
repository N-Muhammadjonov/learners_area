# V11 contracts — existing narrow APIs, no backend deployment

Extends ADAPTER_CONTRACTS_V10. /api/frontend/{public,session,view} remain proposed projection boundaries, NOT deployed production endpoints. Server identity/status/role, ownership, publication, sequence and exam state remain authoritative. No secrets, client sessions, generic SQL proxy, answer corpus or private URL is added to a client summary.

## Canonical original checkpoint

Existing authenticated GET/PUT /api/listening/full/:id/authored-state. Learner-owned string-valued runtime map retains existing bounds and scope. Submitted/exited ACK must contain the original storage key, matching attemptKey when known, and exactly40 unique rows {q:1..40,user:string<=500,ok:boolean}. Canonical server verdict only; never a source/browser grade. Invalid JSON, missing/foreign/incomplete/duplicate/malformed result fails closed, preserves pending outbox and exposes retry. GET may contain no attempt yet. API authorizes own user/test/attempt, and server grader certifies canonical results.

Native checkpoint updates are serialized/coalesced. Immediate learner draft messages preserve the existing scoped recovery outbox before network debounce; only the latest pending pointer may update hydration/child ACK or clear outbox. An earlier save must not overwrite newer learner UI. Failed writes retain retry; unrelated successes do not clear an outstanding pending-save error. This is not a cross-device/latest-writer concurrency guarantee; existing server locking/stale-attempt protections remain essential.

Original submit policy removes local result calculation, waits for canonical ACK, blocks study while pending, provides retry and a bounded waiting notice. Notes retain original ephemeral exam-session semantics; no new persistent private-note cache.

## Retry Weak Areas

Existing POST /api/listening/full/:id/practice {kind:'retry',answers:{'1'..'40':string<=500},complete:false}. No client/userId or fabricated grading endpoint. Server must require active own user, sequence access, published/authorized test, no active restricted exam and membership in actual missed questions. Existing source server returns {results:[{number,correct:boolean,key:string,evidence:string}]} after checking. Parent validates exactly one result per requested question, rejects foreign/duplicate/missing rows, binds reply to originating frame/token/requestId and ignores stale frame replies. No verdict/key appears before successful authorized feedback. Grouped Choose TWO sends ONE selected letter per missed question, not the invalid comma-joined string. A previously correct paired own letter is retained/locked rather than resubmitted as missed. Practice feedback does not replace the original exam grade. Server progress/participation is recorded only after feedback.

## Authenticated Range boundary

Existing /api/resources/:key?download=1, same-origin credentials, Range bytes=start-end and If-Range when ETag supplied; redirect:error, cache:no-store.256KiB maximum requested/accepted chunk;206 must return consistent Content-Range, total, MIME audio/* or video/* and ETag. A small complete200 is accepted only with bounded valid Content-Length; oversized ignored Range is canceled before acquisition. Oversized206 body is canceled while reading.401 invokes authority revocation;403/404 fail closed;5xx retried once then visible retry;15s deadline; scope teardown aborts reads/cache.

Only {inert id,offset,total,mime,ArrayBuffer} crosses parent→opaque child. No resource/signed URL, key/cookie/credential crosses. Parent accepts requests only from current frame/window and token, only configured identities and contiguous/cache offsets; no arbitrary external URL fetching. Child keeps real native controls. MP3 MSE uses bounded buffered lookahead; unsupported/duplicate/decoder-failure paths acquire ranges to a Blob and are explicitly non-progressive. No universal/random-seek/long-file-memory claim.

## Approved-origin integration requirement — no CSP bypass

Preview deliberately keeps script-src self/media-src self/connect-src self and disconnected APIs return503. Shared capability URLs or approved external providers require the existing reviewed production origin policy or a same-origin authorized proxy configured by the integration owner. Provide exact approved origins, media MIME, byte-range support, expiry/revocation behavior, ownership and publication redaction; do not add wildcard origins or allow-same-origin. YouTube/provider classification is not HTMLMediaElement support or provider acceptance. No production/backend/cloud configuration is changed here.

All35 Admin/Owner/Teacher canonical routes remain reserved. Reconcile future staff work manually against newest shell/routes/guards/private-scope/adapters/generated-source/CSS/media; never automatically merge older V4 output. Reading and the deferred Owner HTML→validation→audio extraction→private R2→registration→preview→explicit publication workflow are NOT implemented in V11.
