# Shared rate limiting: current Python deployment boundary

The active implementation is `services/backend/app/rate_limit.py`, not the retired
TypeScript process-local limiter. All deployed replicas/functions use PostgreSQL
`api_rate_buckets` (migration 0071); AI multi-budget admission uses
`la_claim_ai_provider_v1` (0072). A host/region change does not create independent
in-memory quotas. This source repair requires no new production migration.

## Enforcement and failure behavior

- Atomic database updates reserve capacity before sensitive work, including
  password comparison. Bucket keys use HMAC with the stable environment-specific
  `AUTH_SECRET`; secrets/account identifiers are not stored as plain bucket keys.
- Counters survive process restarts. Fixed windows and cleanup are bounded; this
  is not a claim of sliding-window precision. `RATE_LIMIT_<RULE>` overrides are
  bounded by the implementation. AI limits cannot be raised above safe ceilings.
- `RATE_LIMIT_BACKEND=memory` is rejected in production and preview, including
  managed deployments without explicit APP_ENV. Missing/unavailable shared state
  fails closed with controlled service unavailability; it does not silently
  grant requests or fall back to per-process counters. `/readyz` verifies the
  operational schema and AI function before accepting the service as ready.
- Quota exhaustion returns 429 with Retry-After. Request admission can separately
  return 503 under load. These are protective capacity responses, not successful
  saves. A saved/acknowledged learner write must never be discarded to improve
  timing. Provider failure preserves saved submissions and bounded retry paths.
- The existing AI claim/lease mechanism bounds global/user/request slots and
  hourly budgets. External timeouts and ambiguous completion do not grant
  unlimited paid retries. Deployment does not reset shared spend counters.

## Client identity and proxy trust

`client_key` accepts a valid CF-Connecting-IP literal only after OriginBoundary
verified the configured edge secret. Without that proof, it uses the transport
peer IP and ignores X-Forwarded-For, X-Real-IP and provider-branded headers.
Malformed/duplicated values do not establish a new trusted identity. Rotating
caller-supplied headers cannot evade the IP bucket.

Behind an unverified hosting proxy several users may share its peer-IP bucket.
That conservative restriction is intentional until a reviewed trusted boundary
is installed. `TRUST_PROXY_HEADERS` controls CSRF origin resolution only; it does
not grant rate-limit identity trust. Never enable an origin secret on one side
without the matching edge rule. Health/readiness exceptions do not open learner
or upload routes. The bot credential exception is restricted to its internal
Telegram API prefix and does not attest a Cloudflare client address.

## Operational compatibility

All replicas in one environment need the same AUTH_SECRET and shared database;
preview needs separate resources. Sum per-replica pool sizes before scaling. Do
not drop 0071/0072 when rolling back compatible code. Monitor 429/503, acquire wait
and PostgreSQL capacity; raising limits or trusting unverified headers is not a
performance fix. Registration's existing email_taken response is a retained
product behavior, not a promise of account-enumeration elimination.

Regression evidence comes from `tests/test_shared_limits.py`,
`tests/test_origin_boundary.py`, `tests/test_runtime_portability.py` and the real
PostgreSQL probes/integration suite. The final release receipt records actual
counts; old Next.js/Map measurements are historical Git evidence, not the current
runtime contract.
