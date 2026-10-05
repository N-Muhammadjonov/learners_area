# RIWI current-state truth table

Baseline inspected for the authorized Full RIWI build. This records repository truth before the RIWI gateway/policy/knowledge implementation; it is not a claim that RIWI is complete. Current phase evidence and requirement-by-requirement acceptance status are tracked in `docs/RIWI-IMPLEMENTATION-LEDGER.md` and `docs/RIWI-FINAL-ACCEPTANCE-LEDGER.md`.

**Baseline:** `a83351a3d2fcc2e81fc024e5e1a308f3410864b9`
**Session branch:** `arena/01a10332-learners-area`
**Remote integration ref observed:** `origin/arena/learners-area-next` resolves to the same baseline SHA.
**Worktree at inspection:** clean.
**Verification environment:** Node 22.22.3 although `package.json` requires Node 24.x. No Preview or Production database was accessed.

| Subsystem | Baseline status | Source / test evidence | RIWI gap at baseline |
|---|---|---|---|
| Authentication, active-account gate, database-derived role | IMPLEMENTED | `src/lib/auth/current-user.ts`, `roles.ts`, session/auth tests | Reuse the DB-backed actor; no client-supplied role or user id may authorize a request. |
| Explicit role capability registry | MISSING | Coarse `requireOwner` / `requireStaff` guards and product-specific permission helpers exist | No RIWI capability matrix or centralized deny-by-default capability check. |
| Teacher row scope | PARTIAL / EXTERNAL | Reporter `access.ts` and `roster.ts`; migration 0035; `tests/reporter.test.ts` RP13–RP18 | Reuse the explicit roster resolver; Preview 0035 remains separately approval-sensitive. |
| Coach evaluation/provider registry | IMPLEMENTED for evaluations | `src/lib/services/coach/{registry,resolver,service,schema}.ts`; `tests/coach-providers.test.ts`, `coach-privacy.test.ts` | This is evaluation resolution, not a request gateway, tool broker, or general RIWI orchestrator. |
| Internal RIWI heuristic evaluator | IMPLEMENTED for current evaluation types | `providers/riwi/*`; existing writing/speaking/grammar/vocabulary/assignment tests | Do not present the existing fallback provider as the full RIWI system. |
| OpenAI / Anthropic adapters | IMPLEMENTED; live EXTERNALLY UNVERIFIED | First-class adapters; provider matrix and adapter tests | No live provider call is evidenced; real credentials are required for live verification. |
| Gemini, DeepSeek, Qwen, xAI/Grok, Groq, Mistral | IMPLEMENTED through compatible adapter | `providers/compatible`; `tests/provider-matrix.test.ts`, `universal-ai-providers.test.ts` | Static/mock adapter tests do not prove a live request. Grok and Groq are distinct. |
| Provider SSRF / outbound policy | PARTIAL | `providers/shared/ssrf.ts`; HTTPS, configured endpoint, DNS check, redirect refusal | Central task-specific outbound DTO/privacy guard and stronger DNS/socket rebinding controls are still needed. |
| External payload minimization | PARTIAL | Coach resolver strips user id for evaluation calls; `tests/coach-privacy.test.ts` | No shared guard for gateway, retrieval, provider labs, research, or future tool payloads. |
| Task-profile provider router | MISSING / PARTIAL | One global `AI_PRIMARY_PROVIDER`, owner switch and fallback in `owner-control.ts` | No per-profile policy, budget/usage feedback, or RIWI request routing. |
| Deterministic Reporter | IMPLEMENTED | `src/lib/reporter/*`; `tests/reporter.test.ts` RP1–RP18 | Needs a bounded RIWI tool wrapper; AI must not author numeric facts. |
| Canonical Dictionary / lexical occurrences | IMPLEMENTED as product services | `src/lib/services/lexical/*`, vocabulary API, lexical tests | No stable RIWI connector contract yet; connector must honor occurrence authority and exam locks. |
| Exam lexical-integrity policy | IMPLEMENTED in feature services | `src/lib/reading/lexical-policy.ts`, `src/lib/listening/lexical-policy.ts`; UI/API tests | General RIWI gateway must explicitly use these rules before dictionary retrieval. |
| Versioned knowledge source registry | MISSING | No RIWI knowledge tables or lifecycle services | Need safe parsing, provenance/rights, draft-to-active review, conflict and supersession flows. |
| Knowledge retrieval / RAG | MISSING | No active-source RIWI retriever | Need scope/status/authority filters before lexical/FTS ranking; no vector dependency justified at baseline. |
| Learning evidence and promotion workflow | MISSING | Existing evaluation rows and weakness tracking are product data, not candidate-learning governance | Need separate signals/reviews, trusted approval, regression linkage and non-destructive versioning. |
| Provider evaluation lab | MISSING | Existing owner integrations readiness panel only | Need owner-only bounded experiments, normalized results, cost/privacy controls and disagreement view. |
| RIWI safe tool registry / action broker | MISSING | Existing Reporter, upload, content and account services are individually bounded | Need typed input/output, role/capability/scope, risk, timeout, idempotency, audit and confirmation metadata. No shell/raw SQL/filesystem/network tool. |
| RIWI chat/request gateway and conversations | MISSING | `/coach` is a progress dashboard, not a chat gateway | Need finite intents, authenticated request pipeline, request correlation, private/no-store responses and isolated short context. |
| Student / teacher / admin / owner RIWI UX | MISSING / PARTIAL | `/coach`, owner integrations, audit and reporter surfaces exist | Reuse these; role-specific assistant/governance workflows are not present at baseline. |
| Audit | PARTIAL | `audit_log`, `recordAudit`, owner audit page; provider-control and Reporter events | Need RIWI-specific structured event taxonomy and allowlisted metadata, never full prompts/secrets. |
| Provider usage / cost observation | MISSING | No normalized RIWI usage table/service | Need role/task/provider/model/latency/token/cost metadata only, with no prompt or response body. |
| Retention / deletion | PARTIAL | Existing product retention service covers learner activity | No RIWI conversation/knowledge/experiment retention contract. |
| Hardened upload/parser foundations | IMPLEMENTED as reusable building blocks | `src/lib/uploads/signature.ts`, `src/lib/import/archive.ts`, `pdf-text.ts`, storage service | No RIWI knowledge ingestion connection; formats and expansion/time limits must remain bounded. |
| Writing / speaking / grammar / vocabulary integrations | PARTIAL / IMPLEMENTED for current features | Coach services, Writing Grade/checks, Speaking transcript/STT, grammar/vocabulary evaluation | Preserve those flows and add RIWI gateway provenance/privacy without inventing scores. Pronunciation remains limited absent a capable provider. |
| Migrations | FORWARD BASELINE REPAIRED / HISTORY PARTIAL / APPROVAL-SENSITIVE | `drizzle/0000`–`0035`, journal ends at 0035; generated `drizzle/meta/0035_snapshot.json` | Historical snapshots 0028–0034 are still absent. A valid current-state snapshot for the 0035 journal tip has been generated from the application schema through Drizzle Kit and linked to the last committed snapshot 0027. In an isolated output folder, the official generator then reported no schema changes; a one-table probe emitted only that table and linked snapshot ids. `drizzle-kit check` passed. No journal entry or migration SQL was added and no database migration was applied. See `docs/RIWI-MIGRATION-SNAPSHOT-REPAIR.md`. |
| Shared Preview application | OWNER ACTION REQUIRED | Migration approval docs; Preview migrator has a read-only fingerprint/plan path | No shared Preview migration may be applied without explicit approval. Production remains untouched. |
| Automated baseline QA | PASS with skips | `npm test`: 947 pass, 0 fail, 90 skip. `npm run test:ui`: 205 pass, 0 fail. Typecheck and lint pass. | Listening source-package and external provider tests remain skipped/unverified rather than PASS. Node runtime differs from the declared engine. |
| Browser/manual/external conditions | EXTERNALLY UNVERIFIED where applicable | Existing QA ledgers and named owner contracts | Preserve previous evidence; verify only affected surfaces plus RIWI acceptance. Live Partner TURN/two-browser and real R2 upload remain external where not previously evidenced. |

