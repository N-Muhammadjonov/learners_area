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

## Second consequence: privacy probes that assert on status look like failures

`verify-reading` asserts that another student cannot open someone else's attempt by
checking for `404`/`307`. It reports `status 200` and therefore FAILS.

That failure is **not** an IDOR. Measured directly against the database, with a real
second student (`new.student@learnersarea.uz`) reading five attempts owned by
`demo.student@learnersarea.uz`:

```
owner=demo.student  -> OTHER student status 200, leaks passage content? false   (x5)
```

`getAttemptDetail(id, user.id)` is correctly scoped to the caller, returns null for the
stranger, and the page calls `notFound()`. The authorization holds and no passage, no
answers and no analysis are rendered — only the status code is wrong, for the reason
above.

The lesson for the suites: **a status code alone is not proof of either direction
here.** Any privacy assertion on a shell page must also assert that the protected
content is absent from the body, which is the stronger claim anyway.

## Re-measured during the Package D/E round: the split is deterministic, not a race

Confirmed again against build `Fh3lRwK2omvHbpt6d-BE3`, with the port verified free and a real
authenticated learner session, because the two readings above were only trustworthy once a stale
server was ruled out:

| Request | status | body | repeats |
| --- | --- | --- | --- |
| `/app/reading/attempts/not-a-uuid` | **404** | 0 bytes | 12 / 12 identical |
| `/app/reading/attempts/<valid uuid, no row>` | **200** | 210 499 bytes, contains the not-found body | 12 / 12 identical |
| `/app/writing/submissions/not-a-uuid` | **404** | 0 bytes | — |
| `/app/writing/submissions/<valid uuid, no row>` | **200** | 208 986 bytes | — |
| `/app/courses/ielts/lessons/<valid uuid, no row>` | **200** | 209 464 bytes | — |

Two things this adds to the earlier finding.

First, the malformed/valid split is **stable across repeats**, so it is structural rather than a
timing race between `notFound()` and the shell flushing. Twelve consecutive identical results in
each direction rules out the flakiness that would otherwise make this unfixable-by-construction.

Second, `/app/courses/ielts/lessons/{id}` behaves the same way, and its page has no `searchParams`
in its signature at all. That is a third independent disproof of the `searchParams` hypothesis and
shows the behaviour is a property of the `(shell)` group boundary, not of any one page's data
access. The ~209 KB figure is the streamed shell: the learner receives a full authenticated
skeleton and then a not-found body inside it.

An earlier reading in this round appeared to show `/app/courses/ielts/lessons/{id}` answering 404
for a *draft* lesson. It did not: that request was for the literal path segment `undefined`, which
is a malformed id and takes the middleware shape path. Corrected here so the table above is not
contradicted by a journey log.

## §11 verdict: OWNER_DECISION_REQUIRED, with the evidence the decision needs

The narrow solution §11 asks for does not exist under §11's own constraints, and this is now
measured rather than assumed:

* Deleting `src/app/app/(shell)/loading.tsx` yields the correct 404 (proven in the table earlier in
  this document) but is forbidden, and it would remove route-entry loading from all 97 shell pages.
* The shape check already lives in `src/middleware.ts`, which is why malformed ids are correct.
  Extending middleware to the existence check would require a **database dependency in global
  middleware on every request**, which §11 forbids inventing and which would put a DB round trip in
  front of every authenticated navigation.
* A page-level fix cannot work: the page throws `notFound()` correctly and in the right order
  (`reading/attempts/[id]/page.tsx` documents the ordering constraint in a comment), but the status
  is committed by the group's Suspense boundary before the page body runs. There is no API by which
  a child segment opts out of a parent `loading.tsx`.

What is **not** at risk, and is separately verified: authorization holds and nothing protected is
rendered. `docs/SECURITY-MATRIX.md` rows R09b, W02 and W07 record these as `STATUS_DEFECT` with
`privacy=OK` — deliberately not as IDOR, because the payload was inspected and the protected
content is absent. The defect is the status code and the 209 KB of shell that accompanies it.

The decision the owner has to make is therefore a real trade-off, not a missing fix: keep
route-entry loading on 97 pages and accept `200` with not-found content for a valid-but-absent id,
or give up the shared loading boundary (or accept a middleware DB lookup) to obtain the correct
status. Both options are implementable; neither is free, and choosing between them is a product
decision.
