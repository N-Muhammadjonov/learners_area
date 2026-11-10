# RIWI merge readiness — NO-GO

Historical source-only review. For the resumed implementation and executed validation, see the [current-main candidate report](../current-main-integration-20261101/README.md). The original source findings below are preserved as recorded.

This review does not authorize or perform a merge into main or a production deployment.

## Verified source identities

| Source | Commit |
| --- | --- |
| Current main snapshot | `9ad7a8b40b99c0042c7fe5d547db811b7206731e` |
| RIWI integration source | `b6434d1afa9ff3cfa8d53598f83b2cc34576f65c` |
| Previous independent checkpoint | `3f7bdaa9a086cd51f21fd0cedac560763fd5d410` |
| Common ancestor of main and RIWI | `1415ceee45a3fc18583a3b780fffd5cd6c519ae4` |

The full Git trees were compared. There are 106 changed RIWI paths relative to the common ancestor, including 25 paths with conflicting current-main changes. See SEMANTIC_MERGE_MATRIX.json. This is a source comparison, not a completed or tested integration.

The prior 83 passing RIWI/Coach tests belong to checkpoint `3f7bdaa9a086cd51f21fd0cedac560763fd5d410`. They do not certify the current main plus RIWI tree, the newer ONNX implementation, or the complete product.

## Prompt and conversation coverage

The complete governing master prompt, FastAPI V2 prompt and Owner Basebook text were retrieved. All 68 Basebook task definitions were parsed with their focus, teaching method and hard guard. The existing registry has 105 keys; key count alone is not behavioral compliance.

The full conversation named “Kod formatini tayyorlash” could not be opened. Two recovery excerpts were read (1,305 and 834 lines), but they do not contain the complete conversation or exact Phase A–J continuation prompt. The thread reader failed; native app access was denied. This review does not claim a complete conversation review.

The Owner Basebook is now located. Its content is **not missing**. Its semantic integration, test evidence and required policy acceptance remain incomplete. BASEBOOK_TRACEABILITY.json records the available source and candidate historical key mappings, without claiming implementation verification.

## Confirmed blockers

- MIG-001 (P0): RIWI migration ordinals 0072-0074 collide with different current-main migrations.
- PORT-001 (P0): Portability A/B/C table boundaries do not match the governing prompt.
- REG-001 (P1): 105 registered keys do not implement the Basebook's 68 task-specific rule sets.
- EXT-001 (P1): The RIWI chat HTTP handler does not inject an external provider transport.
- LOCAL-001 (P1): New ONNX local evaluator is not used by the source branch's existing Coach internal evaluator.
- BB-001 (P1): Basebook ingestion can certify compliance from keyword coverage without executed acceptance tests.
- META-001 (release_evidence): 271 endpoint metadata differences remain unresolved for business behavior and database provenance.
- ENV-001 (execution_blocker): Execution environment became unavailable before current-main integration and final native tests.
- SOURCE-001 (source_blocker): The full named conversation and exact Phase A-J continuation prompt were not accessible.

Full source locations, observed behavior and required remediation are in FINDINGS.json.

Migration ordinals 0072–0074 have different meanings on the two branches. At this snapshot, a possible additive RIWI suffix begins at 0075, but the target tip must be remeasured before writing the real chain. Existing applied history must not be rewritten or replaced. No migration was generated or applied during this review.

The portability mismatch is material: the governing prompt requires A = approved full system, B = RIWI-only, C = site-only. The current source uses a common knowledge/content set for A, adds governance signals for B, and adds users together with RIWI conversations and Speaking sessions for C. No export/import was executed during this review.

The task registry currently generates generic task rules. Basebook ingestion also uses keyword/domain coverage to set a compliance certificate. Neither mechanism is evidence that the 68 source contracts are implemented and independently tested.

The source HTTP chat route leaves external_runner unset, so its externally configured gateway path is not connected through that handler. The added ONNX evaluator is also not dispatched by the source Coach internal() function. Existing main uses shared ai_runtime admission and a user_id-aware resolver; preserve those controls while integrating any evaluator or provider changes.

## Execution status

The execution host became unavailable while preparing the current main snapshot. Local edits, builds, Python/JavaScript tests, native PostgreSQL rehearsals and browser verification of a combined candidate could not continue. Partial source preparation is not an integrated candidate.

Only source/metadata checks were completed after that interruption. No new backend test result is claimed. Prior test receipts remain historical and unchanged. No shared database, object store, provider, preview or production mutation was performed by this review.

## Resume order

1. Recover access to the full conversation/continuation prompt and recorded owner decisions. Reconnect the execution workspace and preserve any incomplete local preparation.
2. Re-fetch main, RIWI and this audit branch. Reconcile any drift. Build an isolated integration branch from current main and deliberately port RIWI changes using the source matrix.
3. Resolve the additive migration suffix, preserving main's AI admission, Live Classes, Mock schema and migration history. Rehearse native PostgreSQL fresh and populated upgrades.
4. Correct portability mode classification and native transactional import/export boundaries before enabling portability.
5. Integrate all 68 actual Basebook contracts into the existing canonical registry/composer, with truthful parsed/mapped/verified states and source/version provenance.
6. Wire provider and local evaluation through the existing authorization, budget and canonical task paths. Validate independence and confidence rather than treating synthetic reference labels as examiner truth.
7. Run focused and full native backend/frontend/build/security/role/exam/privacy tests on an exact frozen combined tree. Preserve and review all 271 endpoint metadata differences.
8. Complete only the specifically authorized external acceptance and owner-policy gates required by the governing prompts. Missing evidence remains open.
9. Present the exact tested merge candidate and ask the Owner for permission **before** merging into main. No merge request is being made now because the candidate is not ready.

## Assessment

- Implementation complete: no.
- Current-main integration complete: no.
- Final combined tree tested: no.
- Mandatory evidence accepted: no.
- Merge into main approved: no.
- Production deployment approved or performed: no.

No readiness percentage is assigned. Missing code integration and blocked validation cannot be represented as 100%.
