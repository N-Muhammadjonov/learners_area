# Listening Test 1 — partial editorial snapshot on main

Source branch: `feature/listening-test-1-next-100-senses`
Imported through source commit: `17e53d7106473cecd893038fa45fdba2ced1c5d5`

## QA results for imported snapshot
- Part 1: 744/744 visible transcript tokens accounted for by staged mappings, grammatical exemptions, proper-name exclusions or pending lexical targets.
- Part 1: 577 staged sense mappings; 12 genuine lexical pending targets remain.
- Part 2: 670/690 visible transcript tokens accounted for by staged mappings, exemptions or pending lexical targets. 20 visible lexical tokens are not yet accounted for.
- Part 2: 563 staged sense mappings; 7 new-release lexical targets remain.
- Offset/overlap checks for staged mappings and phrase integrity passed.

## Runtime and release boundaries
- This import is editorial staging, **not** a published dictionary release.
- The stable dictionary release remains `rel-v1-1fa06d8d41d8ff701632573e`.
- No listening lexical occurrences were applied to production, no pending sense IDs were substituted or fabricated.
- No backend/database migration or runtime frontend change was imported.
- The unfinished strict release merge gate was intentionally not imported because it fails while pending lexical releases remain.
- Pending work continues in the feature branch. Do not interpret a successful Git merge as dictionary publication.
