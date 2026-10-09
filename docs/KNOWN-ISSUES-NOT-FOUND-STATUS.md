# Known issue: a missing resource can answer 200 with 404 content

Status: **partially fixed**. Malformed ids are fixed. "Valid uuid, no such row" is not,
and the remaining fix is a product decision rather than a bug fix.

## What happens

`src/app/app/(shell)/loading.tsx` declares a route-entry skeleton. In the Next.js App
Router a `loading.tsx` creates a Suspense boundary at that segment, so the shell is
streamed to the client **before** the page body runs. Once the response has started,
the HTTP status is already committed as `200`. A `notFound()` thrown afterwards can
only swap the rendered body — the status stays `200`.

The result: a stale or mistyped link to a shell page answered **`200 OK` with 404
content**.

## How it was proven

Not inferred from the docs — measured, with the port confirmed free first so that no
stale server could answer (that mistake produced two false readings while this was
being diagnosed).

| Request | with `(shell)/loading.tsx` | with it removed |
| --- | --- | --- |
| `/app/reading/attempts/zzz` | 200 | 404 |
| `/app/reading/attempts/<valid uuid, no row>` | 200 | 404 |
| `/app/writing/submissions/zzz` | 200 | 404 |
| `/app/listening/tests/zzz` (route group `(focus)`, no `loading.tsx`) | 404 | 404 |

The `(focus)` group has no `loading.tsx` and was correct throughout, which isolates the
boundary as the cause.

Two earlier hypotheses were tested and **disproved**: that awaiting `searchParams`
before validating was responsible (reordering changed nothing), and that
`export const dynamic = "force-dynamic"` was responsible (`reading/attempts` has no
such export and failed anyway).

## What was fixed

The **shape** check moved in front of the Suspense boundary, into `src/middleware.ts`,
which runs on the Edge before any rendering begins. A `[id]` segment that cannot be a
uuid is answered `404` immediately.

This costs nothing: middleware already runs on every one of these paths, and it cannot
reach PostgreSQL, so no database work is added.

`src/lib/nav/uuid-page-routes.mjs` holds the classification. Parameters are classified
by **name**, not by route, because several routes mix the two kinds —
`/app/admin/materials/[type]/[id]` is an enum *and* a uuid, and rejecting the path when
any segment failed would 404 valid URLs.

`tests/uuid-page-routes.test.ts` walks the real route tree and fails if a dynamic page
route appears whose parameter is in neither table, so a newly added `[id]` route cannot
silently inherit the old behaviour.

## What is NOT fixed

A **well-formed uuid that matches no row** still returns the 404 body with a `200`
status, because deciding that requires a database read, which the Edge middleware
cannot do and which must therefore happen inside the page — after the boundary has
already flushed.

Affected: every `[id]` page under `src/app/app/(shell)`.

Practical impact: crawlers, uptime monitors, link checkers and API clients that trust
the status code will treat a deleted or inaccessible resource as present.

## The options, and why none was taken unilaterally

1. **Delete `(shell)/loading.tsx`.** Fixes every case. Costs the route-entry skeleton on
   the 81 of 97 shell pages that have no `Suspense` of their own, so navigation would
   show nothing until the page resolves. That is a visible UX and perceived-performance
   regression across the whole authenticated product.
2. **Move the skeleton down** to the specific segments that benefit, leaving the
   `[id]` detail pages outside any boundary. Correct, but it is a per-page UX decision
   across ~97 pages.
3. **Resolve existence above the boundary**, e.g. in middleware against a cache or an
   edge-readable store. Adds infrastructure and a second source of truth for existence.

Option 1 is the smallest change and the most complete fix, but it trades a visible
product behaviour for a correctness property. That is the owner's call, not a QA fix,
so it is recorded here rather than made quietly.

## Reproducing

```bash
# with the port confirmed free, against a freshly built server
curl -s -o /dev/null -w '%{http_code}\n' -H "Cookie: $SESSION" \
  http://127.0.0.1:3000/app/reading/attempts/00000000-0000-0000-0000-000000000000
# => 200, with 404 content in the body
```
