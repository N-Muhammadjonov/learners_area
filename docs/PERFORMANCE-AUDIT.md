# Performance audit

The owner reported two symptoms in the same breath: a shell where the sidebar and
the page scrolled together, and clicks that froze the page for five to ten
seconds. They are different defects with different causes, and both were measured
rather than guessed at.

**What the numbers below are, and what they are not.** They come from
`next start` (a production build) on the sandbox machine, against the local
PostgreSQL on port 5433. They are a *lab* measurement: useful to compare before
and after a change on the same machine, and **not** production numbers and **not**
a phone. Production latency (Vercel + Supabase + R2, real devices, real network)
is **EXTERNALLY UNVERIFIED** from here; the user's own check is what settles it.

## The shell defect (P0)

The layout was `min-h-dvh`, so the document itself grew with the sidebar and the
main column never had its own scroll container. Scrolling the navigation dragged
the passage with it. The fix is a viewport-locked shell (`h-dvh` + `overflow-hidden`)
with two independent scroll containers, and `min-h-0` on both flex children —
without `min-h-0` a flex child cannot shrink below its content and `overflow-y:
auto` does nothing at all, which is exactly how the original defect hid.

Proven by `/tmp/bt/shell.mjs` (36/36), which measures scroll positions rather
than reading CSS: it scrolls the rail, then asserts the main column's scroll
offset and the document's own scrollY are unchanged — and the reverse.

## The click-latency defect (P0)

Two causes, both removed:

1. **A query per question on a practice page.** Every answer row was fetched for
   itself. The attempt loader now reads the passage, its questions, their groups,
   paragraphs and the student's saved answers in a fixed number of queries, and
   list pages that show materials use one query for the whole page
   (`listResourceBlocksForOwners`) rather than one per card.
2. **Waiting for the server before acknowledging a tap.** Autosave in the
   practice workspace writes after a 900 ms debounce, and the UI shows
   `Saving…` / `Saved` / a retry — so the student's typing is never blocked by a
   round trip. Search debounces at 300 ms with a 2-character minimum.

Measured warm, on the local production build (`/tmp/bt/perf.json`, 2026-09-26):

| Route | TTFB | DOM interactive | Load | Re-fetch | LCP |
| --- | --- | --- | --- | --- | --- |
| `/dashboard` | 42 ms | 71 ms | 123 ms | 42 ms | 140 ms |
| `/reading` | 37 ms | 111 ms | 116 ms | 109 ms | 136 ms |
| `/vocabulary` | 94 ms | 167 ms | 170 ms | 64 ms | — |
| `/listening` | 19 ms | 80 ms | 82 ms | 27 ms | — |
| `/writing` | 16 ms | 58 ms | 68 ms | 24 ms | — |
| `/progress` | 36 ms | 100 ms | 101 ms | 35 ms | — |
| `/admin/people` | 17 ms | 74 ms | 85 ms | 31 ms | — |

