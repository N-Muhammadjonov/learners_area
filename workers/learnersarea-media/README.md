# Existing private media Worker

This updates **learnersarea-media**, its existing **MEDIA_BUCKET → learners-area**
binding, and its existing `MEDIA_SIGNING_SECRET`. It creates no bucket, Worker,
paid cache or additional service. Deploy the bundle to the existing Worker; do
not place a secret in this repository or in a `NEXT_PUBLIC_*` variable.

## Read protocol

The shared implementation is `src/lib/media/protocol.ts`. A read token contains
an unpadded, canonical base64url UTF-8 JSON array:

`[1,"learnersarea-media",uid,authVersion,sessionKey,sessionExpiresAt,key,exp]`

Its second dot-separated segment is HMAC-SHA256 over the UTF-8 bytes of
`la-media-read-v1\n` followed by the first segment. `sessionKey` is a SHA-256
cookie digest, never the cookie. Expiry is Unix seconds, at most 120 seconds and
no later than session expiry. The parent capability endpoint returns `expiresAt`
in **milliseconds**. Noncanonical encodings, wrong resource/identity/audience,
unsafe keys and expired signatures fail closed. GET and HEAD are read operations;
no write/list endpoint exists.

Every new GET, HEAD and Range read calls the fixed production backchannel
`https://learnersarea.uz/api/media/authorize` **before** R2. Its separate proof is
HMAC-SHA256 over `JSON.stringify(["la-media-backchannel-v1",method,token,timestamp])`;
timestamps must be within 30 seconds. The website verifies both signatures,
checks the current account epoch and exact-session revocation in PostgreSQL,
then reuses the existing per-resource authorization (including sequential locks).
There is no authorization cache. Database/backchannel outages deny reads. SSE is
only a UI invalidation channel, never the source of read permission.

R2 body streams go directly into the response. HEAD does not read a body.
Single ranges support inclusive/open/suffix forms, 206/416 and If-Range. Object
metadata cannot override private/no-store delivery. CORS and timing visibility
name only the production website. Missing Origin is allowed for native media
requests with a valid capability; a foreign explicit Origin is refused.

Raw invocation URL logging is replaced with a sanitized `media_read` application
event (method, status, duration only). Keep application logs enabled at 100% and
**Include Invocation logs** off so capability query strings are not persisted.
Do not log request/response objects or caught error payloads.

## Website and rollout

1. Verify the existing Worker, binding and secret names, then deploy this code.
2. Verify direct denied requests and the live HMAC/expiry/Range protocol.
3. Apply additive `0060_auth_session_revocation.sql` with the exact migration
   lineage checked. Existing cookies have epoch zero until an actual authority
   change. Exact-token logout preserves other devices. Do not use `db:push`.
4. Apply the owner's **existing staged** `MEDIA_WORKER_URL` and
   `MEDIA_SIGNING_SECRET` patch to the website service; do not recreate it.
5. Deploy the CI-verified website SHA, check its actual running identity, and
   exercise authorized and revoked media plus the original Listening controls.

The opaque Listening frame keeps `sandbox="allow-scripts"`, `connect-src 'none'`
and data/blob media only. Only its trusted parent owns the real native audio and
short-lived URLs. The original hub paints before audio preparation; authoritative
checkpoint/course hydration gates controls without remounting the document.
Vocabulary enrichment loads on demand. Preview/staging may leave both Worker
variables unset and use per-request authenticated streaming; a partial or wrong
Worker configuration fails closed. Legacy presigned rewrite paths are disabled
at Worker cutover. Direct upload intent/PUT/finalize is unchanged.

## Validation and operating limits

`tests/media-protocol.test.ts` compares WebCrypto signatures against Node crypto;
`tests/media-worker.test.ts` covers streaming, HEAD, ranges, negative permission
and outage cases. Session tests use isolated PostgreSQL fixtures. Native Safari
and Chrome playback plus real R2/revocation checks remain deployment gates.

Bundle with the repository's installed esbuild:

```sh
./node_modules/.bin/esbuild workers/learnersarea-media/index.ts --bundle --format=esm --platform=browser --target=es2022 --outfile=/tmp/learnersarea-media-worker.js
```

Do not use shared caches for private authorization or buffer entire recordings.
The free Worker request/CPU allowance must be checked against measured usage;
passing fixtures does not establish capacity for 200 simultaneous students.
