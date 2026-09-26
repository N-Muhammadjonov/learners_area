# Reading production stability — the P0, its cause, and what changed

Owner's report: `https://learners-area.vercel.app/reading` rendered the library
once ("104 Academic passages"), then the same route fell into the application
error boundary with `Something went wrong while loading this page.` and code
`1594744578`. The database was already verified healthy (19/19 migrations, 62
tables, 42/42 checks, 105 passages / 104 published / 1 draft, importer
idempotent).

Everything below is either **measured in this sandbox** or explicitly marked
**EXTERNALLY UNVERIFIED** (the sandbox cannot reach the deployment).

## 1. What the code in the boundary is

`1594744578` is not an id and not a database code. Next.js writes it into the
error's `digest` before the message reaches the browser:

```
digest = stringHash(error.message + error.stack)
```

(`next/dist/server/app-render/create-error-handler.js` → `next/dist/compiled/string-hash`,
a 32-bit djb2 hash, printed in decimal.)

Two consequences, both confirmed by experiment here:

- the **same** failure in the **same** build produces the **same** number, so the
  owner's single code proves the crash was one repeated failure, not a random one;
- the number is **build-specific** (it hashes a stack), and a slightly different
  stack — a different render path, an extra async frame — produces a different
  number for the same underlying cause. So the code identifies *an instance* of a
  failure, and it is only useful together with a server log line.

`1594744578` itself **cannot be mapped retroactively**: this build logged nothing
server-side for a failed render, which is exactly why the crash had a
user-visible code and no server line to match it. The fix therefore includes the
missing log line (below); the next occurrence names itself.

### The missing log line — `src/instrumentation.ts`

`onRequestError` now writes one line per failed request, and nothing that could
leak (no cookie, no header, no connection string, no query parameters):

```
[request-error] digest=3039600036 render/react-server-components GET /reading route=/reading region=local chain=Error ← "Failed query: select ... from ""users"" ..." ← Error/ECONNREFUSED at=…
```

Verified locally against an unreachable database: the digest in that line is the
number the reader sees, it repeats identically for repeated identical failures,
and the `chain=` names the failing query and the driver error.

### How to find it in the Vercel dashboard

1. Open the project → **Logs** (or the deployment → **Runtime Logs**), pick the
   time window of the report.
2. Search for `request-error`, or for the digest number the user saw.
3. Read `chain=` — it ends in the driver error class, e.g.
   `Error/ECONNRESET ← "Connection terminated unexpectedly"`, `Error/57P01`,
   `error/42703 "column … does not exist"`, or `Error/ETIMEDOUT`.
4. `[boot] … region=… poolMax=…` (printed once per instance) says which region is
   serving and what the pool budget is.

## 2. Root cause

Two independent defects, both measured, both in the code path the owner used.

### (a) The connection pool had no ceiling in time — the crash

`src/db/client.ts` created `new Pool({ connectionString })` and nothing else.
Postgres-node's defaults then are: **10 connections per process**, no
`connectionTimeoutMillis`, no `statement_timeout`, no `query_timeout` — a request
may wait for a connection, or for a statement, **forever**.

The app runs on Vercel (Serverless). Each instance holds up to ten connections to
a hosted pooler that itself has a client budget (a Supabase session pooler allows
15 on the free tier; the direct host allows roughly 60 and is IPv6-only). With two
concurrent instances the budget is already gone — and when a pooler is at its
limit it either drops the new backend (the driver reports
`Connection terminated unexpectedly`) or queues it silently.

Reproduced in this sandbox with a proxy in front of PostgreSQL that adds 120 ms
per hop (Singapore-equivalent round trip) and caps backends at 6:

| Condition | Before | After the fix |
| --- | --- | --- |
| 12 requests, 4 at a time, cap 6, backend refused | **0/12 rendered** — every in-flight query failed, HTTP 500, `Failed query: … [cause] Connection terminated unexpectedly` | **12/12 rendered**, 0 refusals, TTFB p50 1777 ms |
| 4 requests, 4 at a time, cap 4, queue never moves | 3 rendered, **1 never returned** (client aborted at 15 s) | 4/4 rendered |
| any request against an unreachable database | hangs until something else times out | fails in ~0 ms locally, ≤8 s on a real network, with a real error and a log line |

That is the whole shape of the owner's report: the healthy requests and the
failing ones are the same code, separated only by whether a backend was free.

### (b) `/reading` asked the database twelve times, in five waves — the freeze

`/reading` (with the shell around it) used to issue **12 queries in 5 sequential
waves**, one of them a full scan of `reading_questions` grouped by passage, plus
the same filtered count twice:

```
user → unread badge → hub total → topics+types+hub totals
     → filtered count → [rows + full question scan] → attempts → filtered count
```

Against a local database that is 130 ms; against a database 250 ms away it is
**1.7 s of pure waiting**, and every extra statement in flight is another
connection taken from the limited pool. Measured through the 120 ms proxy:

- before: TTFB p50 **1701 ms** (10/10 rendered)
- after: TTFB p50 **1165 ms** (10/10 rendered), and 7 queries in 3 waves

## 3. What changed

