# Performance report — LIMITED LOCAL MEASUREMENT

Local HTTP, Chromium 133 headless, 390x844 touch. 10 visits to not-found followed by SPA link to landing. CSS animations NOT complete at DOM readiness. No backend, throttling or original baseline. Not an application-shell or module benchmark.

Raw observations: `evidence/performance.json`.

Median reported (upper middle of 10 samples): **251.20 ms**.
Range: **78.20–577.50 ms**.

This does **not** meet/prove the preferred 1–100 ms target. Samples include module work and
requestAnimationFrame polling. No original benchmark, no authenticated content, no network throttle,
no persistent-shell benchmark, no media readiness, no application memory or long-task measurements.
No claimed production speed improvement.

## Static sizes (not an original transfer comparison)

| File | Bytes | gzip bytes |
|---|---:|---:|
| index.html | 758 | 437 |
| css/global.css | 120362 | 22407 |
| css/fonts.css | 1142 | 335 |
| js/main.js | 772 | 422 |
| js/router.js | 2435 | 1113 |
| js/i18n/uz.js | 194424 | 54176 |
| js/i18n/en.js | 187444 | 51967 |

Browser modules are split by responsibility. Heavy educational modules are not yet implemented,
so their absent bytes cannot be reported as an optimization. No blanket private/media prefetch.
There is no settled private cache. Prefetch, bounded cache/invalidation and persistent shell remain
future implementation work. `scripts/performance.mjs` reproduces this narrow local benchmark.
