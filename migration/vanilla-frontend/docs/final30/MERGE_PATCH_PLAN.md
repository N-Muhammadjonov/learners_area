# MERGE PATCH PLAN (textual; no original file was modified)
1. Copy the five FINAL30 namespaces into `migration/vanilla-frontend/` (they only add files).
2. `js/routes.js`: for each pattern in `modules/staff-final30/routes.js`, replace the `load:()=>import('../modules/unavailable.js')` of the SAME pattern with that entry's loader, keep `protected:true`. Patterns not listed stay `unavailable.js`. `tests/staff-final30/routes.test.mjs` asserts every pattern already exists in the V4 table and is one of the 35.
3. Shell/CSS: no change. Tailwind `content` already globs `./modules/**/*.js` and `./js/**/*.js`, so new class names are picked up on the next `npm run build` (not run here). No new CSS file was needed.
4. `test` script is `node --test tests/*.test.mjs` and will NOT pick up `tests/staff-final30/`; add `node --test tests/staff-final30/*.test.mjs` to the integrator's gate.
5. Decide F-2/F-3 (fix `api-client` vs keep `rawJson`); decide F-1 (add confirmations?).
6. Implement the PROPOSED read adapters (ADAPTERS_REQUIRED.md §B) behind the existing server auth helpers; until then every FINAL30 route shows the retry notice on 503 (never fabricated data).
7. Re-run against then-current Arena HEAD; resolve conflicts on `js/routes.js` only. Arena's student modules are not touched.
