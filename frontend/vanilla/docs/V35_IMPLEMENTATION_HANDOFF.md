# V35 — actual independent frontend implementation resumed

## Owner correction and workstreams

The current human user identifies as the project owner/original creator and explicitly authorizes whole-site frontend migration within existing constraints. This is not an application account/role and is not Phase2 release approval. Workstream A is ACTIVE independently. Workstream B remains Review Phase2 BLOCKED—OWNER DECISION REQUIRED (specific A–J decision not issued); preserve original packet/evidence. V34's global stop-until-external-input instruction is superseded by this owner's explicit implementation requirement. Do NOT stop unrelated frontend work because Review is pending.

## Real implementation delivered

- `/app/courses/ielts`: replaces unavailable route with original nested course/module/unit/lesson presentation, source StateBadge, ordered server states, locked-link suppression and exact original lesson destinations. Opening a roadmap never writes progress.
- `/app/grammar?tab=writing|speaking`: replaces unavailable conditional route with original per-area topics, source mastery badge/score/progress display, source three-session display constant, exercise counts, unavailable≠zero behavior and local secondary retry. No/emptytab redirect to Lessons remains; unknown nonemptytab selects Writing as original. No mastery engine, question or grading code synthesized.
- Two source-extracted native page renderers and minimized read-only view consumers. Existing shell/router/navigation/theme/localization/auth failure handling and Card/Badge/ProgressBar reused. Original JSX, classes, dictionaries and assets retained; no new component framework or runtime dependency. React19.3.0 was used ONLY outside candidate dependencies as independent reference-render tooling.

## Honest completion inventory

**Newly COMPLETE routes:0. Newly implemented native routes:2, retained PARTIAL.** Global22complete/17partial/69notstarted of108 (formerly22/15/71). No original206-component-file promotions:62complete/17partial/127notstarted; new source-component-file completions0. The two page-local renderers are not counted as two new source components.35Staff canonical routes unchanged/reserved. Last full route-ledger body wasV10; V11–V34 headers did not change its individual statuses. `route-ledger-v35.json` carries the actual updated115records; `component-ledger-v35.json` preserves206records. This is not whole-site completion.

Remaining implementation includes course lesson reader/workspace/video/material dependencies and Grammar topic/activity destinations; links to these existing URLs do not claim those routes migrated. The machine-readable dependency inventory lists every remaining non-Staff canonical route with original component closure/layout/server dependencies, interaction/presentation requirements and excluded author/Dictionary boundaries; all144remaining component files include direct source-component dependencies and hashes. It is a source dependency plan, not arbitrary percentage progress.

## Verification and unresolved results

- Fresh install/build succeeded; all575unit tests PASS, including31new cases. No FAIL/SKIP.
- New browser route interaction cases33PASS/0FAIL/0SKIP. Keyboard navigation, direct entry, reload/Back, locale/theme matrix, source states, error/retry, empty/missing data,401revocation and no-write behavior verified under isolated fixtures.
-24visual fixture comparisons cover1440×900,768×1024,390×844 ×EN/UZ×day/night for both routes. Reference is original React19.3.0 rendering of original JSX + original Card/Badge/ProgressBar, in the migrated shell/extracted sourceCSS using the same isolated metadata. **NOT an original running Next.js/live reference.** Static screenshot test contexts freeze animation times equally; product motion is unchanged, motion parity not certified.
- Initial run18PASS/15FAIL included an incorrect reference serialization (static SSR merged text boundaries) and emptyquery URL assertion. Initial raw failures retained. Reference now uses actual ReactSSR text-boundary separators and pathname redirect checks. The strict visual gate was NOT relaxed. Latest visual results are in `evidence/v35/browser-entry-routes.json`:18exactPASS/6FAIL; all24geometry comparisons equal; remaining measured maximum channel delta1. Earlier corrected comparison had17PASS/7FAIL; not a reliability population or aggregate release rule. Causes of residual raster differences are not established; no perfect-pixel or COMPLETE claim. Browser command deliberately exits1 while these strict comparisons fail.
- Relevant preserved v3/v5/v10 browser regressions PASS49/52/53 (154total), with all prior evidence snapshot/restored; see `evidence/v35/regressions/preservation.json` for exact results. Not claiming a fresh full499/418/timing/control run.

## Existing integration boundary, no backend change

`/api/frontend/view` remains the existing PROPOSED migration read boundary, not a newly deployed API. New read consumers require original server-authorized projection of `getCourseRoadmap("ielts",ownUserId)` and `getTopicMastery(ownUserId,area)`. No duplicate endpoints or backend adapter were created. Production data/authorization/publication and deployed integration remain UNVERIFIED, and preview intentionally returns503 without fixtures. Do not derive permission or states from URL/storage. `ADAPTER_CONTRACTS_V35.md` defines only the minimized client shape and source mapping.

## Next executable independent work

Continue courseLessonWorkspace + existing note writer/state API, then lesson materials/video provider consumers before promoting the lesson route. Grammar topic/existing-API activity consumers are an independent parallel option. Read each original dependency before translating; preserve content, release/ownership and source feedback. Do not wait for Review A–J approval to start these. Keep visual discrepancies separately actionable rather than weakening checks or stopping the whole project.

This is a meaningful Git implementation increment, NOT a new sealed ZIP checkpoint. No V35archive was generated, historical packages/manifests/evidence retained. No main merge or production deployment.
