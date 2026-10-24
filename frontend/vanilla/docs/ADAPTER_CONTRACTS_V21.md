# ADAPTER CONTRACTS — V21

New interface-only fragment grammar: #review/part/1..4 optionally /question/1..40, with strict question-to-part agreement. Bare #review retained. These are UI locations, NEVER canonical attempts or authorization. No new HTTP endpoint or server payload. Parent uses existing V20 metadata barrier for direct Review entry and same-document history/hash intent; initial sandbox stays at hub until fresh own canonical state/session/progress availability is validated. Existing source controls open the activity/select the part; no original HTML/grading engine rewritten. Latest navigation intent coalesces during validation without incrementing authority churn. Explicit applied→focus acknowledgments fence visible/noninteractive phase and focus restoration, with eight-second local failure deadline and explicit existing Retry. Parent/child source/window/token/sequence checks; stale frame load callback cannot publish a document into a replacement frame. One-shot load initialization, per-frame AbortController, owned RAF/debounced scroll timer cleanup. Generic authority hints do NOT refocus/reopen a location. Both existing writers/journals and UIepoch vs route-disposal distinction retained. Router onHistory is opt-in; other routes retain normal disposal. Only UI scroll/history keys enter history.state, not answers/identity/capabilities. Unsupported part URLs produce an explicit safe notice, no guessed part. Original activity hashes retained for native source controls. Previous-attempt selector/heterogeneous catalogue/sequence/publication comprehensive verification remains OPEN.

## Preserved V20 history (not V21 completion claims)

# ADAPTER CONTRACTS — V20 continuation

Review native authorized host now handles storage/focus/pageshow/visibility and existing SSE authority hints. Hints synchronously hide/inert the protected frame/recovery views, cancel selection/lookup and pause owned audio. Fresh session → canonical own state → existing progress availability → session → own state must match the captured submitted attempt. No material re-download. At most two rounds per burst; repeated churn/error fails closed with explicit Retry. Unchanged scope resumes the same frame without autoplay; changed/unconfirmed scope disposes frame/media/writers while pending own storage survives. Existing writer waits this barrier before ACK. Queued own drafts/course intents are retained without transport during concealment. Original part changes still change UI epoch, not route-owned writer disposal. Self-generated focus return cannot reenter the barrier. No polling, new endpoint or authority from browser events. Legacy/noncanonical identities are not guessed. Backend direct authored?vocabulary=1 policy remains external/unverified.

## Preserved V19 inventory/contracts (historical)

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

### Hint/lifecycle refinements from preserved integration tests
Recovery journal/transfer/adoption writes are not canonical-attempt notifications: they keep their existing discovery invalidation. Authority storage hints are scoped other-context start metadata and pending-ACK removal (plus cleared storage), never trusted values. This avoids treating each own-answer/recovery write as a new canonical retake and failing valid cooperating writers on artificial churn. Native frame-to-parent focus transfer while the document remains focused is not an external window return; blur with document focus lost marks the next native focus as a revalidation hint. Synthetic focus, pageshow, visibility and existing SSE hints still validate. No event grants access. Both existing writers fence final ACK behind the same barrier; no second transport or competing journal. Late lexical enrichment is fenced by captured frame/generation and cannot refill a cleared cache after invalidation. Repeated actual authority churn still fails closed after the two-round cap.
