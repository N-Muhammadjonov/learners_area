# RIWI current-main candidate — NO-GO for release

Latest status: [2026-11-02 completion/training review](../completion-20261102/README.md). Conditional merge authorization has been received; the full-capability condition is still unsatisfied. The validation below is the earlier frozen checkpoint's evidence.

The audited RIWI checkpoint has been integrated into an isolated branch based on current main `d62a2302a8dee9e72ccd6e7812a5ca7c7e4f50ec`. The latest local code checkpoint is `0828ef56111b46b65abc399a58ea66542379bdce`. During review main advanced by four commits through PR #110. All 38 changed main files, including the new private Mock Speaking capture migration, were retained and the combined candidate was tested again. No merge into main, production deployment, shared database migration, object-store write or paid provider call was performed.

The earlier [source-only review](../merge-readiness-20261101/README.md) remains historical evidence. This report supersedes its execution/integration status, while preserving its source snapshots and unresolved evidence.

## Implemented in this candidate

| Area | Change and evidence | Remaining limit |
| --- | --- | --- |
| Current-main integration | Main's FastAPI/Vanilla runtime, shared actor-aware AI admission, Live Classes and Mock paths retained; RIWI adds 31 routes to main's 309. | Route registration and passing tests do not resolve the 271 historical endpoint provenance differences. |
| Migrations | Main's applied prefix retained byte for byte; RIWI appended as 0075–0079 with backend mirrors. Fresh install and populated upgrade include both main platform migrations and match. All 152 pre-existing table snapshots remain unchanged; 16 new private tables use RLS. | Executed with PostgreSQL WASM. Native server and a divergent historical RIWI database remain untested. |
| Portability | All 168 tables and their columns classified. A = approved full-system classes, B = RIWI knowledge/policies, C = site-only classes. New private Mock Speaking captures are included only in encrypted A/C and excluded from B. Encrypted authenticated v2 bundles, strict validation and atomic isolated dictionary import; unsafe v1 semantics rejected explicitly. | The import adapter is an isolated dictionary adapter. Native database restore, full identity relationships and real destinations are not certified. |
| Basebook | All 68 actual focus/method/guard rule sets mapped into the existing registry; 105 historical keys retained. Coach and Writing derive task type from server metadata. Machine checks cover literal evidence, Writing criteria, non-band tasks and transcript-only Speaking limits. | Rule composition and machine fixtures are not examiner validation, complete semantic compliance or IELTS calibration. Exact source binary materialization/hash is still unavailable. |
| Owner overlays | Real schema, transactions, per-scope locks, immutable version/content hash confirmation, audited approval and rollback as a new version. Existing Owner UI exposes the workflow. | No real Owner acceptance receipt is invented; D01–D08 decisions remain pending reconciliation. |
| Providers | HTTP chat injects OpenAI/Anthropic/Gemini transports through existing `ai_runtime.request_json(actor_id, ...)`. Fixed endpoints, privacy guard, bounded responses and per-actor admission retained. In-flight waiters are released on cancellation/audit failure. | Wire formats and API-to-transport behavior tested using mocks. Live credentials, provider behavior, spend acceptance and output quality are unverified. |
| Canonical tools | Dictionary uses the active immutable release and exact occurrence sense. Grammar reads published explanations. Lessons use current curriculum/enrollment tables. Reports use actual evaluation columns, time windows and correct teacher links; Admin receives operational counts only. | Real four-role browser, microphone and R2/Worker acceptance remain open. |
| Historical answers | Reading/Listening explanations read the exact attempt-bound content revision, including revision-owned passage/order mappings. Changed current keys do not replace historical evidence. Missing evidence and unassessed outcomes are explicit. | Unversioned historical attempts cannot acquire an invented historical answer key. |
| Knowledge citations | Active knowledge retrieval now returns its real unit identifier, fixing the chat 404 when citing an approved source. Teacher correction SQL uses current link columns. | These database checks do not certify all governance concurrency or product acceptance gates. |

The independent evaluator remains opt-in (`RIWI_EVALUATION_MODE=independent-v1`); it provides limited pattern feedback and withholds unsupported subjective bands. The newer feature branch's ONNX/synthetic accuracy claims have not been adopted as proof of IELTS validity. No environment flags were enabled on a live service.

## Executed validation

| Check | Result |
| --- | --- |
| Complete backend suite | **3308 passed**, 36 subtests passed; **2 failed at TCP bind due to host restrictions**. Overall exit 1, not a clean pass. |
| Complete frontend suite | **1270 passed, 0 failed, 11 skipped** because the private original `Listening_Test_1.html` fixture is unavailable. |
| Native asset build | Passed with project Python venv: 513 assets, 125 browser routes, revision `a21fb4c3543fed2d9394`. |
| Owner policy PostgreSQL probe | 14 store checks + 5 HTTP checks passed against 80 migrations / 154 typed tables. |
| Current-main Mock / Writing probes | 91 Mock and 19 Writing HTTP checks passed against the combined candidate. |
| Canonical domain PostgreSQL probe | 32 store checks + 7 HTTP assertions across 5 requests passed, including HTTP → provider transport and knowledge citations. Provider network calls: zero. |
| Migration rehearsal | Fresh install and populated current-main upgrade passed; original table values and migration prefix preserved; direct-client reads denied for 16 private tables. |
| Python compilation / diff whitespace | Passed. |

Reproduction commands, test identifiers, code-file hashes and raw workspace-log hashes are in [VALIDATION.json](VALIDATION.json). PostgreSQL probe receipts are in [DOMAIN_POSTGRES.json](DOMAIN_POSTGRES.json), [OWNER_POLICY_POSTGRES.json](OWNER_POLICY_POSTGRES.json) [MOCK_POSTGRES.json](MOCK_POSTGRES.json), [WRITING_POSTGRES.json](WRITING_POSTGRES.json) and [MIGRATION_REHEARSAL.json](MIGRATION_REHEARSAL.json). The dependency environment reused the existing project packages read-only; missing pinned wsproto 1.3.2 source was verified against official GitHub blob hashes. A fresh network dependency installation was not possible.

The migration preservation fixture seeds one learner and one historical content revision; other pre-existing tables are empty in that rehearsal. This is not a production-data migration rehearsal.

## Release gates still open

1. Run the two real TCP/WebSocket tests and native PostgreSQL fresh/populated/divergent-history rehearsals in an environment with the required server access. Local bind denial and denied Docker access have not been counted as passes.
2. Reconcile all 271 saved endpoint business/database provenance differences against the frozen candidate. Current-main metadata snapshots remain intact.
3. Recover the full named conversation and exact Phase A–J continuation prompt, verify the Basebook binary source identity and reconcile recorded Owner decisions D01–D08. Full master/FastAPI/Basebook extracted text was read; partial recovery transcripts are not represented as the full conversation.
4. Validate independent subjective assessment with an appropriate calibrated model and independent examiner evidence. Authored synthetic objective cases cannot establish IELTS band accuracy.
5. Complete specifically scoped live provider, four-role browser/microphone, dictionary Worker/R2, real portability destination/restore, backup/PITR and RPO/RTO acceptance.
6. The Owner has since authorized merging after completion and successful validation. That condition remains unsatisfied; see the current review. Production deployment remains unauthorized.

There is no readiness percentage or “100% complete” claim. This branch is a concrete review candidate with substantial local implementation and validation; mandatory release evidence is still incomplete.
