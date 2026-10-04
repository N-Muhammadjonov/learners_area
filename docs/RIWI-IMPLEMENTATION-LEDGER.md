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

## Checkpoint 2 — bounded server-side tool contracts and broker

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
| 1 | Deny-by-default capabilities and row-scope policy | PASS | Checkpoint 1 evidence above; accepted remote checkpoint `7f8c5cf`. |
| 2 | Bounded server-side tool contracts and broker | PASS | Checkpoint 2 evidence above; accepted remote checkpoint `5c4122e`. |
| 3–20 | Remaining Full RIWI build / acceptance | IN PROGRESS | The following local continuation checkpoint advances several independently testable foundations, but does not mark any later numbered phase complete. Owner workflows, provider lab, integrated UI acceptance, and final canonical gates remain open. |

## Local continuation checkpoint — outbound security and RIWI foundations (not yet pushed)

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
