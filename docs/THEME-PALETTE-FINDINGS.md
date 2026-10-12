# Theme palette findings — what is a defect, what is a design decision

`scripts/verify-theme.mjs` reports **28 pass / 4 fail**. This document records what each failure
actually is, measured rather than assumed, and separates the one that was a real product defect
(fixed) from the three that need an owner decision.

Nothing here changes a pass/fail criterion to make a verifier green. Where a verifier's *report*
was misleading, the report was corrected and the criterion left alone.

---

## 1. Fixed: the report form's message field had no accessible name

**Not** a theme finding — found while investigating failure 2 below.

`src/components/support/ReportProblem.tsx` rendered its `<textarea>` with a `placeholder` as its
only labelling source. Assistive technology drops a placeholder once the learner types, so the
field was announced as an unnamed edit box during exactly the moment it is used (WCAG 1.3.1 /
4.1.2).

The label copy already existed in **both** locales — `support.message`: `"What happened?"` /
`"Nima bo'ldi?"` — and was rendered by nothing. The fix wires it as an `aria-label`, which adds no
visual change to the protected shell design.

Evidence: `scripts/verify-report-control.mjs`, **17/17 pass** in real Chromium at 320px, end to end
into PostgreSQL, leaving zero residue (it deletes the single row it files). It checks the launcher
is present, opening it reveals the control, the control is inside the viewport and clears the WCAG
2.5.8 44px touch floor (measured 52×46), it exposes `aria-expanded` and an accessible name, the
form opens with a **named** message field, submitting calls `POST /api/support/reports`, the row
reaches `problem_reports` with the correct route and viewport, there are no console errors, and the
**rendered** Uzbek names differ from the English ones. `tests/reporter.test.ts` 18/18.

Fixed in `e14f128`.

---

## 2. `data-report-toggle` is not in the first paint of `/app` — two failures, one cause

Failures *"the report control ships with the shell"* (line 47) and *"the dashboard keeps its
navigation on small screens"* (line 131) are the **same assertion** evaluated twice:
`html("/app").text.includes("data-report-toggle")`.

The control exists and works. It is rendered by `ShellUtilities` inside the shell's collapsible
utilities panel — one launcher that opens Focus mode, the Coach link and Report a problem — so it
is not present until that launcher is opened. Measured at 320px in real Chromium: the launcher is
in first paint, opening it reveals the control, and a report can be filed through to the database
(17/17 above).

Two things worth recording:

* Whether the control belongs in first paint is a **visual-design decision** about the protected
  shell. Moving it out changes what every learner sees on every page. `OWNER_DECISION_REQUIRED`.
* The check that *passes* — `/ReportProblem/.test(shellUtilities) && /floating/.test(shellUtilities)`
  — is a source-text scan. It cannot see render conditions and would still pass if the control were
  never mounted. `scripts/verify-report-control.mjs` replaces that inference with a measurement.

---

## 3. Two components contain literal hex colours — both structurally required

The check forbids any six-digit hex in `src/components/**/*.tsx`. Two files match.

**`src/components/listening/AuthoredListeningFrame.tsx`** — `#4f46e5`, `#171a30`, `#0f1120`,
`white`. These are inside a **string of JavaScript injected into a foreign document**: `bridge()`
builds a script that runs inside owner-authored listening content's iframe, where it adds a notes
button and panel. That document is third-party content; it has no access to the app's CSS custom
properties or Tailwind classes. Literal colours are the only way to style it.

**`src/components/ui/StudyRichEditor.tsx`** — `"#fff1a8"`, passed as the argument to
`document.execCommand("hiliteColor", false, arg)`. That API takes a colour **string**; it does not
resolve `var(--token)`. A literal is required by the platform.

Both are defensible as written. One genuine sub-question for the owner, not treated as a defect
here: neither adapts to Night Mode. Both *could* — the parent can pass the active theme into the
bridge (it already passes `token`, `stored` and `notesLabel`), and the highlight colour could be
read at runtime via `getComputedStyle(...).getPropertyValue("--token")` before being handed to
`execCommand`. Doing either changes rendered appearance, so it is `OWNER_DECISION_REQUIRED`, not a
silent fix.

---

## 4. Tailwind's fixed default palette — 44 occurrences across 14 files, all legible