Client navigation (click → the new page's heading on screen), which is what the
owner actually felt:

| From → to | Latency |
| --- | --- |
| `/dashboard` → `/reading` | 96 ms |
| `/reading` → `/vocabulary` | 72 ms |
| `/vocabulary` → `/grammar` | 81 ms |

Against the target in the brief (≤ ~150 ms feedback, ≤ ~1 s warm meaningful
render, p95 ≤ ~1.5 s) these are inside the budget on this machine. They do not
prove the same numbers in production.

## The phone defect (P0, found by measuring)

At 390px the desktop rail stayed in the flex row: the main column was 126px wide
and every Reading card was 100px. Nothing failed — no horizontal overflow, every
tab returned 200 — so the only way to find it was to measure element widths. The
rail is now hidden below 768px and the drawer takes over at the same breakpoint;
the matrix asserts a ≥360px main column at 390px for every role and route.

## What is deliberately *not* optimised

- **No skeleton on every page.** Route-level `loading.tsx` files do not exist
  here, on purpose: this build is fast enough that a spinner would flash and
  disappear, which reads as jank rather than as feedback. The practice workspace
  keeps its server-derived state (timer, saved answers) immediate because the
  server renders it.
- **No client-side cache layer and no external search service.** PostgreSQL is
  the only data store, as the brief requires.
- **No image optimisation for the brand artwork.** The approved files are served
  as derivatives at their display size (96px / 640px / 32px) with declared width
  and height, so nothing shifts when they arrive.

## How to reproduce

```bash
npm run build && npm start           # production build, local database
cd /tmp/bt && node perf.mjs          # writes /tmp/bt/perf.json
node shell.mjs && node matrix.mjs    # shell scroll + the full walk
```

## Still to measure in the user's environment

| Item | Status |
| --- | --- |
| Production TTFB (Vercel edge → Supabase) | EXTERNALLY UNVERIFIED |
| Real-device interaction latency (phone) | EXTERNALLY UNVERIFIED |
| p95 over a real session, not three clicks | EXTERNALLY UNVERIFIED |
| Local production build on the sandbox machine | VERIFIED LOCALLY (numbers above) |
| Sidebar/main independent scrolling | VERIFIED LOCALLY (`shell.mjs` 36/36) |
| 390px and 320px layout, no squeezing | VERIFIED LOCALLY (`matrix.mjs` 157/157) |

## Work QA2 continuation — 2026-09-28: browser click-to-content

Environment: production build on generic Node, `APP_ENV=preview`, loopback HTTP,
isolated seeded PostgreSQL, in-app Chromium browser at desktop width. One real
seeded Reading passage, not the production 105-passage library. No network/CPU
throttling. Three observations per route per condition; small diagnostic sample,
not a production percentile claim.

Diagnostic is explicitly enabled with `PERFORMANCE_DIAGNOSTICS=1`; production
APP_ENV or VERCEL_ENV disables it even if the flag is set. Default is off. It
writes only console events, with no external request, UI, query text, user ids,
object ids, report body, cookies or credentials. Module names are allowlisted.

T0 is the captured click (input event for search). T1 is a loading/pending DOM
state followed by a double requestAnimationFrame paint opportunity. T2 is the
requested route and meaningful main content with no pending/fallback marker,
again followed by a paint opportunity. These are browser timestamps, not tool
wall-clock duration or a compositor trace/INP score. Missing loading state is
reported as null rather than fabricated zero. Cancelled samples are superseded.
Resources report RSC/API/JS/CSS duration and TTFB; document, hydration-effect,
LCP and long-task entries help separate transport from client delay.

Reproduction: Dashboard -> Reading -> Notifications -> Support -> Vocabulary,
repeat three times. Before: common app `loading.tsx` replaced every screen with
a Suspense fallback. Repeated RSC responses finished in 17–40 ms but content
usually waited about 300 ms longer. The installed Next React DOM runtime has
`globalMostRecentFallbackTime + 300 - now()` in its retry path. Removing the
blanket app fallback while retaining actual Link pending feedback eliminates
this measured delay. The previous page stays visible until the authorized new
content is ready. The bell now also exposes Link pending feedback. No auth or
content guard changed. Framework internals were not patched.

| Route | n before/after | Median click-to-content before (ms) | After (ms) | After loading feedback (ms) |
| --- | --- | ---: | ---: | ---: |
| Dashboard | 3/3 | 322.7 | 60.9 | 26.4 |
| Reading | 3/3 | 339.7 | 43.2 | 27.0 |
| Notifications | 3/3 | 340.7 | 42.3 | 25.7 |
| Support | 3/3 | 340.5 | 41.1 | 24.0 |
| Vocabulary | 3/3 | 331.0 | 40.0 | 28.3 |

Across 15 navigations the observed median was 338.1 -> 43.0 ms. The first
post-build Dashboard visit took 150.2 ms; it is retained in the sample. One
pre-change notification visit was 53.0 ms; it is also retained. Raw console logs
are kept outside Git in `work/qa2-performance-before.json` and
`work/qa2-performance-after.json`.

Global search sample: dialog opening 31.4 ms; `study` input to results 411.4 ms,
including its existing 280 ms debounce. Loading feedback 28.5 ms. Two real
results, clear returned zero results. No debounce reduction was made without
an observed need. Local support submission to visible success: 91.7 ms, loading
feedback 25.6 ms. These are individual samples, not distributions.

Responsive shell/Vocabulary checks at 320, 360, 375, 390, 393, 768, 1024 and 1440:
all visible header controls inside viewport, no overlapping control rectangles,
profile visible, no document horizontal overflow. At 320 the search dialog and
profile panel fit; search produced results, clear worked, Shift+Tab wrapped to
Close and Escape restored the control. Broader per-module responsive QA remains.

Production network/DB/browser performance: **EXTERNALLY UNVERIFIED** for this
Work build. It has not been promoted. This local causal fix does not by itself
close the user's production-performance complaint or FINAL QA 2.
