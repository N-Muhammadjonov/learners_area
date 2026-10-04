# RIWI implementation ledger

Statuses: `PASS`, `FAIL`, `BLOCKED`, `EXTERNALLY UNVERIFIED`, `OWNER ACTION REQUIRED`, `NOT APPLICABLE WITH REASON`.
This is the phase checkpoint ledger; the final requirement-by-requirement acceptance ledger will be `docs/RIWI-FINAL-ACCEPTANCE-LEDGER.md`.

## Start checkpoint

- Starting session branch: `arena/01a10332-learners-area`
- Starting SHA: `a83351a3d2fcc2e81fc024e5e1a308f3410864b9`
- Required `origin/feature/riwi-full-build`: same SHA.
- Remote `origin/arena/learners-area-next` observed at the same SHA.
- Worktree: clean before implementation.
- Production touched: NO.
- Shared Preview touched: NO.
- Provider live call: NO; existing provider-matrix evidence says no key is configured in the QA environment.

## Checkpoint 0 — forensic baseline

| Requirement | Status | Evidence / notes |
|---|---|---|
| BASE-001 — baseline relation | PASS | Starting Arena HEAD equals the requested RIWI feature baseline and the observed current integration SHA. |
| BASE-002 — preserve work | PASS | Worktree was clean; no unknown files/process residue was removed. |
| FOUND-001 — current-state truth table | PASS | `docs/RIWI-CURRENT-STATE-TRUTH-TABLE.md`; source/tests/migrations mapped. |
| FOUND-002 — distinguish evaluator from system | PASS | `docs/RIWI-ARCHITECTURE.md`; current Coach provider is preserved as a component, not claimed as the whole system. |
| Prompt review | PASS | Two-pass review completed from the authoritative full-scope prompt/context carried in this task: pass 1 captured the functional Phase 0–20 build; pass 2 captured security boundaries, migration approvals, external evidence, and non-claims. The prompt remains controlling; each detailed requirement is to be linked to code/tests/evidence in the final ledger. |
| Baseline unit suite | PASS with skips | `npm test`: 947 passed, 0 failed, 90 skipped (including external source/provider gates; skips are not PASS). |
| Baseline UI suite | PASS | `npm run test:ui`: 205 passed, 0 failed. |
| Baseline typecheck | PASS | `npm run typecheck`. |
| Baseline lint | PASS | `npm run lint`. |
| Baseline runtime | PARTIAL | Installed lockfile dependencies; Node 22.22.3 is below declared Node 24.x engine. |
| Migration generator baseline | PASS for forward generation; historical metadata PARTIAL | Added generator-produced `drizzle/meta/0035_snapshot.json` as a current-schema anchor linked to 0027; the journal is byte-for-byte unchanged. `drizzle-kit check` passed; official generation against the repaired baseline reported no changes; a temporary one-table probe generated only its one table with a linked snapshot. Historical 0028–0034 snapshots remain absent and are explicitly not claimed restored. No migration was applied. |
| Shared Preview migration apply | OWNER ACTION REQUIRED | Not requested or attempted. |
| Provider live verification | EXTERNALLY UNVERIFIED | No live call made; credential presence is checked by name only before any possible live test. |
| Listening source package | OWNER ACTION REQUIRED | `LISTENING_SOURCE_ZIP` not supplied/proven by this phase; source tests remain skipped. |
| W13 author content | OWNER ACTION REQUIRED | Existing content contract remains authoritative; no content invented. |
| Live Partner / R2 acceptance | EXTERNALLY UNVERIFIED | Not re-run in Phase 0; preserve existing evidence and re-test only if RIWI code changes affect these paths. |

## Checkpoint 1 — deny-by-default capabilities and row-scope policy

