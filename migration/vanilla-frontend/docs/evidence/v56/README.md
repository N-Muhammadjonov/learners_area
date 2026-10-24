# Staff V56 integration evidence

Reference: GitHub `main` b62b78f469e4f73aa80f441f630b012dc422af39. Arena initial baseline: 3a4c4965979df2973d470d2451abeefb62077d03; later Arena commits require rechecking router collisions.

V56 adds Management hub /app/management, Management Statistics /app/admin/statistics, adapts admin People online filter/presence, appends student learning summary/history independently from the existing Mock results, and ports existing DELETE material workflow. The 32 V30 additive routes are preserved, with 3 previously preserved routes untouched. The earlier archive's independent staff fixture coverage is retained; this is a candidate, NOT live-parity proof.

**Blocking dependencies:** `/api/frontend/staff/*` projected read endpoints are not implemented in the known backend. Real live operations are therefore unavailable and show a retry/error state. Existing mutations still use the original routes and must be verified against the deployed API. Admin/listening/import excludes two unsupported legacy formats; reading-import PDF needs pdf.js and worker. En/Uz end-to-end, 390/768/1440 browser, actual R2 upload, real owner actions and server authorization have not been tested here. Do not report COMPLETE.

**Do not merge into `main` or force-push.** Gate against latest Arena with `npm ci --ignore-scripts`, `npm run build`, `npm test`, `node --test tests/staff-final30/*.test.mjs tests/staff-v56.test.mjs`, `npm run check:assets`, then browser regressions. A changed Tailwind output requires a new *verified* immutable assets-css pin, not blindly changing the hash.

CSS: the standalone `finalize-staff-css-v56.mjs` utility checks that no previous CSS rules are removed before pinning V57, and refuses unresolvable changes. Run only after `npm ci` and `npm run build`; rerun all tests after.
