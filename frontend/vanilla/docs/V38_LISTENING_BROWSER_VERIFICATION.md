# V38 Listening Browser Verification

Scope: browser and unit verification for the V38 working tree (two source repairs on top of V37 `79a2892`). Every FAIL and SKIP is reported. Zero FAIL and zero SKIP appear in the final runs. Passing counts for previously implemented features are regression evidence only; they are not evidence that any remaining route feature is complete.

## 1. V38 focused browser suite: `tests/browser-listening-v38.mjs`

Run: `npm run test:listening-v38` (script added to `package.json`). Final run: **5 PASS / 0 FAIL / 0 SKIP** (`docs/evidence/v38/v38-browser-results.json`, `docs/evidence/v38/browser-listening-v38-final-run.txt`).

| # | Case | Result | Purpose |
|---|---|---|---|
| a | V38 in-progress legacy attempt (focus group) does not auto-enter Focus mode | PASS | Matches original `(focus)` layout, which has no `ShellUtilities` subscriber; asserts `dataset.focus === 'off'` and one Focus backbar |
| b1 | Legacy submit 429 shows `en.auth.errorRateLimited` | PASS | Verifies the `legacy.js` `failure(e,dict)` repair |
| b2 | Legacy submit network failure shows `en.auth.errorNetwork` | PASS | Same repair |
| b3 | Legacy submit 500 shows `en.auth.errorServer` | PASS | Same repair |
| c | MCQ Day reasoned completion refreshes day progress without focus on heading/main | PASS | `focusin` discriminating assertion (see section 2) plus the existing `activeElement` check and `?q=1` search preservation |

### Pre-repair observations (for the change history)

- Before the legacy repair, case b 429 and network both showed `errorServer` (the catch always used `errorServer`); 500 passed. This is the failure the repair fixes.
- The first V38 run had harness bugs (1 PASS / 4 FAIL); they were fixed in the harness (not in product code): Focus polling moved to `page.evaluate` because `waitForFunction` is refused under the preview CSP (`unsafe-eval`), and the MCQ open retries after a deliberate first 503.
- The earlier "MCQ focus-steal not reproduced" note was based on the final `activeElement` only and is superseded by section 2.

## 2. Discriminating proof for the MCQ Day change

The `focusin` recorder was added to case c. It was then run against the **pre-change** `mcq.js` (`git show HEAD:…`) and the **final** `mcq.js`, with rebuilds in between.

- Pre-change (`navigate` path): **FAIL** — `focusin=TEXTAREA,BUTTON,MAIN`; the route `MAIN` received focus. Evidence: `docs/evidence/v38/mcq-focusin-discrimination-pre-fix.txt`.
- Final (`replaceState` + `refresh`): **PASS** — no `MAIN`/`H1` focusin. Evidence: `docs/evidence/v38/browser-listening-v38-final-run.txt`.

Source basis: `js/router.js` `render()` focuses `h1` or `[data-shell-main]` whenever `navigation.refresh` is false; `refresh()` passes `refresh:true` and does not focus. The original `McqMastery` uses `router.replace` + `router.refresh`, which does not move focus.

## 3. Mandatory regression run (`scripts/verify-listening-v37.py`)

Command: `V37_VERIFY_OUTPUT=v37/v38-final V37_PARALLEL_SOURCE=1 python3 scripts/verify-listening-v37.py`. Exit code **0**. Output: `docs/evidence/v37/v38-final/` (`commands.json`: 17 commands, all exit 0). Historical evidence check: `historical-evidence-preservation.json` = 1679 files, `equal: true`.

| Suite | Result | Notes |
|---|---|---|
| units (`npm test`) | 605 PASS / 0 FAIL / 0 SKIP | matches V37 605 |
| browser (`tests/browser.mjs`) | 27 PASS / 0 FAIL | |
| browser-v2 | 14 PASS / 0 FAIL | |
| browser-v3 | 49 PASS / 0 FAIL | |
| browser-v4 | 72 PASS / 0 FAIL | |
| browser-v5 | 52 PASS / 0 FAIL | |
| browser-v6 | 77 PASS / 0 FAIL | |
| browser-v7 | 26 PASS / 0 FAIL | |
| browser-v8 | 79 PASS / 0 FAIL | |
| browser-v9 | 29 PASS / 0 FAIL | |
| browser-v10 | 53 PASS / 0 FAIL | |
| browser-v11 | 18 PASS / 0 FAIL | |
| encoded media (`browser-v11.mjs`, V12 filter) | 3 PASS / 0 FAIL | |
| browser total (above + encoded) | 499 PASS / 0 FAIL | matches V37 499 |
| actual-source (V12–V27 chain, `browser-original-source-v11.mjs`) | 418 PASS / 0 FAIL / 0 SKIP | matches V37 418 |
| timing (`scripts/performance-v33.mjs`) | 14 PASS / 0 FAIL | diagnostic only; no performance claim |
| assets (`scripts/assets-css-v33.mjs`) | exit 0 | `renderedVisualComparison: false`; not a visual result |
| equivalent controls (V22 filter) | 2 PASS / 0 FAIL | historical 4 not claimed equal |

The V38 focused suite (section 1) was run separately (5/0). It is not in the mandatory runner.

### Runner limitation found and worked around (not modified)

`verify-listening-v37.py` copies every new JSON under `docs/evidence` as an artifact. An output directory **under `docs/evidence` but outside `v37/`** makes it recurse into its own output (`OSError: File name too long`). The first V38 attempt (`V37_VERIFY_OUTPUT=v38/final`) hit this after the units and browser steps; its output was deleted. The final run used `V37_VERIFY_OUTPUT=v37/v38-final`, which the scanner excludes. The script itself was not changed, so this limitation still exists for any future output path outside `v37/`.

## 4. Other suites

- `npm run build`: run after each source edit; final build exit 0.
- Earlier V38 regression runs (before the final harness change): `browser-v8` 79/0, `browser-v3` 49/0, `browser-v9` 29/0, `browser-listening-revision-v37` exit 0 (1 PASS / 0 FAIL). These are included in the mandatory run above.
- Historical evidence files rewritten by those runs (`docs/evidence/v3/*`, `v9/*`) were restored from HEAD before the mandatory run; the runner restores its own saved set.

## 5. NOT run in V38 (explicitly)

- `browser-listening-visual-v37.mjs` (strict visual 66/6): not re-run; see `V38_LISTENING_VISUAL_PARITY.md`.
- `scripts/verify-script-sources-v37.py` (Script source sweep 30 PASS / 2 BLOCKED): not re-run in V38; the Script code is unchanged.
- `scripts/document-listening-v37.py`: deliberately NOT run; it rewrites `GPT_WORK_HANDOFF.md` from an older marker. The V38 handoff header was prepended manually.
- Live `/api/frontend/view`, live authorized catalogue, live authorized attempts: not run; UNVERIFIED (no live probes permitted).
- Hardware Safari with real audio: not run.

## 6. FAIL / SKIP ledger

- FAIL: 0 in all V38 final runs (units, browser suites, encoded media, actual-source, timing, assets, equivalent controls, V38 focused suite).
- SKIP: 0.
- Known open visual FAILs (retained from V37, not run in V38): six strict visual cases.
- BLOCKED (external, unchanged): Script Tests 10 and 25 (authoritative timing data); Tests 11/22 storage-key discrepancy needs source authority.