| Requirement | Status | Evidence / notes |
|---|---|---|
| Explicit role capability matrix | PASS | `src/lib/services/riwi/capabilities.ts`: finite capability registry and explicit student, teacher, admin, and owner lists; unknown values deny. Admin does not inherit teacher or owner powers. Owner rights are explicitly enumerated and remain product-bounded. |
| Server-derived active actor policy | PASS | Capability authorization requires an active server-derived actor; inactive actors and unregistered capabilities are denied. Request data is not treated as identity or role authority. |
| Student and teacher row scope | PASS | Students resolve self only. Teacher target rows must be active students and pass the authoritative roster dependency; lookup/roster errors and unmapped scopes deny, with missing/unassigned subjects indistinguishable. |
| Admin and owner scope | PASS | Admin report scope is limited to its registered operational capability and active student subjects; admin user scope excludes owner/other unbounded accounts. Owner global scope has no caller-supplied row id; targeted owner scopes still require an existing subject. |
| Capability/security tests | PASS | `node --conditions=react-server --import tsx --test tests/riwi-capabilities.test.ts tests/riwi-security.test.ts`: 14 passed, 0 failed. New six-test suite covers explicit grants, inactive/unknown denial, self-only, assigned-roster, admin/owner scope, and unknown scope denial. |
| Typecheck | PASS | `npm run typecheck`. |
| Patch hygiene | PASS | `git diff --check`. |
| Shared Preview / Production | NOT TOUCHED | No migration or deployment applied. |

## Phase 3 — Checkpoint 2 — safe tool registry and broker

| Requirement | Status | Evidence / notes |
|---|---|---|
| Finite tool registration | PASS | `src/lib/services/riwi/tool-broker.ts` validates registered capability, risk class, external-data class, role allowlist, strict Zod schemas, idempotency mode, required audit, and a 1–60 second timeout. Contract and role allowlist are copied/frozen at registration. |
| Authorization and scope before handler | PASS | Every call rechecks the active actor capability and explicit allowed role, strictly parses input, resolves row scope, and refuses before handler execution on any denial. Output is schema-validated. |
| Audited bounded execution | PASS | Audit is mandatory and audit-start failure blocks handler execution. Tool name, output, role, and scope are not inferred from model text; unknown-name audit omits the untrusted name. Handler timeout and client abort race execution and signal cancellation. |
| Mutation and outbound guardrails | PASS | Reversible/high-impact registrations require confirmation plus an idempotency mode. The generic broker returns a confirmation-required denial and never executes these handlers; outbound registrations require the sanitized data class. No arbitrary execution primitive is registered. |
| Broker regression tests | PASS | `node --conditions=react-server --import tsx --test tests/riwi-tool-broker.test.ts`: 3 passed, 0 failed (registration immutability, authorization/schema/scope/output, audit failure, confirmation gate, unknown-name redaction, timeout, and cancellation). |
| Typecheck | PASS | `npm run typecheck`. |
| Patch hygiene | PASS | `git diff --check`. |
| Shared Preview / Production | NOT TOUCHED | No migration or deployment applied. |

## Phase status

