# `bg-ink-50` does not exist — every loading skeleton in the product is invisible

**Status: REPRODUCED_DEFECT · not fixed here · needs owner confirmation and coordination with the
GPT Work "background loading" hotfix.**

## What was measured

The theme's `ink` palette in `tailwind.config.ts` defines shades **950, 900, 700, 500, 300, 100**.
There is no `ink-50`, so Tailwind generates no rule for `bg-ink-50`:

```
grep -c 'bg-ink-50'  <built stylesheet>   -> 0
grep -c '.bg-ink-100{' <built stylesheet> -> 1
```

Confirmed in the live DOM in real Chromium at 390px, by appending an element with the class and
reading `getComputedStyle`, in **both** themes:

| class | Day Mode | Night Mode |
| --- | --- | --- |
| `bg-ink-50` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` |
| `bg-ink-100` | `rgb(232, 230, 242)` | `rgb(41, 45, 60)` |
| `bg-paper-raised` (the card behind it) | `rgb(255, 255, 255)` | `rgb(17, 20, 33)` |
| `bg-band-good/10` | `rgba(30, 127, 92, 0.1)` | `rgba(119, 213, 154, 0.1)` |

So the skeleton blocks are transparent on a white card in Day Mode and on a near-black card in Night
Mode. `animate-pulse` animates an element with nothing to show, which means the loading state renders
as empty space rather than as a shimmering placeholder.

The mistake is easy to make and easy to keep making: the neighbouring `signal` scale *does* define a
`50` shade, so `bg-signal-50` is valid and `bg-ink-50` looks exactly parallel to it. It compiles,
type-checks and lints, and renders nothing.

Counts were verified rather than estimated — `grep -rn 'bg-ink-50' src/ --include=*.tsx` returns 38
occurrences across 21 files.

## Scope — 38 occurrences in 21 files

Not a one-off typo. Every loading skeleton in the learner product uses this class:

- `src/app/app/(shell)/page.tsx` — dashboard open-lessons block and two skeleton grids (3)
- `src/app/app/(shell)/assignments/page.tsx`, `grammar/page.tsx`, `grammar/[topicId]/page.tsx`,
  `live-classes/page.tsx`, `mocks/page.tsx` (2), `progress/page.tsx` (3),
  `speaking/lessons/page.tsx` (2), `video-lessons/page.tsx`, `writing/page.tsx` (2)
- `src/components/interaction/SectionEntryFrame.tsx` — the shared `Block` skeleton, which is what the
  global route-entry loading surface renders, so this one alone affects every route
- `src/components/reading/ReadingLearningLibrary.tsx` (5)
- `src/components/vocabulary/VocabBoardPanel.tsx`, `VocabStudio.tsx`, `VocabUsePanel.tsx` (2),
  `VocabWordsPanel.tsx` (2)

Beyond skeletons, the same missing class is load-bearing for real UI:

- `src/components/writing/translation/TranslationRunner.tsx:50` and
  `src/components/progress/ProgressTrends.tsx:44` — the **track of a progress bar**
  (`role="progressbar"`), so the bar has no visible trough
- `src/components/writing/stealing/StealingFlow.tsx:55` — the circle behind each step number
- `src/components/lessons/LessonAuthoringDesk.tsx:577,581,584,589` — the published / no-revision /
  draft / scheduled pills, and `:623` the **selected-lesson highlight**, so the selection affordance
  is only a border
- `src/components/writing/translation/TranslationResultView.tsx:54` — the `unavailable` verdict badge

## Why this was not fixed in this round

The change is mechanical — `bg-ink-50` to a generated token — but it is a **visual change to 38
places across 21 files**, and three things make it the owner's call rather than a drive-by repair:

1. **The intended token is a design decision.** `bg-ink-100` is generated and theme-aware
   (`232,230,242` day / `41,45,60` night) and is already the neutral used for borders, so it is the
   obvious candidate and was verified to give 9.36:1 / 10.03:1 contrast with `text-ink-700`. But a
   skeleton fill is a surface choice, and `bg-paper-sunken` is also generated and may be what the
   design intends for a recessed placeholder. Picking one silently would be making an approved-design
   decision on the owner's behalf.
2. **GPT Work is separately hotfixing "background loading"** on the deployed website. A 38-site
   sweep of loading-surface classes is exactly the area that could collide, and the instruction is
   explicit that this workstream must not be overwritten or interfered with.
3. **It cannot be honestly verified at the end of a session.** Each of the ~20 affected pages needs a
   real browser check in both themes to confirm the skeleton is now visible and that nothing else
   shifted. Recording the defect with measurements is defensible; changing 38 sites and asserting it
   is fine without that sweep is not.

## Recommended fix

Add the missing shade, or move the call sites to a token that exists:

- **Preferred:** add `50: "rgb(var(--ink-50) / <alpha-value>)"` to the `ink` scale with a
  `--ink-50` value in both the `:root` and `[data-theme="night"]` blocks, which repairs all 38 sites
  at once and keeps the class names the design already uses. This changes `globals.css` and
  `tailwind.config.ts`, so it needs the owner's colour values.
- **Alternative:** a mechanical `bg-ink-50` → `bg-ink-100` (or `bg-paper-sunken`) sweep, verified page
  by page in Day and Night.

Either way the check that should have caught this belongs in `scripts/verify-theme.mjs`: it currently
asserts that no component hardcodes a colour and that nothing reaches for Tailwind's default palette,
but it does not assert that **every token utility used in source is actually generated in the built
stylesheet**. That is the general form of this bug — a class that looks right, compiles, type-checks
and lints, and renders nothing.

## How it was found

Not by inspection. `scripts/verify-changed-surfaces.mjs` computed the WCAG contrast of a new neutral
badge from the colours the browser actually resolved, and reported the background as
`rgba(0, 0, 0, 0)`. The badge in question had been styled `bg-ink-50 text-ink-500` in the same round;
that badge was fixed to `bg-ink-100 text-ink-700` with measured contrast (commit `421f4d7`), and the
measurement that caught it is what surfaced these 38 pre-existing sites.
