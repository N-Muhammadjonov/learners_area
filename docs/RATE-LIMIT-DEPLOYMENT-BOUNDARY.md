# Rate limiting: deployment boundary, measured

**Package B4.** Status of `src/lib/http/rate-limit.ts` against the actual deployment contract
(`vercel.json` → single region `sin1`, Next.js on Vercel serverless functions).

This document records what the limiter does guarantee, what it does not, and why the gaps were
left as gaps rather than closed with a dependency nobody authorised.

---

## 1. What the limiter actually is

A per-process sliding window in a `Map<action, Map<key, {count, expiresAt}>>`. No Redis, no
Upstash, no paid service, no new deployment requirement. Every rule is overridable by
`RATE_LIMIT_<NAME>`.

Rules in force: `login_account` 8/15 min, `login_ip` 40/15 min, `register` 10/hour,
`password_reset` 5/15 min, `admission_request` 10/hour, `telegram_auth` 20/15 min,
`evaluation` 60/15 min, `upload_intent` 120/15 min, `vocabulary_search` 300/min,
`live_partner_action` 120/min, `live_partner_invite` 20/10 min, `live_partner_token` 30/10 min.

---

## 2. Trusted proxy boundary — VERIFIED, with one load-bearing assumption

`clientKey()` prefers, in order: `x-vercel-forwarded-for` → `x-real-ip` → `x-forwarded-for`
read **right to left**. Every candidate must parse as an IPv4/IPv6 literal, so a header full of
text cannot become a bucket key either.

The reason right-to-left matters: a reverse proxy **appends** to `x-forwarded-for`, it does not
sanitise it. Whatever the client typed arrives intact as the left-most entry. Keying on the
left-most entry let any caller mint unlimited independent identities — rotate the header, get a
fresh bucket, and every per-IP limit stops existing. That defect is fixed and is covered by
`tests/rate-limit-trust-boundary.test.ts` (6 assertions, including an end-to-end rotation
attempt that must not defeat a per-IP limit).

**The assumption this rests on, stated plainly:** headers 1 and 2 are trustworthy *only because
the origin is reached through the platform proxy*. Vercel documents that it overwrites
`x-forwarded-for` to prevent spoofing. If this app were ever exposed directly to the internet —
a container port published without a proxy in front — then no header is trustworthy, the
right-most `x-forwarded-for` entry is the attacker's own, and per-IP limiting must move to the
edge. **This cannot be verified from inside the repository**; it is a property of the
deployment, and it is the single most important thing to re-check if the hosting target ever
changes.

`asIpAddress()` is deliberately permissive about IPv6 *shape* and strict about its *alphabet*
(`[0-9a-f:]`, must contain a colon). A string like `f:f` is accepted. That is intentional: a
bucket key only needs to be stable and unforgeable-by-content, and over-strict IPv6 parsing
would push real clients onto the shared `"local"` bucket, which is a worse outcome than a
slightly loose key.

---

## 3. Multi-instance enforcement — LIMITATION, RECORDED AND NOT CLAIMED OTHERWISE

**The counters live in process memory. Vercel scales serverless functions horizontally, so N
concurrent instances hold N independent counters.** An attacker whose requests are spread across
instances can consume up to roughly `limit × N` attempts inside a window before every instance
agrees they are blocked. Single-region `sin1` reduces how often that happens — there is no
cross-region split — but it does not eliminate it: concurrency, not geography, is what creates
the second instance.

**This document therefore does not claim globally distributed rate limiting, and neither does
the code.** What is claimed, precisely:

| Guarantee | Status |
| --- | --- |
| Per-account limits are keyed on the email, so they do not depend on any header | HOLDS on every instance |
| Per-IP limits cannot be defeated by forging or rotating `x-forwarded-for` | HOLDS behind the platform proxy |
| A bucket key is always an IP literal, never attacker-chosen text | HOLDS |
| An idle action's buckets are pruned, so memory does not grow without bound | HOLDS |
| The *effective* limit equals the configured limit across a scaled deployment | **DOES NOT HOLD** — it is `limit × instance count` |
| Counters survive an instance restart or a cold start | **DOES NOT HOLD** — a cold instance starts at zero |

The store is behind a two-function interface (`consume`, `isBlocked`, plus `reset`/`resetAll`),
so a shared store can be swapped in later without touching a single call site. That is a
preparedness statement, not a claim that it has been done.

**Why no Redis / Upstash was added.** The requirement was explicit: do not introduce a
dependency without demonstrated necessity and authorisation. Necessity is a function of the
actual abuse the centre sees, and it has not been demonstrated — this is one private centre,
not a public API. Adding a network round-trip to every login attempt to defend against an attack
nobody has made would be a real cost paid for a hypothetical. **If the owner decides multi-instance
enforcement is required, the change is bounded and the interface is already right.**

---

## 4. Account enumeration — DEFECT FOUND AND FIXED (B4)

The login response *body* was already uniform: `{"error":"invalid_credentials"}` with 401 whether
the email belongs to nobody or to somebody who typed the wrong password.

The response *time* was not. `bcryptjs` at 12 rounds costs **~390 ms measured on this machine**.
The handler could only call `verifyPassword` when it had a stored hash, so:

| Case | Measured cost before the fix |
| --- | --- |
| Known account, wrong password | ~392 ms |
| Unknown account | ~1 ms |

A 390 ms gap is not a subtle statistical signal that needs thousands of samples — it is a
stopwatch reading. An attacker could walk a list of emails and learn which ones have Learners
Area accounts without ever guessing a password. **Uniform error messages are not the whole of
"does not leak", and this was the part that was missing.**

**Fix:** `verifyPasswordOrDecoy(plain, hash)` in `src/lib/auth/password.ts` always performs
exactly one bcrypt comparison, against a fixed decoy hash of a value that is not and can never
be a password when there is no account. It always returns `false` when the hash is absent — the
decoy is a timing equaliser, never a way in.

Covered by `tests/login-enumeration-timing.test.ts` (6 assertions), mutation-tested two ways:
removing the decoy comparison fails 4 of them, and reverting the route to the conditional form
fails the wiring assertion.

### Enumeration that remains, deliberately

`POST /api/auth/register` answers `409 {"error":"email_taken"}` for an email that already has an
account. That **is** enumeration, and it is intentional: a learner filling in a registration form
must be told their email is already registered, or the alternative is a silent no-op that reads
as a broken form. Registration is separately limited to 10/hour per IP. Recording it rather than
"fixing" it, because closing it is a product decision about signup UX, not a security patch.

---

## 5. Per-account limiting has a denial-of-service tradeoff, recorded

`login_account` counts **failed** attempts only, and a correct password calls `reset()` — so a
learner who mistypes their own password is never locked out by their own typos. That part is
right.

The unavoidable consequence: an attacker who knows a learner's email can send 8 deliberately
wrong passwords and lock that learner out for up to 15 minutes. This is inherent to any
per-account attempt limit and is the standard tradeoff — the alternative (per-IP only) lets a
single attacker guess one account's password from many IPs instead. The chosen balance is:
per-account limits are tight (8/15 min) because they stop a focused attack on one learner, and
per-IP limits are looser (40/15 min) because a centre's shared NAT exit would otherwise lock out
a whole classroom. **Recorded as an accepted tradeoff, not a defect.**

---

## 6. Direct-origin exposure

Not applicable to the current deployment: the app is served by Vercel behind its proxy, and
`vercel.json` pins one region. If it is ever self-hosted, section 2's assumption is void and
per-IP limiting must move to the edge or to a proxy configuration that strips client-supplied
`x-forwarded-for` / `x-real-ip` before the app sees them.