| Phase | Purpose | Status | Checkpoint |
|---|---|---|---|
| 0 | Forensic baseline | PASS | Docs and baseline tests recorded. |
| 1 | Capability and policy core | PASS | Checkpoint 1 evidence above; accepted remote checkpoint `7f8c5cf`. |
| 2 | Distinct RIWI Request Gateway | PASS for the dependency-injected gateway boundary; authenticated route/database integration remains open | Checkpoint 5 below; server-derived identity, finite planning, scopes, feature/exam policy, provider and tool allowlists, minimized context, validated output, correlation/audit and security tests. |
| 3 | Safe Tool Registry/Broker | PASS | Checkpoint 2 evidence above; accepted remote checkpoint `5c4122e`. |
| 4 | Dictionary Connector | PASS for canonical service/PostgreSQL integration | Checkpoint 6 covers exact-sense lookup, unknown and learner-provided rejection, ambiguity, Reading/Listening exam locks, role-safe staff access, and authorized/stale occurrence resolution. Full chat/browser integration is Phase 12. |
| 5 | Knowledge Source Model | PASS for the bounded model, parser, and lifecycle | Checkpoint 7; authenticated owner workflow and safe upload integration remain open in later integration phases. |
| 6 | Retrieval | PARTIAL | Active approved-source retrieval is role-scoped; end-to-end relevance, conflict and integration acceptance remain open. |
| 7 | Provider Router | PARTIAL | Registry-backed task routing and outbound guards exist; full integration/performance/provider QA remains open. |
| 8 | Provider Evaluation Lab | OPEN | Fixed-fixture owner lab checkpoint remains pending; live provider validation is EXTERNALLY UNVERIFIED. |
| 9 | Learning Signal Pipeline | PARTIAL | Candidate-only signals, review and regression evidence exist; end-to-end product integration remains open. |
| 10 | Owner Governance UI | OPEN | Full knowledge/learning moderation and governance UX remain open. |
| 11 | Role-Specific UX | OPEN | Full role/browser acceptance remains outstanding. |
| 12 | Feature Integration | OPEN | Authenticated chat-to-feature and client integration acceptance remains outstanding. |
| 13 | Adversarial Security | PARTIAL | Checkpoint 5 covers required gateway cases; full red-team pass remains open. |
| 14 | Performance/Stability | OPEN | Load, concurrency and stability acceptance remains outstanding. |
| 15 | Migrations and real PostgreSQL | PASS for isolated local QA; shared Preview apply is OWNER ACTION REQUIRED | Checkpoint 3 records 39/39 local migrations and the upgrade/backfill probe; no shared environment was touched. |
| 16 | Preview | OWNER ACTION REQUIRED | No shared Preview deployment or migration apply has been attempted. |
| 17 | Live external-provider QA | EXTERNALLY UNVERIFIED | No owner-controlled secret was used and no provider request was sent. |
| 18 | Browser role QA | OPEN | Browser-based role acceptance remains outstanding. |
| 19 | Final red team | OPEN | Final adversarial review remains outstanding. |
| 20 | Owner acceptance | OWNER ACTION REQUIRED | Not requested or claimed. |

## Checkpoint 3 — outbound security and RIWI foundations (verified and pushed)

