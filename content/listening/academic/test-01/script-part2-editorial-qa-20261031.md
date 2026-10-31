# Listening Test 1 — Part 2 contextual-sense QA checkpoint (2026-10-31)

Branch: `feature/listening-test-1-next-100-senses`. Editorial staging ONLY. Do not publish, merge, or deploy.

## Verified current state
- Source candidate tokens: 719 total; 690 visible and 29 hidden.
- Staged mappings: **479**; all sorted and zero overlap collisions.
- Remaining visible, unbound transcript tokens: **198**, across 123 unique case-folded surface forms.
- 35 remaining visible tokens lack any entry candidate in the source inventory. Some are inflections, proper names, or grammar, not automatically new lexical entries.
- Source coverage and offset matching must be checked again before publishing.
- Dictionary pin: `rel-v1-1fa06d8d41d8ff701632573e`.
- **Seven unissued expressions** awaiting real new-release IDs: `fresh air`, `reception`, `computer room`, `on their own`, `music room`, `assembly hall`, `feel free`.

## Lexical safeguards
- Never attach noun `can` to ability modal; noun `will` to future auxiliary; chemical/currency noun `at` to preposition; or land-unit noun `are` to auxiliary verb.
- Never attach isolated `their` or `own` inside pending `on their own` multiword sense.
- Proper names `Springdown`, `Anne Rawson` require entity handling, not invented dictionary senses.
- Inflections and contractions must be linked to correct lemma/function: `I'd` in `I'd like` means `I would`.

## Publication gate (NOT PASSED)
1. Context-check every remaining occurrence against actual transcript and dictionary source; add missing grammar/inflection/phrase senses to a copy-on-write immutable release, with attestations.
2. Resolve genuine lexical expressions to the new release's actual entry and sense IDs, after duplicate detection.
3. Generate/revalidate offset-aligned occurrence bindings against the pinned release and verify all four sections stay unchanged.
4. Run tests; only then consider promotion. Production and main are unchanged by this stage.

**Status: INCOMPLETE / NOT_PUBLISHED.** This document intentionally does not claim Part 2 completion.
