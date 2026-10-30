# V38 Listening Visual Parity

## Status

**Visual parity is NOT closed. The six V37 strict FAILs are still FAILs.** No tolerance was raised, no palette or design was changed, and no failure was hidden. V38 did not complete the cause investigation for the six FAILs, so no fix is claimed. No production pixel-parity claim is made.

## Retained V37 strict result (source of truth for this document)

Source: `docs/evidence/v37/listening-visual-document.json` (V37 commit `79a2892`).

- Strict zero-tolerance document: **66 PASS / 6 FAIL**. Geometry 72/72 equal. Dimensions equal in all cases.
- Coverage: 1440×900, 768×1024, 390×844 × EN/UZ × Day/Night across the required Listening states, with matched authorized original captures per V37 scope.

| Case (V37 name) | Result | Different pixels | Max channel delta |
|---|---|---|---|
| revision-1440-en-day | FAIL | 4 | 1 |
| revision-1440-en-night | FAIL | 26 | 1 |
| revision-1440-uz-day | FAIL | 3 | 1 |
| revision-1440-uz-night | FAIL | 20 | 1 |
| revision-768-en-night | FAIL | 1 | 1 |
| hub-768-uz-day | FAIL | 2 | 1 |

These are the six V38 targets. All are one-channel residuals with equal geometry.

## V38 visual work performed

- **No new strict capture was run in V38.** `browser-listening-visual-v37.mjs` was not re-executed, so its 66/6 result is not re-measured in V38.
- The mandatory regression run (`docs/evidence/v37/v38-final/`) included all browser suites, but not the strict visual document.
- Reason the V38 code changes are not expected to alter the visual fixtures (an inference, not a measurement): the legacy-exam change affects only the submit-failure message text, and the MCQ Day change affects only the transition after a reasoned answer. Neither is part of the render state captured by the strict fixtures. This should be confirmed by a re-run before any visual claim.

## Investigation status of the six FAILs

- **Not performed in V38.** The source-style, token, theme-timing, rasterization, font and icon investigation requested by the V38 directive was not carried out. No cause is identified or claimed.
- Observed facts only: geometry is identical, the differences are sub-threshold one-channel values, and the affected pixel counts are small (1–26). These are consistent with antialiasing or gradient rasterization differences, but this is a hypothesis, not a finding.
- Next step (not done): compare computed styles and rendering of the failing regions between the native page and the original capture (fonts, `font-smoothing`, theme transition timing, gradient or shadow rasterization, icon SVG rendering), without changing tolerance or palette.

## Other visual states

- Legacy in-progress exam (`attempts/:id`, legacy mode): no strict original visual evidence exists in V37 or V38.
- Full route visual parity for the six target routes is not established. Only the states listed in the V37 visual document are covered.
- Live data and production paint are not covered; fixture data is not live data, and synthetic audio is not original audio.

## Classification

- Strict visual: 66 PASS / 6 FAIL (V37, unchanged in V38).
- Comprehensive original visual: NOT ESTABLISHED.
- Live integration visual: UNVERIFIED.
- Hardware Safari with real audio: NOT VERIFIED.