| File | Change |
| --- | --- |
| `src/db/client.ts` | pool bounded: `max` 5 (env `DATABASE_POOL_MAX`), `connectionTimeoutMillis` 8 s, `statement_timeout` 15 s (sent as a startup parameter, so it survives a pooler), `query_timeout` 20 s, `idleTimeoutMillis` 10 s, `maxUses` 500, `keepAlive`, `application_name=learners-area` (how the connection count can be checked), `allowExitOnIdle` |
| `src/lib/data/reading-library.ts` | the page's total comes from `count(*) over ()` on the same statement as the rows; each card's question count is a correlated subquery on its own row (no full-table grouping); hub counts are three filtered counts in one statement; facets no longer re-count the library; an out-of-range page is clamped with a single extra count query |
| `src/app/(app)/reading/page.tsx` | the duplicated filtered count is gone; the number under the filters is the number the query used |
| `src/lib/auth/current-user.ts` | the identity lookup is timed (it is the first query of every private render) |
| `src/lib/observability/{timing,errors}.ts` | `timed()` logs only operations over `SLOW_OPERATION_LOG_MS` (default 400 ms) or failures, with a correlation id (`x-vercel-id` when present) and an error **class**, never a message, query or credential |
| `src/instrumentation.ts` | `onRequestError` writes the digest plus the cause chain for every failed request |
| `vercel.json` | `regions: ["sin1"]` — the database is in Singapore; see below |
| `scripts/verify-production-reading.mjs` | the production test: 10 direct loads + 10 client-side navigations + return/filter/page-2/query, per account, printing status/TTFB/boundary/digest |

No retry was added anywhere: a database that is genuinely unreachable still
surfaces as an error. No authorization, admission check or query filter was
weakened, and no production data or migration was touched.

## 4. Region and connection mode — the two things to confirm in the dashboard

**Function region.** The database is in Singapore. If the functions run in the
default `iad1` (Washington), every query pays ~250 ms of round trip; in `sin1` it
is ~2 ms. `vercel.json` now asks for `sin1`. Verify it actually took effect:

```bash
curl -sI https://learners-area.vercel.app/login | grep -i x-vercel-id
# x-vercel-id: sin1::…      ← running in Singapore (expected)
# x-vercel-id: iad1::…      ← the region setting did not apply (plan/settings)
```

or look for `[boot] … region=sin1 …` in the runtime logs. If it stays `iad1`,
choose the region in the Vercel project settings (Settings → Functions →
Function Region).

**Runtime connection mode.** Migrations from the owner's Mac correctly use the
Session Pooler on 5432; the *application* runtime should be checked separately,
because it is what opens many connections:

1. Vercel → project → **Settings → Environment Variables** → open `DATABASE_URL`
   (Production) and read only the host and port. Do not copy the password
   anywhere.
2. Compare with Supabase → **Connect**:
   - `aws-0-<region>.pooler.supabase.com:6543` — transaction pooler: the right
     one for Serverless, many short-lived clients;
   - `aws-0-<region>.pooler.supabase.com:5432` — session pooler: one backend per
     client, 15 on the free tier;
   - `db.<ref>.supabase.co:5432` — direct: roughly 60 clients and IPv6-only.
3. With this build the app asks for **at most 5 connections per instance**
   (`DATABASE_POOL_MAX`), and each is released as soon as its query ends.
4. Supabase → **Database → Connections** shows the current count; the app's
   connections carry `application_name = learners-area`.

Changing the runtime URL to the transaction pooler is a dashboard action for the
owner; it needs no redeploy of code and does not affect migrations.

## 5. Verification

**Local (this sandbox, production build, `next start`)**

- `tsc` clean · `eslint` clean · `npm test` 261 tests, 0 failures · `next build` OK
- `reading-stability.mjs` **32/32**: per role (OWNER, ACTIVE STUDENT) — 10 direct
  loads and 10 client-side navigations with 0 error boundaries, 0 blank pages,
  0 JS errors; hard reload; leave and return; Day/Night; UZ/EN; search, topic
  filter, Passage-1 filter, pagination, `page=99` clamped; a real passage opens
  with 13 questions and 8 paragraphs
- `admission-flow.mjs` **11/11** (register → queue → approve → audit → ACTIVE →
  learning, legacy account without a request row, second decision 409, student
  cannot approve)
- `verify-*.mjs` scripts: access 33, pages 71, browser-flow 54, owner 10,
  reading 33, dashboard 21, theme 32, responsive 23, publication 34, migration
  tooling 24, production-schema 41/42 (the one expected local failure is the
  seeded demo accounts)
- saturation and latency tables in §2

**Production (EXTERNALLY UNVERIFIED from here)** — the sandbox has no route to
the deployment, so the final verdict must come from the owner's own run:

```bash
cd <repo>
git fetch origin arena/01a0cf7b-learners-area && git switch arena/01a0cf7b-learners-area
git pull --ff-only origin arena/01a0cf7b-learners-area      # expect 9a49f17 + this commit

PROD_BASE_URL="https://learners-area.vercel.app" \
PROD_OWNER_EMAIL="…" PROD_OWNER_PASSWORD="…" \
PROD_STUDENT_EMAIL="…" PROD_STUDENT_PASSWORD="…" \
node scripts/verify-production-reading.mjs
```

It signs in (two sessions are created — ordinary product behaviour), makes 10
direct + 10 client-side requests per account plus return/filter/page-2/query,
creates no attempt and writes nothing, prints TTFB percentiles and any digest,
and prints `READING PRODUCTION STABLE` only when every request rendered.

## 6. Remaining risk

- The crash's *specific* backends-limit cause is inferred from a reproduction of
  the same failure mode, not from the deployment's own logs (no log line existed
  for `1594744578`). The next occurrence, if any, will name itself.
- The region change depends on the Vercel plan; §4 shows how to confirm it.
- Until the runtime `DATABASE_URL` is reviewed (§4), a session pooler at 5432 with
  a 15-client limit is the tightest part of the system; the app now asks for 5 per
  instance, which is safe, but the transaction pooler is the better fit.
