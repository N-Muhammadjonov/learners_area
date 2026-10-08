# Day cyan waves and blue glass — 2026-10-08

Owner-provided desktop, portrait and landscape PNGs are copied without modification; six runtime/reference copies match their manifest SHA-256 values.

Day navigation and action buttons use translucent navy-blue glass, light text and cyan borders. Primary actions/active navigation retain gold borders. Group headings remain bare bold text; Support follows the same link geometry. Cards remain light translucent surfaces. Mobile drawer remains transparent with one continuous wallpaper. A discovered selector spillover onto the mobile backdrop was corrected and visually rechecked.

All new rules exclude focus mode. Existing Night CSS is byte-identical to the prior HEAD prefix. No route, API, authorization, data or migration changes.

## Verification

- Production build, lint/type validation: PASS.
- UI suite: 214 passed, 0 failed, 0 skipped.
- Full unit suite: 983 passed, 0 failed, 95 skipped (not claimed as executed).
- Earlier five stale test assertions/fixtures were reconciled and pushed separately in 5ac055c.
- In-app browser, local isolated QA owner: desktop 1440x1000, mobile portrait 390x844, mobile landscape 844x390, tablet portrait 769x1024 and tablet landscape 1024x767. Expected wallpaper selected at each size; no horizontal overflow.
- Mobile drawer background rgba(0,0,0,0); backdrop rgba(255,255,255,0.08). Blue links and separate rows visually checked.
- Night switch restored original Night wallpaper and active-link rgba(20,47,77,0.62).
- Screenshots are JPEG captures at browser zoom; image dimensions differ from measured CSS viewport. Evidence filenames refer to viewport category, not pixel-perfect canvas dimensions.

## Limits

Local browser uses PGlite socket QA fixtures, not native PostgreSQL certification. Safari/iOS hardware and hosted private pages were not authenticated/verified. One local mock dashboard stream briefly returned PostgreSQL 26000 during a server restart; a fresh load returned its normal empty state. No product logic was altered for this transient isolated fixture error.
