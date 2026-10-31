# Listening Test 1 — Part 2 contextual-sense QA checkpoint (2026-10-31)

Branch: `feature/listening-test-1-next-100-senses`. Editorial staging only; do not publish, merge, or deploy.

## Cross-check
- Source: `script-part2-sense-candidates.json` and `script-part2-staged-sense-mapping.json`.
- 719 token records; 690 visible and 29 hidden.
- 291 staged mapping spans, including 26 editorial multi-word spans.
- 0 overlap collisions among staged spans (sorted by start/end).
- 386 visible tokens not overlapped by a staged mapping. This number does **not** imply 386 distinct missing dictionary entries; grammatical words, lexical chunks, and multi-sense candidates must be assessed individually.
- Seven new lexical expressions remain in `script-part2-new-sense-links.pending.json`, awaiting **real immutable-release sense IDs**. Never fabricate IDs.
- 10 unmatched visible tokens have exactly one source candidate sense. **Nine** are explicitly rejected in `editorialQueue.rejected` for wrong contextual sense, including `are` misread as a land-measure noun, `minutes` misread as meeting notes, and `ways` misread as a shipbuilding term. Do not bulk approve unique candidates.
- The tenth is `their` (3137–3142), which lies **inside** pending `on their own` (3134–3146). Resolve the expression as a lexical unit first; do not stage a competing one-word link.
- 13 mapping spans do not match a single lexical token because they are editorial multi-word phrases; this is expected, not automatically an offset defect. Verify against source transcript separately.

## Required next sequence
1. Continue context-sensitive Part 2 editorial resolutions from the actual transcript, not single-sense heuristics.
2. Validate offsets/surfaces and correct dictionary definitions; use base forms for conjugations without losing meaning.
3. Issue the seven new dictionary senses through the proper dictionary editorial/release mechanism and then resolve their occurrence IDs.
4. Complete Part 2 before beginning Parts 3 and 4.
5. Keep releaseStatus NOT_PUBLISHED and leave main/production untouched until complete.

This is an interim QA checkpoint, **not** a claim of completion.
