# Part 1 navigation measurement protocol

`[qa-perf]` diagnostics are enabled automatically on Preview and locally only when `PERFORMANCE_DIAGNOSTICS=1`. They report click/start time, first pending-feedback paint, same-origin RSC/API resource timing and the destination's usable-content paint. They do not log content, IDs, cookies, or credentials. The module transition indicator is delayed 60 ms only to avoid a zero-duration flash; it is not extended to improve route timings.

## Repeatable warm run

1. Use the same signed-in student and browser/session throughout; keep the same network, tab, locale and viewport. Do not change routes by the address bar or navigate backwards during a measured chain.
2. Run one unrecorded warm-up chain: Dashboard → Writing → Reading → Vocabulary → Grammar → Dashboard.
3. Run that complete chain at least three more times. For each transition, use the `[qa-perf] start` timestamp as click start, retain its matching `resource` events (especially `_rsc` TTFB/duration and bytes), and record `interaction.total_interaction_ms` as usable destination content after paint. Capture the matching `feedback.click_to_loading_ms` and platform `[perf] auth.currentUser`/route query log line when available. Keep a separate cold-start sample; never mix it into warm results.
4. For each transition and each environment, report the median and maximum (approximate worst) across the warm runs. If a run reports `incomplete` or `failed`, report it rather than dropping it.
5. Label local runs and owner Preview/browser runs separately. A source-code timing setting or a sandbox request is not a Preview navigation measurement.

## Current capture status (2026-09-29)

| Transition | Local warm median / approx worst | Owner Preview warm median / approx worst | Click/request/usable timing |
|---|---|---|---|
| Dashboard → Writing | Not measured | Not measured | Not captured |
| Writing → Reading | Not measured | Not measured | Not captured |
| Reading → Vocabulary | Not measured | Not measured | Not captured |
| Vocabulary → Grammar | Not measured | Not measured | Not captured |
| Grammar → Dashboard | Not measured | Not measured | Not captured |

No repeatable browser session or raw request traces were available in this workspace. An earlier owner manual note estimated main route changes at roughly 0.5–1.0 seconds; that is not a multi-run measurement and has no matching click, RSC/request, or usable-destination timing, so it is not presented as a benchmark here. Preview access was protected/returned `ECONNRESET`, and browser automation binaries were unavailable. Keep the table as not measured until real traces are collected; do not fill it using invented values.

Private sidebar Links disable automatic private-RSC prefetch so a cached suspended user's destination cannot be shown without a fresh authenticated request. The authenticated private layout and every API still check current account status. This avoids stale authorization; it is not reported as a navigation-speed gain. Source-level reductions to dashboard and Writing DB work are not a measured navigation-speed improvement.