This is the finding most likely to be misjudged, because the verifier's message printed only the
**first five** entries (`[...new Set(defaultPalette)].slice(0, 5)`). That made it look like two
writing pages were the whole problem. The true scope is **44 occurrences across 14 files**:

| family | count |
| --- | --- |
| amber | 25 |
| sky | 7 |
| black | 4 |
| red | 3 |
| rose | 3 |
| white | 1 |
| emerald | 1 |

Most affected: `LivePartnerClient.tsx` 8, `ListeningImport.tsx` 6, `TranslationRunner.tsx` 6,
`writing/exam/[id]/page.tsx` 3, `AiExaminerSession.tsx` 3, `DictionaryPanel.tsx` 3,
`DictionaryRecentSearches.tsx` 3, `ExamRunner.tsx` 3, `WritingGradeTab.tsx` 3.

The message is now a summary by family and file count plus three examples. **The criterion is
unchanged** — the check still fails until the palette is migrated or explicitly sanctioned.

### Is any of it an accessibility defect? No — measured, not assumed.

22 of the 44 carry a `dark:` variant; 22 do not. Every unadapted site pairs a pale background with
a dark foreground **from the same family**, so neither half flips with the theme and the pairing
holds in both modes. Contrast ratios computed from the colour values in this product's own built
stylesheet (`.next/static/css/8fd2b9edae0de87d.css`):

| pairing (as used) | ratio | verdict |
| --- | --- | --- |
| `bg-sky-50` + `text-sky-700` — DictionaryPanel chips | 5.57:1 | AA |
| `bg-rose-50` + `text-rose-800` — LivePartner error | 7.30:1 | AAA |
| `bg-amber-50` + `text-amber-900` — LivePartner realtime | 8.75:1 | AAA |
| `bg-amber-100` + `text-amber-800` — TranslationResultView badge | 6.37:1 | AA |

The mixed pairings — a fixed background carrying a **token** text colour — are the real risk,
because `text-ink-700` flips between themes (`58 53 85` day → `226 220 209` night) while
`bg-amber-50` does not. They are safe because the `dark:` variant flips the background too. With
`dark:bg-amber-950/30` composited at 30% over the actual night surface `--paper-raised (17 20 33)`,
giving `rgb(33 22 24)`:

| pairing | ratio | verdict |
| --- | --- | --- |
| Day: `bg-amber-50` + `text-ink-700` | 11.12:1 | AAA |
| Night: `bg-amber-950/30` + `text-ink-700` | 12.91:1 | AAA |
| Day: `bg-amber-100` + `text-ink-900` | 15.07:1 | AAA |
| Night: `bg-amber-900/40` + `text-ink-900` | 12.23:1 | AAA |

**Conclusion: no contrast failure anywhere in the 44 sites.** The finding is palette *consistency*
only — a product-wide visual change spanning 14 files, which §1 places in the protected-design
zone.

### Why this must not be "fixed" file by file

`amber` is the product's de-facto caution colour, used consistently across listening import
warnings, speaking readiness, live-partner unavailability, exam notices and grade highlights.
Migrating only the two pages the old message named would leave 39 sites behind and make the idiom
*less* consistent than it is today. The decision is binary and belongs to the owner:

1. **Sanction** the fixed palette for caution/danger semantics and teach the verifier the
   allowlist, or
2. **Migrate** all 44 sites across 14 files to theme tokens — a visible, product-wide design change
   requiring authorization and its own visual review.

`OWNER_DECISION_REQUIRED`.

---

## Summary

| # | finding | classification | status |
| --- | --- | --- | --- |
| 1 | report textarea has no accessible name | CONFIRMED_PRODUCT_DEFECT | **fixed** `e14f128`, 17/17 |
| 2 | `data-report-toggle` absent from first paint (×2 failures) | OWNER_DECISION_REQUIRED | capability proven working; placement is design |
| 3 | literal hex in 2 components | JUSTIFIED_CONSTRAINT | required by iframe injection / `execCommand`; night-mode adaptation optional |
| 4 | 44 fixed-palette occurrences / 14 files | OWNER_DECISION_REQUIRED | no contrast defect (all AA/AAA); sanction or migrate product-wide |
