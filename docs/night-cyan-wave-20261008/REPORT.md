# Night cyan wave delivery — 2026-10-08

Scope: only Night design on `codex/manual-qa-round-2-20261003`, repository `N-Muhammadjonov/learners_area`. Starting HEAD: `da2fde2a50f1d0474340e73c474e5be1962806da` (local and remote matched). No branch switch, merge, reset, or Arena feature transfer. Final Git/deployment receipt is recorded separately after push.

## Owner corrections supersede the original prompt

Support and the Management switch use the same separate glass rectangles as Main/Modules/Progress. Group headings have no rectangle, use 800 weight, 12px and fully opaque warm white. The mobile drawer has a transparent background and border; the dialog uses one continuous mobile wallpaper, so there is no long sidebar slab. Day styling is unchanged. The owner explicitly approved moving one existing TypeScript suppression comment onto its actual import line so the existing operational script can compile; no operational behaviour was changed.

## Assets

Immutable originals and checksums: `reference/ui/night-cyan-wave/v1/ASSET_MANIFEST.json`. All four original hashes and both runtime copies verified. Only `public/images/night/LA_NIGHT_DESKTOP_BACKGROUND_SOURCE.png` and `LA_NIGHT_MOBILE_BACKGROUND_SOURCE.png` are website wallpapers. Reference screenshots are never served as wallpaper. No generated or re-encoded replacement assets.

## CSS and measured geometry

Every new selector is restricted to `[data-theme="night"]:not([data-focus="on"])`. Wallpaper lives on the persistent ordinary shell; background cover / no-repeat / center center. Below 768px: mobile source, center bottom. Sidebar/main are transparent. Cards retain existing grids and data.

| Setting | Value |
|---|---|
| Nav background | rgba(8,32,68,.40) |
| Border | rgba(58,172,232,.24) |
| Hover | rgba(12,51,98,.54) |
| Active | rgba(20,47,77,.62), gold border .60 |
| Card | rgba(7,24,52,.67), border .23 |
| Header | rgba(5,21,47,.58) |
| Radius / row / row gap | 11px / 46px / 7px |
| Icon / inner gap | 36px / 10px |
| Blur | 8px; underlying RGBA remains when blur is unsupported |
| Text / gold | #F3EEE5 / #E6B94F, opacity 1 |

Desktop at CSS viewport 1440×1000: all 14 Main/Modules/Progress/Support/Management links measured 263.3887×45.9961 CSS px, radius 11px. Main/Modules/Progress had 36px icons. Initial mobile measurement at 390×844: all 12 Main/Modules/Progress links 287.3828×45.9961; final Support and Management also measured 45.9961px with identical nav background. Small fractions are browser rounding at 80% zoom. JSON includes each row's bounds.

## Browser evidence

- 1440 desktop: real authenticated local app, Night wallpaper, separate glass rows, live empty-state data; screenshots and row bounds attached.
- 390 mobile: closed/open panel and independently scrolling drawer, body scroll lock, Escape closure; transparent drawer and 800-weight headings confirmed in computed styles. Support is shown in the scrolled screenshot.
- Tablet: 1024px desktop sidebar and no horizontal overflow. This browser's 80% zoom maps integer viewport controls to 767px/769px; both sides of the 768 breakpoint tested rather than falsely reporting an exact 768px run. The older `night-tablet-768.jpg` filename contains the measured 767px view.
- Native keyboard Enter navigated to Reading. Focus mode there: wallpaper `none`, sidebar `none`, ordinary solid main background; screenshot/JSON attached. This is focus-shell verification, not a seeded timed-exam end-to-end attempt.
- Day: mobile before/after JPEG pixels identical. Desktop sidebar properties and geometry identical; mean JPEG channel difference <0.012/255, restricted to topbar hover/focus state. No Day CSS overrides added.
- Night → Day → Night exercised. Browser screenshots were captured after the selected theme was painted; same-call captures before paint were replaced.

Accessibility limits: no new animation or parent opacity. Base keyboard focus styles and navigation contracts retained. Existing blur fallback is RGBA; Safari/iOS hardware, forced blur-off and reduced-motion browser emulation were not executed. No universal WCAG contrast certification is claimed for a photographic background. Pointer backdrop dismissal was not conclusively verified with this browser tool; existing dismissal handler is unchanged, Escape was verified.

Browser database was disposable local PGlite over the official socket adapter. Native PostgreSQL initialization was blocked by the environment's shared-memory restriction. No Preview/Production database migrations or data writes were performed for this task.

## Exact checks

- Typecheck: PASS after the approved comment-only fix.
- ESLint: PASS, zero warnings.
- Production build: PASS.
- UI suite (final): 214 tests, 214 pass, 0 fail, 0 skip.
- Full unit suite: 1078 tests, 978 pass, 5 fail, 95 skip. Skips are not passes.
- Baseline recheck of affected failing suites at untouched starting HEAD: 64 tests, 59 pass, the same 5 fail, 0 skip. Same two TypeScript diagnostics also reproduced at baseline.

The five pre-existing failing cases are Reading streaming contract checks (2), General Reading library contract (1), Preview migration plan assertion (1), and teacher-linked reporter snapshot (1). These were not changed under the Night-only scope. Thus Night UI/build checks passed, but the repository-wide test gate remains red. Full logs are saved outside Git in `work/evidence/night-*.log`; no broad green-gate claim.

Deployment status and exact pushed SHA must be read from the final post-push receipt; this report alone does not certify deployed UI.