| Requirement area | Status | Evidence / limitation |
|---|---|---|
| Connection-time DNS pinning / rebinding | PASS for the transport invariant | `src/lib/services/coach/providers/shared/ssrf.ts` resolves and validates every answer, then passes only that snapshot to Node `https.request`'s socket-time `lookup`; a different host/family is refused. `tests/ssrf-pinning.test.ts` covers callback-level resolver rebinding and a real local TLS socket using the pinned lookup, with original SNI/certificate-name verification. |
| SSRF URL/address policy | PASS for covered cases | HTTPS only; credentialed URLs including empty userinfo, default port only, no query/fragment, internal/single-label names, configured allowlist, IPv4/IPv6 special/private ranges, IPv4-mapped IPv6, mixed-answer denial, DNS error/empty/malformed/timeout/abort, no redirects, request abort/deadline, response/TLS bounds. Live external network/provider verification remains EXTERNALLY UNVERIFIED. |
| External evaluation DTO / minimization | PASS for registered task schemas | Central guard is applied by the resolver and adapter, rejects extra app/authority fields, redacts direct identifiers before truncation, and covers writing, writing-check, speaking, grammar, vocabulary, assignment, and chat. Direct tests inspect actual adapter payloads. |
| Dictionary connector | PARTIAL | Canonical catalogue is used and student exam locks are enforced server-side. Finite English/Uzbek/Russian extraction/formatting has focused tests; full API-to-database canonical/occurrence regression is still pending. |
| Knowledge lifecycle/retrieval | PARTIAL | PGlite tests exercise inert candidate, rights, scope, lexical conflict review, supersession, active-only role retrieval, and linked regression evidence. Owner routes/UI and safe file-upload integration are still pending. |
| Learning evidence | PARTIAL | PGlite tests cover redaction, candidate-only state, student self scope, teacher roster scope, owner review, regression evidence, and no auto-publish. Owner moderation routes/UI remain pending. |
| Chat/conversation foundations | PARTIAL | Strict request/response contracts, finite intents, rollout defaults, origin/body bounds and actor-scoped, expiring bounded conversations have focused tests. Authenticated HTTP/UI integration tests remain pending. |
| Drizzle migrations | PASS on isolated local PostgreSQL for current journal | Official generation produced 0036–0038; `drizzle-kit check` and no-change generation pass. `npm run qa:pg` applied 39/39 migrations to isolated `learners_qa2`. A populated 0037→0038 upgrade/backfill probe passed and was cleaned up. Preview is OWNER ACTION REQUIRED; Production untouched. |
| Focused tests | PASS | Node 22.22.3: `node --conditions=react-server --import tsx --test tests/riwi-*.test.ts tests/ssrf-pinning.test.ts tests/universal-ai-providers.test.ts` — 50 passed, 0 failed. Node 24.21.0: `tests/ssrf-pinning.test.ts`, `tests/universal-ai-providers.test.ts`, and `tests/riwi-dictionary.test.ts` — 20 passed, 0 failed. |
| Typecheck / lint / patch hygiene / migration metadata | PASS | `npm run typecheck`, `npm run lint`, `git diff --check`, and `npx drizzle-kit check --dialect=postgresql --out=drizzle` passed. |
| Full unit/UI/lint/build/canonical QA | NOT RUN for this continuation | Required final gates remain outstanding; the focused commands above are not substitutes. Declared Node 24 API behavior and Node 22.22.3 test behavior are both covered for the SSRF transport. |
| Owner/provider-lab/UI workflows | NOT STARTED | No owner RIWI control room API, provider experiment service, or moderation UI has been committed in this checkpoint. Missing live credentials do not block deterministic/code work. |

## Checkpoint 5 — Phase 2 RIWI Request Gateway (tested locally; route/database acceptance remains open)

| Requirement area | Status | Evidence / limitation |
|---|---|---|
| Distinct request gateway | PASS for the service boundary | `src/app/api/riwi/chat/route.ts` retains origin and IP controls and delegates to `runRiwiGateway`; the gateway owns active server authentication, account rate limit, bounded DTO parsing, authoritative locale, rollout, plan, scope, execution, output, audit and persistence. |
| Identity, role and locale authority | PASS | Strict request DTO rejects `userId`, `role`, `locale`, provider and tool fields. The gateway derives active actor and locale from `requireActiveUser`; learner targets remain requests that require live scope resolution. |
| Finite intent, capability, risk and exam policy | PASS for covered intents | Classifier has explicit confidence and safe unknown/unsupported handling. Each supported plan uses fixed capability/tool/provider names; missing/disabled feature policy, denied capability/scope and student exam restrictions fail closed. |
| Safe planning and registered execution | PASS | Tool plans must exist in `riwiToolBroker`; the broker repeats capability/input/scope/audit checks. Provider success is checked against the server registry for external `riwi-assistant` capability. Provider output is normalized once and never replanned into another call. |
| Context minimization and result validation | PASS for tested path | Outbound payload contains only language, message, up to six history turns and up to five bounded knowledge excerpts; direct identifiers are redacted before truncation. Strict provider/tool output schemas, citation mapping and report-scope checks protect the response. |
| Correlation and audit | PASS for tested paths | Authenticated requests carry correlation through normal responses and invalid-body errors. Start/completion/denial metadata is allowlisted; required start-audit failure blocks execution. |
| Required gateway security tests | PASS | `node --conditions=react-server --import tsx --test tests/riwi-request-gateway.test.ts` — 9 passed, 0 failed. Covers student self/cross-row, teacher assigned/unassigned, admin owner-only denial, owner global report, inactive actor, authority spoofing, unknown/unsupported/low-confidence handling, registered-tool-only planning, no provider-to-tool second call, correlation, role-safe output, audit, minimized/redacted context, provider rollout/registry, and exam denial. |
| Typecheck / targeted lint / patch hygiene | PASS | `npm run typecheck`; targeted ESLint on gateway, contracts, route and test; `git diff --check`. |
| Authenticated HTTP/database/browser integration | OPEN | The dependency-injected security suite does not replace route-level session/database tests, full browser role QA, performance testing, provider credentials, or final red team. No Preview or Production environment was touched. |

