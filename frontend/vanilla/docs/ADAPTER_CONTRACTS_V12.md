# V12 contracts — frontend-only extensions of V11

All ADAPTER_CONTRACTS_V11.md invariants remain. Existing HTTP endpoints only; /api/frontend/{public,session,view} are still proposed NOT live. No backend changes.

## Retry lifecycle

Existing POST /api/listening/full/:id/practice {kind:retry,answers,complete:false}; server checks HttpOnly identity/role/ownership/publication/sequence/current exam/missed membership and grades. Parent requires exactly one valid result per requested number; no rows/keys released on401/403/404/409/429/5xx, network, timeout, malformed/foreign/duplicate/missing feedback. Original source receives inert request IDs and validated results only.

Opaque protocol adds course/activity retry cancelRequestId with empty answers: LOCAL parent transport cancellation only, NOT an HTTP endpoint. Bound to current frame/token, one active retry request,12s deadline. Page/question/activity/frame/session exit cancels. Parent ignores stale/aborted ownership. Cancel cannot roll back a committed server practice run; no fabricated idempotency guarantee. Progress calls remain server-authoritative and follow valid feedback.

Storage la-original-retry-v12 contains canonical attempt identity, current question and learner text/selected codes only. Strictly limited to1..40 and existing500-character server answer limit; no keys/verdicts/material/transcript cached here. New attempt invalidates prior retry drafts. Parent session/test scoped recovery outbox remains unchanged.

## Authenticated Range/cache/decoder

Same-origin /api/resources/:key?download=1 credentials/no-store/redirect-error;256KiB maximum;206 Content-Range/total/MIME/ETag consistency persists through eviction.401 revokes;403/404 fail closed;5xx single transient retry;15s whole-read deadline including queued wait/body. Global8MiB LRU, two concurrent transports; previously delivered byte ranges can be reacquired, no forward gaps. All bytes cancel/clear on scope disposal. No URL/key/cookie enters opaque child.

MSE quota retry removes played material older than currentTime minus10s when enough played data exists, retries rejected chunk ONCE, else explicit Blob fallback. Backseek into evicted decoded range is explicit full-Blob fallback, NOT indexed/progressive random seek. Native fallback decode failures notify parent/visible retry. Duplicate nodes use one Blob with independent native controls. Proactive decoded bounds and Blob aggregate memory remain open engineering; unsupported formats cannot be called progressive.

Sandbox remains allow-scripts ONLY; original CSP unchanged. Approved-origin/provider/native MIME/range/expiry/revocation integration must be supplied by authorized integration owner, not a wildcard/CSP bypass. Safari/hardware/live unverified.

35 staff routes reserved; author desk staff-only. Future staff integration must reconcile latest routes/shell/private-scope/guards/adapters/extraction/CSS/media manually against V12. Deferred Owner single-HTML/privateR2/registration/preview/explicitpublish remains deferred. Reading imports Owner-supervised AI-assisted; not implemented.
