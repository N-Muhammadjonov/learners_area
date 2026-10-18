# Visual parity — UNVERIFIED

No approved-original screenshot baseline was available; **zero pixel comparisons, zero route PASS**.
Source inspection is not visual parity evidence.

## Candidate-only captures

Chromium 133 headless at 100% default zoom:
- mobile 390×844
- tablet 768×1024
- desktop 1440×900

`evidence/*-entry.png`: Uzbek entry welcome, forced video-error fallback at desktop.
`evidence/desktop-intro.png`: video element initial frame, not proof of complete playback.
`evidence/*-recovery-day.png`, `*-recovery-night.png`: Uzbek recovery form both themes.
All are candidate screenshots only, captured by `tests/browser.mjs`. Tests also check no horizontal
overflow on recovery and fixture-backed theme/locale switching. No educational content or live accounts.

## Source reuse

Original global CSS/tokens and Tailwind config preserved under css/source.css and tailwind.source.mjs.
Brand image derivatives, wallpaper webps, module SVG geometry and approved font binaries copied,
with font licenses/provenance retained. Native @font-face replaces Next/font variable setup.

## Differences needing investigation

Entry CTA is server-state-resolving button rather than a pre-resolved link; original public brand
configuration is unknown. Source desktop fallback selector required a narrowly scoped inline display
correction. Heading receives focus from the router and may show a focus outline. Full generated-font
fallback metrics, preloads, head metadata, scroll restoration and all unavailable routes are unverified.
No Safari, physical mobile, authenticated role, exam-focus or original-independent scroll comparisons.

## Acceptance procedure

Obtain lawful matching original screenshots per route/role/theme/locale/content/viewport/browser;
freeze animations or synchronize their time consistently; compare pixel diffs and inspect all visible
mismatches. Record genuine font antialias differences separately. A score alone cannot pass acceptance.
