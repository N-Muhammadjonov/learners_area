# V38 Listening — GPT Work handoff

**Status: Listening NOT COMPLETE. No route, component, or workflow promoted in V38.** Baseline for this handoff: V37 `79a289298f25a26e4804168df9d228129294a024`; V38 commit recorded in the implementation report and final chat message.

## What is safe to rely on

- Native Listening owners are unchanged except two repairs: `modules/listening/legacy.js` (legacy exam submit error mapping through `request-errors.js` `failure(e,dict)`) and `modules/listening/mcq.js` (MCQ Day reasoned completion uses replaceState + refresh, verified by a discriminating focusin check).
- Mandatory regression at this commit: units 605/0/0; browser 499/0; actual-source 418/0/0; timing 14/0; equivalent controls 2/0; V38 focused 5/0/0. Evidence: `docs/evidence/v37/v38-final/`, `docs/evidence/v38/`.
- Historical evidence and the 32 original Listening sources are not edited in this branch (`src/` diff is empty).

## What is NOT safe to rely on

- Strict visual: 66 PASS / 6 FAIL (V37). The six FAILs are open: revision 1440 EN/UZ day/night, revision 768 EN night, hub 768 UZ day. Cause not identified. Do not raise tolerance or change palette to hide them.
- Routes: all six learner routes remain IN PROGRESS. Work not done: see `V38_LISTENING_ROUTE_CLOSURE_MATRIX.md` and `V38_LISTENING_IMPLEMENTATION_REPORT.md` §13.
- Live integration (`/api/frontend/view`, authorized catalogue, own-attempt states): UNVERIFIED. The preview API returns 503 by design.
- Review Phase2 A–J: unsigned owner decision; BLOCKED. Do not claim release approval.
- Script Tests 10 and 25: BLOCKED on authoritative external timing data. No clamping, guessed timestamps, or timestamp edits. Tests 11/22 storage-key discrepancy needs source authority.

## Candidate for GPT Work integration

- Candidate: **Full IELTS Test** (carried from V37, historical FRONTEND CODE COMPLETE scope). V38 does not recommend integration: the route's visual FAILs and unverified live paths are unresolved, and the owner has not selected it.
- Integration remains a separate, main-based branch. Do not merge this Arena branch into main. No deploy.

## Next actions, in order

1. Hub: resolve the hub 768 UZ day strict visual FAIL from the source (styles, tokens, theme timing, rasterization, fonts, icons), without changing tolerance or palette.
2. Hub and activity: keyboard/touch/back-forward/reload/disposal verification; per-source journeys for Map, Choose TWO, Completion, Vocabulary.
3. Attempt detail and revision: investigate the five revision FAILs; verify evidence navigation, focus and modal behavior for each source.
4. MCQ library and Day: live-independent loading/error/retry checks; day validation and correct-answer disclosure audit.
5. Milestones 4–8 (shared components, remaining workflow controls, cross-route navigation and lifecycle, visual, final regression and handoff) after the above.

## Owner decisions (separate from implementation)

- Phase2 A–J release decision (BLOCKED, unsigned).
- Authoritative external data for Tests 10 and 25.
- Source authority for Tests 11/22 storage-key discrepancy.
- Candidate selection for GPT Work integration.
