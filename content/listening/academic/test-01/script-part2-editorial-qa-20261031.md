# Listening Test 1 — Part 2 contextual-sense QA checkpoint (2026-10-31)

Branch: `feature/listening-test-1-next-100-senses`. Editorial staging only. Do not publish or merge an incomplete release.

## Verified inventory
- 719 transcript tokens; 690 visible and 29 hidden.
- **563** staged contextual sense spans; 0 mapping overlap collisions.
- **34** still-unresolved non-exempt visible lexical tokens: giving@68, perhaps@501, run@1044, fresh@1226, air@1232, as@1431, much@1434, as@1439, make@1961, sure@1966, doing@2012, giving@2078, results@2255, such@2453, reception@2745, likes@2788, visitors@2801, down@2921, hoping@3014, computer@3054, room@3063, on@3134, their@3137, own@3143, converted@3187, music@3236, room@3242, probably@3377, used@3470, assembly@3503, hall@3512, feel@3632, free@3637, answers@3801.
- 76 grammatical exemptions, 3 name exemptions, and 1 time notation exemption.
- Pending release lexical phrases: `fresh air`, `reception`, `computer room`, `on their own`, `music room`, `assembly hall`, `feel free`.
- Other protected phrases (`as much as`, `make sure`) must be treated as full lexical units, not arbitrary word-level senses.
- Part 1 has 12 pending lexical sense links after removing 89 optional grammar mappings.
- Base release `rel-v1-1fa06d8d41d8ff701632573e` is immutable. Never invent UUID or assume staged mapping equals lexical occurrence binding.

## Merge gate
- Complete all remaining non-exempt semantic resolutions, including genuine phrases, against accurate dictionary senses.
- Build and validate a new immutable release where required, resolve occurrence entry IDs, sense IDs and meaning hashes, and run hash/offset QA against actual packages.
- `main` and production must remain untouched until merge gate passes.

**Release status: NOT_PUBLISHED. Completion gate: FAILED.**
