# Remaining reference screenshots — 25 October 2026

Compared all fourteen new images (seven Vocabulary states, the external band-chart example, campus, People, Retention failure, Typing, Start action and study-profile controls) with the native implementation and the independent pinned Main reference. Private reference images are not source assets and are not included in the repository.

## Resulting behavior

- Campus module signs use 80% of their immediately preceding scale, retaining the TED/Podcast relative size, world anchoring, occlusion and hover behavior.
- The topbar search expands with available screen width, up to 480 px, and shrinks on narrow screens. Its keyboard hint hides when the search container is narrow. Back remains in the same topbar, with the previously requested responsive label policy.
- Standard action buttons use the supplied Start reference's blue fill, white text and pill shape. Module-colored borders remain. Navigation tabs, answer verdicts and state selectors retain their state indicators. Typing duration choices have no enclosing rectangles; an underline identifies the selected duration.
- Wallpaper mode's native input controls use a dark color scheme, including number steppers in the profile, so the browser does not draw light-surface black controls over dark fields. Focus mode retains its Day/Night scheme.
- People uses the available content width and the reference search/action/role/status/clear order. Username and phone occupy separate lines. Activity shows online, last visit and total active time. Existing filtering, pagination, role and suspension flows remain functional.
- Both full-mock charts display individual 4.0, 5.0, 6.0, 7.0, 8.0 and 9.0 levels. The lower bound extends only for a genuine score below 4.0 so no result is clipped. Results, averages and completion counts come from stored attempts. The external screenshot's background and synthetic example data were not adopted.
- Retention session, overview and history reads fail independently; a history failure no longer removes the level selector. A missing history renders a local retry. Authority failures propagate normally. Expired live attempts are locked by owner and finalized with the existing deterministic evaluator before their terminal result is returned, rather than remaining in a permanent 500 response.
- Speaking, AI Speaking and TED/Podcast recording previews preload the complete finalized clip, release microphone capture before exposing playback, explicitly initialize an unmuted player, and use optional browser audio-session routing where supported, restoring the previous routing when the preview is discarded. Players are retained across presentation updates. Route exit/discard clears the audio source before revoking its object URL; recordings remain local except the existing explicit AI submission flow.

## Investigation and validation

Read-only Supabase checks found healthy projects, all required Retention tables/columns, and 75 active production texts (15 per level). The inspected production attempts were already terminal and aggregate SQL succeeded. Available database logs did not establish the exact cause of the screenshot incident. No production database data/schema was changed; no staged content was published.

- Native frontend: 1,023 passed, 11 pre-existing skips, zero failures.
- Backend: 2,578 passed, one existing dependency warning.
- New regressions: 14 native and six backend checks cover partial Retention failure, ownership/expiry scoring order, both chart axes, People controls, all four action palettes, complete recorded data, microphone release, player preload and cleanup.
- Independent pinned Main comparison: 43 rendered control states, zero differences in the existing comparison scope.
- Real FastAPI/isolated PostgreSQL integration: 66 migrations, 126 typed tables, 333 HTTP checks, 148 native decoder checks and 120 DOM checks passed.
- Theme audit: 420 route/query/theme/Focus cases, 21,708 direct-text checks, zero contrast failures and zero unresolved colors.
- Python asset build: 461 runtime files, 119 routes, ASGI startup check passed; no Node server is required in production.

Deployment evidence is recorded in the task handoff. DOM/CSS checks do not certify browser pixel geometry or actual speaker output. Actual-device first-play audibility and authenticated production Retention could not be directly reproduced in this environment; the recorded-data lifecycle and identified server failure paths are regression-tested.
