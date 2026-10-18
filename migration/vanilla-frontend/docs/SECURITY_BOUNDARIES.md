# V2 continuation notice — current status PARTIAL

V2 adds server DTO validation, explicit protected-route gating, separate shell/authority lifetimes, SSE/reconnect/coalescing, expiry, 401/multi-tab logout, scoped teardown, original opaque sandbox protocols and native media disposal. These are candidates/subset-tested, NOT fully security audited. No backend authority changed. All original nine activities, live capability expiry/revocation/permissions/outbox/multi-tab and destructive role workflows still require real verification. 7 dev audit findings remain.

Full V2 record: [CHECKPOINT_V2.md](CHECKPOINT_V2.md). Archive: `LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V2.zip`. See final response/sidecar/validation for exact hashes and local/remote HEAD. A file cannot include its own commit hash.

Implementation%: UNDETERMINED (active denominator unconfirmed; 27 partial/115 page records). Functional/security%: UNDETERMINED (subset probes, not full acceptance). Visual/integration%: UNDETERMINED (0 baseline comparisons / 0 live accepted).

---

## Historical foundation record (22560b7) — retained for continuity, superseded above

# Security boundaries

## Unchanged source of authority

Original backend, database, session cookies, role permissions, ownership checks, exam grading,
private Worker/R2 media delivery and Telegram workflows are unchanged. No deployment occurred.
No direct PostgreSQL/Supabase connection exists in the candidate. No service keys, auth bypass,
production fixtures, signed media URLs, protected authored HTML, answer keys or exam payloads
were intentionally copied into the static output. Public dictionaries are UI translations.

## Implemented subset

- API client only accepts `/api/` same-origin paths; cookies `same-origin`, no-store and redirect
  rejection. JSON Content-Type required. No automatic mutation retry.
- Concurrent GET deduplication has consumer-specific abort and aborts transport when all leave.
- No settled private read cache, localStorage user roles or persistent session/profile data.
- Recovery sends email/password only to the existing authoritative recovery endpoint.
  Server is responsible for active owner/admin eligibility, rate limits, cookie transport and CSRF.
- `entryDestination` only uses server state for presentation. It never grants a capability.
  Failed/unknown state is not treated as successful authentication.
- User text and server errors are not inserted into HTML. Original vector geometry is parsed
  from a trusted build-time map, not from responses or user input.
- Abort-based event cleanup and stale-navigation protection prevent an old view replacing a new one.
- Preview root is an explicit build allowlist, with dotfile and missing-static-file rejection.
  Documentation and source inventory are not browser-published. Private API requests receive 503.
- Basic CSP, nosniff, same-origin referrer policy. No frame-ancestor restriction breaks Arena preview.

## Not yet implemented / not certified

Session-revocation SSE, absolute expiry timers, multi-tab invalidation, logout workflow, private
shell identity binding and route-specific authorization presentation are NOT migrated. There are
no private data views to secure in this checkpoint; this is not proof of future safety. Before any
private view is enabled, implement and test the original AccessChangeListener/session behavior and
DB-authoritative bootstrap. Clear private requests/media/resources on every authority change.

## Listening integration rules for next implementation

Inspect latest `src/lib/client/authored-media-controller.ts`, `private-resource.ts`, authored host
components and Listening focus pages. Preserve hub-first paint then background authorized stream.
Do not preload all audio or bundle restricted HTML. Preserve opaque-origin sandboxing: never add
`allow-same-origin`. Retain CSP and message source/origin/protocol checks. Revoke object URLs and
stop audio/iframe activity on session loss/navigation. Preserve original nine-activity metadata and
answer redaction; no student-side grading bypass. These rules are requirements, NOT implemented claims.

## Audit scope

Public source files and selected public assets were copied; original protected content remains in
its existing backend boundary. Filename/text checks are useful but not a security penetration test.
`dependency-audit.json` records 7 dev-only findings. Do not describe the delivery as fully audited.
