# RIWI architecture decision record

**Status:** implementation contract for the Full RIWI build. This extends Learners Area; it does not replace Coach, Reporter, lexical services, or current feature routes.

## Decision 1 — RIWI is a server-side orchestrator, not a provider

- `src/lib/services/coach/providers/riwi/*` remains the deterministic Coach evaluator and fallback. It is not relabeled as the whole RIWI system.
- The new `src/lib/services/riwi/*` gateway authenticates from `getCurrentUser` / `requireActiveUser`, resolves the server-side role and account state, creates a correlation id, classifies only finite intents, applies capability and row-scope policy, retrieves authorized Dictionary/knowledge context, builds a fixed plan, calls bounded services, validates outputs, composes a role-filtered result and emits allowlisted audit/learning metadata.
- Model output is never interpreted as a tool request. Only the server planner can select a registered tool; unknown names are denied.

## Decision 2 — authorization is two checks, default deny

1. A capability matrix answers whether a role can attempt a product action.
2. A scope resolver answers which rows that actor may target. Student scope is self-only; teacher scope is the authoritative `teacher_student_links` roster; admin capabilities are explicitly enumerated; owner scope remains broad but product-bounded.

All routes derive actor id, role, account status and locale on the server. Request-body role/user ids are data, never authority. Targeted mutations re-read role, account state, ownership/roster and target status immediately before writing. Unreadable policy and roster checks deny.

## Decision 3 — safe tools, not arbitrary execution

Every tool has a stable name/version, Zod input/output, capability, allowed roles, row-scope resolver, risk class, timeout, idempotency mode, audit mode, external-data classification and confirmation requirement. Handlers delegate to existing service APIs or narrow new RIWI services. Shell, arbitrary SQL, arbitrary filesystem paths, arbitrary source writes, secrets and unrestricted network are absent by construction.

High-impact writes are proposals first: the server returns the exact target/effect and a short-lived actor/tool/input-bound confirmation token. Confirmation re-reads authorization and target state and consumes an idempotency receipt before mutation. No prompt text alone can confirm an action.

## Decision 4 — deterministic authority and privacy before AI

- Reporter numbers and account/course state always come from deterministic Learners Area services. A provider may only explain a supplied structured snapshot; it cannot create or edit metrics.
- Dictionary lookup resolves canonical senses/occurrences before a model is considered. Canonical translation wins. Ambiguous/unknown/locked/stale occurrences remain unresolved; exam policy is checked before any retrieval.
- Active approved/versioned knowledge is filtered by role/scope/state/authority before lexical or full-text ranking. Retrieved file content is labeled untrusted data, never policy.
- External providers receive task-specific DTOs produced by a central outbound guard; default-denied identity fields include email, phone, Telegram/account ids, unrelated history, private staff notes, provider secrets and raw database/storage credentials.
- External output is size/schema/evidence validated. It cannot initiate a second tool call. Raw provider bodies are discarded; stored experiment/evaluation records contain normalized results and truthful provenance only.

## Decision 5 — versioned knowledge and controlled learning

Knowledge sources preserve checksum, provenance, rights class, source type, authority, scope, version, state, creator/reviewer, timestamps and supersession. Uploads start as draft/candidate; safe parser output is inert data. Conflict detection creates review work; candidate text is never retrieval-eligible as active authoritative knowledge. Promotion requires trusted review, explicit scope, conflict resolution and linked regression evidence. Supersession preserves old versions.

Provider results, user outcomes, teacher/owner corrections, manual QA and retrieval/tool failures are learning signals, not active truth. Provider consensus is evidence only. Owner corrections may outrank provider agreement. No model-weight training or private-data fine-tuning is in scope.

## Decision 6 — reuse the existing provider system with task profiles

The provider-neutral Coach adapter registry remains the only external model boundary. Task profiles choose capability/provider/model/fallback/readiness/limits; owner policy cannot supply arbitrary endpoints or keys. Existing SSRF guards, request deadlines, retry rules, normalized schemas and learner-facing “Checked by RIWI” branding remain in force. Internal provenance records actual provider/model/prompt/rubric/fallback and safe usage metadata.

Provider labs are owner-triggered, concurrency- and budget-bounded, and run only sanitized fixed fixtures. Missing keys mean **EXTERNALLY UNVERIFIED**, not pass/fail and not a blocker to deterministic features.

## Decision 7 — memory and retention are separated

- Conversation context is per authenticated actor/conversation, capped and expiring; the owner does not receive raw learner chat by default. Users can delete their own conversations.
- Approved knowledge, candidate learning signals, normalized evaluation/experiment results, provider policy, failure metadata and audit events have distinct schemas and retrieval eligibility.
- Audit contains ids, capability/tool/provider, scope, correlation, outcome, hashes/counts, versions and timestamps—never secrets, full private prompts, essay/audio content or report contents by default.
- Model-weight training is NOT implemented.

## Decision 8 — migration and rollout

RIWI migrations are additive, generated through Drizzle Kit from schema source, tested against fresh and upgrade databases plus isolated PostgreSQL. Current repository history needs repair/verification first: journal is at 0035 but committed snapshots stop at 0027. No migration is applied to shared Preview without explicit owner approval; Production is not accessed or modified. External live-provider and real-browser checks are reported honestly.

## Request flow

`server session → active account → actor/locale/correlation → finite intent → capability → row scope/exam policy → minimum deterministic context → active knowledge/Dictionary → fixed tool/provider plan → outbound guard → bounded handler/provider → strict validation → role-safe composition → audited metadata → candidate learning signal`

## Deliberately deferred unless a verified need appears

- Vector database/embeddings: PostgreSQL full-text/exact retrieval is the first implementation; semantic infrastructure requires a measured quality/performance benefit and cost ADR.
- Fine-tuning/foundation-model weights: explicitly out of scope.
- Live provider, Preview and browser acceptance: external/approval gates, never simulated as pass.
