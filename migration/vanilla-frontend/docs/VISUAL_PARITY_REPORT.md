# V2 continuation notice — current status PARTIAL

No original/live reference comparisons were obtained. 0 VISUAL VERIFIED routes. Source markup/styles/assets were reused in explicit generated presentations, not screenshots-as-UI. V2 candidate-only screenshots: evidence/v2/{desktop-login-fixture-day,mobile-shell-fixture-day,authored-isolated-sandbox}.png. The authored screenshot contains only synthetic sandbox HTML. Chromium source/fixture snapshots are NOT original parity evidence.

Full V2 record: [CHECKPOINT_V2.md](CHECKPOINT_V2.md). Archive: `LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V2.zip`. See final response/sidecar/validation for exact hashes and local/remote HEAD. A file cannot include its own commit hash.

Implementation%: UNDETERMINED (active denominator unconfirmed; 27 partial/115 page records). Functional/security%: UNDETERMINED (subset probes, not full acceptance). Visual/integration%: UNDETERMINED (0 baseline comparisons / 0 live accepted).

---

## Historical foundation record (22560b7) — retained for continuity, superseded above

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