## Checkpoint 6 — Phase 4 Dictionary Connector (PostgreSQL-backed service/occurrence tests pass)

| Requirement area | Status | Evidence / limitation |
|---|---|---|
| Canonical dictionary connection | PASS | RIWI lookup reads the shared `lexemes` catalogue, preserves exact canonical sense, translation, example, collocations, verification state and stored pronunciation; user-provided terms are excluded and ambiguous spellings remain unresolved. |
| Reading/Listening exam policy | PASS for service boundary | Active student Reading and full Listening attempts return `locked`; submitted Reading review and Listening Review/Control allow only the relevant checked sense. Staff access remains separate from student exam locks. |
| Occurrence authority | PASS for Reading and Listening service paths | PGlite-backed tests resolve only the actor-owned source and occurrence, verify current source offsets and sense, deny foreign/fabricated ids, keep stale offsets unresolved, and return bounded revisit snapshots. |
| Database injection seam | PASS | `lookupCatalogue`, dictionary lookup, lexical details, and Reading/Listening occurrence resolution accept the application database dependency while retaining `db` as their production default. No deployment or migration was changed. |
| Focused tests | PASS | `node --conditions=react-server --import tsx --test tests/riwi-dictionary.test.ts tests/riwi-dictionary-db.test.ts tests/vocabulary-architecture.test.ts` — 17 passed, 0 failed. |
| Typecheck / targeted lint / patch hygiene | PASS | `npm run typecheck`; targeted ESLint on dictionary, lexical context/enrichment, Reading/Listening data helpers and tests; `git diff --check`. |
| Gateway/browser integration | OPEN | The route's real-session/tool-broker/database/browser path remains part of Phase 12/18; this checkpoint validates the canonical service and occurrence connector directly against migrated PGlite PostgreSQL. |

## Checkpoint 7 — Phase 5 Knowledge Source Model

| Requirement area | Status | Evidence / limitation |
|---|---|---|
| Bounded source ingestion and parser | PASS for supported text formats | `knowledge-parser.ts` enforces file/character/unit bounds, content signatures, strict UTF-8, inert HTML and DOCX/PDF text extraction, deterministic chunking, and distinct empty/oversize errors. Focused parser tests cover normalization, inert markup, bounds, unsupported formats, mismatched signatures and malformed UTF-8. |
| Source identity and provenance | PASS | Candidate creation validates source type, rights class, publication scope, owner provenance, optional SHA-256 checksum, and server-derived authority. Source and unit hashes/counts are stored with the parser version in the same transaction. |
| Candidate governance lifecycle | PASS for service/database | PGlite tests cover active-owner-only creation/review, candidate-only visibility, rights checks, scope, metadata-only source listing, duplicate source rejection, overlap conflict review, exact-source supersession, regression evidence, and transactionally stored audit events. |
| Owner routes and safe upload integration | OPEN | The model/parser are service boundaries; authenticated owner routes/UI and upload-to-parser/storage integration remain later-phase work. No user-provided source is automatically activated. |
| Focused tests | PASS | `node --conditions=react-server --import tsx --test tests/riwi-knowledge-parser.test.ts tests/riwi-knowledge.test.ts tests/riwi-security.test.ts` — 15 passed, 0 failed. |
| Typecheck / targeted lint / patch hygiene | PASS | `npm run typecheck`; targeted ESLint with `--max-warnings=0`; `git diff --check`. |
| Shared Preview / Production | NOT TOUCHED | No migration, deployment, or external service was applied. |
