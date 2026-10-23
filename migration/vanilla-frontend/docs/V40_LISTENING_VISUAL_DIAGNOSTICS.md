# V40 Listening visual diagnostics

## Hub 768x1024 UZ Day (strict residual)

Harness: `tests/browser-listening-visual-v39-diagnostic.mjs`, rerun unchanged in V40. Fixture: `listening-visual-v37-fixtures.mjs`, reference: `reference-listening-v37.json`. Output: `docs/evidence/v40/visual-control/hub-diagnostic-v40-rerun.json`. Log: `docs/evidence/v40/logs/visual-hub-768-uz-day-diagnostic-rerun.txt`.

| Experiment | V39 (committed) | V40 rerun |
|---|---|---|
| A native vs native (same page) | 0 px | 0 px |
| B reference vs reference (same page, DOM swap) | 0 px | 0 px |
| C fresh pages, native vs reference | 2 px, max delta 1 | 0 px |
| D V37 order (native, swap, reference) | 2 px, max delta 1 | 2 px, max delta 1 |
| E structure, nodes | 18 vs 18, no diffs | 18 vs 18, no diffs |
| Settle: 8 fresh renders non-zero | 4 of 8 | 0 of 8 |

Reading: the pixel difference appears in some runs and not others, with the same code, fixture and viewport. Native-native and reference-reference are stable. This is run-to-run raster noise of one channel unit on two pixels, not a stable layout or CSS difference. Geometry and structure are equal in every run.

Status: the strict assertion remains a FAIL in the record. It cannot be made to pass without changing tolerance, relaxing the assertion, or adding a determinism mechanism. None of those were done. Historical FAIL retained.

Controls for owner review: a determinism option for the fresh-page render (font and raster settle), or an explicit owner decision on a documented tolerance. Neither was chosen in V40.

## Activity visual

No Activity fresh-vs-fresh control was run in V40. Activity responsive layout (768 and 390, EN/UZ, Day/Night) was checked as layout only (no overflow, primary control visible), not as pixels.

## Revision visual (out of V40 scope)

Five V37 strict FAILs remain open (revision: 1440 EN and UZ, Day and Night, plus 768 EN Night). Not investigated in V40. They are the first work in the next route, after V40.
