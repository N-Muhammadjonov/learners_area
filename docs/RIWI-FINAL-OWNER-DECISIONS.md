# RIWI final owner decisions

Status: **AWAITING OWNER**. These decisions are not inferred. Selecting an option does not authorize Production cutover.

## D-01 — RIWI conversation destructive retention

- **A:** Accept the implemented 30-day expiry and latest-60-message cap.
- **B:** Keep 30 days and provide a different cap.
- **C:** Provide replacement expiry and cap values.
- **Recommended:** A, because it preserves the tested privacy-bounded implementation.
- **Consequences:** Data outside either boundary is irreversibly pruned after backup expiry; increasing retention later cannot restore it.
- **Blocks:** final destructive-retention acceptance.

## D-02 — Speaking audio/transcript retention

- **A:** Audio 30 days; raw/reviewed transcript 90 days; transcript-free attempt/evaluation metrics 24 months; 7-day deletion grace; orphan retry within 24 hours; explicit recorded legal/safety holds only.
- **B:** Audio 90 days; transcript/evaluations 24 months; 14-day grace; orphan retry within 24 hours; recorded holds.
- **C:** Supply custom values for every listed class/interval.
- **Recommended:** A for data minimization.
- **Consequences:** Implementation and lifecycle tests are required; deleted voice/transcript data cannot later be recovered merely by extending policy.
- **Blocks:** Speaking privacy and Mode A/C retention acceptance.

## D-03 — RPO/RTO target

- **A:** RPO 15 minutes / RTO 4 hours.
- **B:** RPO 1 hour / RTO 8 hours.
- **C:** RPO 24 hours / RTO 24 hours.
- **Recommended:** A if provider capability supports it, otherwise B.
- **Consequences:** A selected target is not evidence of achievement; provider receipt and measured restore drill remain mandatory.
- **Blocks:** contractual backup/DR acceptance.

## D-04 — Object-storage migration strategy

- **A:** O1 keep-R2 for initial cutover, plus isolated-prefix O2 acceptance test.
- **B:** O2 move-objects after isolated acceptance.
- **C:** Defer storage migration and external acceptance.
- **Recommended:** A; it avoids production object movement while permitting real O2 proof.
- **Consequences:** Private authorization remains mandatory. O2 source deletion is forbidden until the rollback window ends.
- **Blocks:** real O1/O2 acceptance and cutover plan.

## D-05 — Dedicated isolated Preview

- **A:** Authorize this assigned branch on a disposable isolated Preview, isolated database/object prefixes, and four QA roles.
- **B:** Authorize deployment only and provide existing isolated resources/QA identities.
- **C:** Do not authorize Preview.
- **Recommended:** A.
- **Consequences:** Only disposable QA data may be created/deleted; secrets must be configured in the platform, never supplied in chat or Git.
- **Blocks:** authenticated role/browser and live-provider deployment evidence.

## D-06 — Shared Preview migration

- **A:** Authorize 0048 plus only genuinely pending canonical migrations on a precisely identified shared Preview target after a verified safety point.
- **B:** Authorize read-only preflight and GO/NO-GO packet only.
- **C:** Do not access shared Preview.
- **Recommended:** B now; A only after isolated gates and target identity proof.
- **Consequences:** Only A closes shared Preview migration acceptance. Rollback uses a provider safety point, not a fabricated down-migration.
- **Blocks:** shared Preview migration/role smoke.

## D-07 — Backup/PITR inspection and isolated restore

- **A:** Authorize read-only provider inspection and restore into a new isolated target; no Production settings change.
- **B:** Authorize receipt inspection only.
- **C:** Do not authorize provider access.
- **Recommended:** A.
- **Consequences:** Restored private data must remain isolated and be deleted/quarantined by policy; source remains untouched.
- **Blocks:** backup/PITR and measured restore evidence.

## D-08 — Assessment-policy workflow

- **A:** Accept the immutable 68-contract hard core and exact-hash owner-overlay candidate/preview/approve/version/rollback boundaries.
- **B:** Request a precise overlay-field change.
- **C:** Defer acceptance.
- **Recommended:** A.
- **Consequences:** Hard-core rubric, answer truth, tools and Reporter paths remain immutable; historical versions/evaluations are never rewritten.
- **Blocks:** consequential policy acceptance.

## Required external actions

- **E-01:** Securely upload the exact original Listening package specified by `LISTENING-SOURCE-ZIP-CONTRACT.md`. Repository `booster.zip` is explicitly not equivalent.
- **E-02:** After authorization, configure database/provider/object-store secrets in the platform environment. Never paste credentials into chat, Git, logs or reports.
- **E-03:** Provide or authorize creation of active student, teacher, admin and owner QA identities in isolated Preview.
- **E-04:** After D-07, provide a non-secret backup/PITR receipt or read-only provider access.

Production authorization is deliberately absent. It may be requested only after a complete GO/NO-GO packet exists.