## Open conditions carried forward

- Preview migrations 0029–0035 are not presumed approved; 0035 is separately approval-sensitive. Existing documentation says 0031 was applied to a fingerprinted Preview on 2026-10-03, but that does not approve other migrations or future RIWI migrations.
- External AI live calls are **EXTERNALLY UNVERIFIED** until real provider credentials are available and a sanitized request succeeds.
- `LISTENING_SOURCE_ZIP` remains missing unless owner-supplied evidence proves otherwise; its two canonical tests are skipped, not passed.
- W13 Topic Vocabulary remains an owner-content gap; do not fabricate or silently fill it.
- Live Partner TURN/two-browser acceptance and real R2 upload verification remain external where not already completed.
- Existing browser/manual-QA evidence is preserved and not re-labeled.

## Migration-generator incident (safe, non-persistent)

A no-schema-change `npm run db:generate -- --name baseline-check` probe compared the full current schema against the last committed snapshot (0027), because snapshots 0028–0035 are absent. Drizzle Kit created an untracked full-schema `0036_baseline-check.sql`, `0036_snapshot.json`, and a journal entry. Those exact generated probe artifacts were removed and `_journal.json` restored to its original committed contents. No migration was applied. Before generating RIWI migrations, reconstruct/verify the 0035 snapshot baseline using Drizzle Kit output and prove the generated diff contains only intended RIWI objects; never hand-edit the journal to conceal this gap.
