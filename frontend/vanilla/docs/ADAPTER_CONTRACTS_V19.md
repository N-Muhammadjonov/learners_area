# V19 Review contracts and external boundaries

See CHECKPOINT_V19 and final machine evidence. No new HTTP endpoint/payload/backend.
`/api/frontend/session` is the existing proposed strict session adapter, NOT a claim
that a production adapter exists. Recovery Check and Adopt each require fresh validated
server identity (same ID/role, active, unexpired) at both ends, server-owned canonical
submitted attempt, current own Review answers, available strictly validated course
progress. Session/client-mode/storage hints are never an authorization fallback.
`/authored-state` supplies canonical UUID, own answers/results and current activity
state, not browser grading authority. `/progress` records server course work, not
exam grading; partial numeric counts never identify exact committed questions.

## Local recovery contract
`review-discovery-v19.js` validates exact current user/test UUID-context key shape,
strict existing v1 intent and bounded sizes. Enumerates at most512 names; reads only
matching Review values. Eight records/2M characters,1M/record. Metadata <=4096 chars.
No automatic replay, merge, overwrite, or private-data indexing. Unavailable storage
means no guaranteed closed-tab recovery; no cross-device recovery promise.
Adopt requires explicit user action + fresh reads + Web Lock, then exact copied bytes
in the existing journal. Retry is separate and uses the existing single-flight writer.
Original source is always retained. Only exact current-context typed ACK clears its
pending record. Transfer/provenance SHA hints are denial/deduplication hints only;
no receipt authorizes protected material, fabricates progress, or infers completion.
Cooperating copies serialize in Web-Locks browsers. Other clients/devices need server
atomic revision control; GET→POST remains a race. Cancellation is not rollback.

## Exact legacy normalization responsibility (external, not implemented server work)
Supported runtime DTO needs authoritative catalogue UUID→exact authored source ID,
exact runtime storageKey and canonical question/part/audio mapping. Submitted or
exited own state needs server-issued canonical attempt UUID and40 unique q1–40
results of shape `{q,user,ok}`; active/closed transitions must obey current schema.
Normalize authenticated ownership and any legacy identifiers/results on the server
without deriving identity from titles, display numbers, spelling, arbitrary client IDs
or a browser storage key. An unavailable mapping remains visibly isolated/retryable;
this frontend will not synthesize a canonical attempt or accept another course key.
Missing/deleted/sequence-locked content must be denied by existing server context.
No corpus, normalization import, DB migration or guessed attempt introduced here.

## Separate direct lexical backend review — NOT PASS
GPT Work must, with authorized test accounts and no unauthorized production probes,
check direct authored?vocabulary=1 and lookup/save policy in current-tab exam,
other-tab exam, held request followed by exam start/revocation/session expiry,
direct access and legitimate authorized Review. Permission must precede enrichment;
occurrence/sense identity must be canonical or unresolved, never spelling-derived.
Frontend preflight alone cannot certify direct HTTP endpoint enforcement. Production
policy, private R2/provider/real recording alignment/Safari/hardware are UNVERIFIED.

Deferred Owner one HTML→validate→extract audio→private R2→register mapping→preview→
explicit publish stays GPT Work. No staff routes/CRUD/import/publish or Reading work.
