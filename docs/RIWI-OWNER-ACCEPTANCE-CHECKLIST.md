# RIWI owner acceptance checklist

**Status: OWNER ACTION REQUIRED — not self-approved.** This checklist separates local automated evidence from actions that require the owner, authenticated browser sessions, owner-controlled assets, credentials, or a shared Preview decision. A green local suite does not satisfy owner acceptance.

## Local evidence to review

- [ ] Read `docs/RIWI-IMPLEMENTATION-LEDGER.md` and the final gate receipts/logs linked there; distinguish `PASS`, intentional `SKIP`, `EXTERNALLY UNVERIFIED`, and `OWNER ACTION REQUIRED`.
- [ ] Review `docs/RIWI-ARCHITECTURE.md` and confirm the scope/authority, provider, knowledge, evaluation, and audit boundaries remain acceptable.
- [ ] Review the English and Uzbek RIWI copy in chat and Owner governance. Brand names, provider/model IDs, SQL, schema/report/correlation IDs, capabilities, API fields, enum values, roles, and audit event types remain canonical technical identifiers.
- [ ] Review owner-history pagination behavior: independent source/signal/audit/experiment counts, user-triggered continuation, failed-page preservation and retry, ID deduplication, non-reentrancy, stable cursors, and fail-closed handling when authorization is revoked.
- [ ] Confirm local migration 0044 was tested only in isolated PGlite/local PostgreSQL and **was not** applied to shared Preview or Production.

## Owner/browser acceptance (perform with authorized test accounts)

- [ ] Student: self-only chat/report/progress; no target selector or Owner controls; exercise handoffs open the existing Writing, Speaking, Grammar, Vocabulary, and Reports workspaces.
- [ ] Teacher: only active explicitly rostered learners; target selection affects only the supported report/progress actions; revoked roster access fails closed.
- [ ] Admin: operational cohort scope only; Owner-only controls remain absent.
- [ ] Owner: centre-wide versus explicitly selected-learner scope is clear; governance source, learning-signal, audit, and provider-experiment histories can be paged and retried without duplicate rows or lost selections.
- [ ] Switch the UI between English and Uzbek and inspect chat, history counters/actions, retry/error text, review controls, provenance disclosures, and accessible names.
- [ ] Verify authorized upload/use of the actual Listening source ZIP and any other owner-provided content. No source asset or successful asset test may be fabricated.
- [ ] If live-provider behavior is required, use owner-approved credentials, fixed fixtures, cost/usage limits, and the documented provider acceptance procedure. Credential presence alone is not live-provider evidence.
- [ ] Record any Preview migration approval only after reviewing `docs/PREVIEW-MIGRATION-APPROVAL-0044-2026-10-04.md`, confirming the fresh target fingerprint and independently restored backup, and explicitly approving migration 0044. Do not approve by implication.
- [ ] Do not run the deferred V2 portability prompt until the original RIWI master build and this checklist are complete.

## Owner decision

- Owner reviewer: ______________________________
- Review date/time and timezone: ______________________________
- Branch/commit reviewed: ______________________________
- Browser roles and locales exercised: ______________________________
- External assets/provider evidence reviewed (or explicitly unavailable): ______________________________
- Preview decision (not requested / approved for exact scoped migration / rejected): ______________________________
- Findings and follow-up owner: ______________________________
- Explicit acceptance decision: ______________________________

No line above is marked complete on the owner's behalf. Local agent test results must be linked from the implementation ledger before this checklist is presented for sign-off.
