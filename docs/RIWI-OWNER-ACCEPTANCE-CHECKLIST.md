# RIWI owner acceptance checklist

**Status: OWNER ACTION REQUIRED — not self-approved.** This checklist separates local automated evidence from actions that require the owner, authenticated browser sessions, owner-controlled assets, credentials, or a shared Preview decision. A green local suite does not satisfy owner acceptance.

## Local evidence to review

- [ ] Read `docs/RIWI-IMPLEMENTATION-LEDGER.md`, `docs/RIWI-FINAL-ACCEPTANCE-LEDGER.md`, and the fresh gate/red-team logs linked there. Tested source/test checkpoint: `9c926a97177b3ec19d187b3bf7c7e408a704eeda` on `arena/01a10332-learners-area`; two fresh full gates and the current-tree 196-test integrated red-team suite are green locally. The dedicated HTTP 409 test verifies owner-route delegation and the safe mapper response, but is not an authenticated end-to-end overflow `POST`. The earlier 2026-10-04/previous 2026-10-05 gates and prior 156/195-test red-team runs are retained as historical evidence. Distinguish the two Listening-asset skips from passes, no standalone leak/load proof, live-provider/browser/Preview boundaries, `EXTERNALLY UNVERIFIED`, and `OWNER ACTION REQUIRED`. Later ledger/checklist changes are documentation-only.
- [ ] Review `docs/RIWI-ARCHITECTURE.md` and confirm the scope/authority, provider, knowledge, evaluation, and audit boundaries remain acceptable.
- [ ] Review the English and Uzbek RIWI copy in chat and Owner governance, including the newly disclosed 30-day conversation expiry, 60-message retention cap, and automatic deletion of older messages. Brand names, provider/model IDs, SQL, schema/report/correlation IDs, capabilities, API fields, enum values, roles, and audit event types remain canonical technical identifiers.
- [ ] Review owner-history pagination behavior: independent source/signal/audit/experiment counts, stable timestamp+id ordering, user-triggered continuation, failed-page preservation and retry, ID deduplication, non-reentrancy, filter-bound cursors, current-role/scope reauthorization, and fail-closed handling when authorization is revoked. Local tests traverse 1,205 rows per owner-history collection and target surface.
- [ ] Review the knowledge-overlap overflow fix: a scan that exceeds either the active-unit or conflict bound aborts candidate creation rather than persisting a partial conflict list.
- [ ] Confirm the local 45/45 migration chain was exercised only in isolated test databases and **was not** applied to shared Preview or Production.

## Owner/browser acceptance (perform with authorized test accounts)

- [ ] Student: self-only chat/report/progress; no target selector or Owner controls; exercise handoffs open the existing Writing, Speaking, Grammar, Vocabulary, and Reports workspaces.
- [ ] Teacher: only active explicitly rostered learners; target selection affects only the supported report/progress actions; revoked roster access fails closed.
- [ ] Admin: operational cohort scope only; Owner-only controls remain absent.
- [ ] Owner: centre-wide versus explicitly selected-learner scope is clear; governance source, learning-signal, audit, and provider-experiment histories can be paged and retried without duplicate rows or lost selections.
- [ ] Switch the UI between English and Uzbek and inspect chat, history counters/actions, retry/error text, review controls, provenance disclosures, and accessible names.
- [ ] Decide whether the destructive conversation policy is acceptable: conversations expire after 30 days, retain only the latest 60 messages, and automatically delete older messages. The UI discloses this; older messages are not cursor-reachable. Record explicit accept/reject and any required product change.
- [ ] Verify authorized upload/use of the actual Listening source ZIP and any other owner-provided content. No source asset or successful asset test may be fabricated; two ZIP-dependent tests remain asset-required.
- [ ] If live-provider behavior is required, use owner-approved credentials, fixed fixtures, cost/usage limits, and the documented provider acceptance procedure. Credential presence alone is not live-provider evidence.
- [ ] Preview is **not ready for approval**. Review `docs/PREVIEW-MIGRATION-APPROVAL-0036-0044-2026-10-05.md`; obtain a fresh target fingerprint and exact applied/pending range, verify per-migration hashes and target impact, and provide target-matched backup/PITR plus an independently restored receipt before asking for approval. The current guarded migration allowlist ends at `0035`. Do not contact/apply Preview or deploy Production without explicit owner direction and all recovery gates.
- [ ] Do not start `RIWI_SECURITY_PROMPT_FINAL_V2.txt` until the original full RIWI master has reached genuine completion or an explicit owner boundary.

## Owner decision

- Owner reviewer: ______________________________
- Review date/time and timezone: ______________________________
- Branch/commit reviewed: ______________________________
- Browser roles and locales exercised: ______________________________
- External assets/provider evidence reviewed (or explicitly unavailable): ______________________________
- Conversation retention policy decision (accept / reject / change required): ______________________________
- Preview decision (not ready / approved only for exact verified target and range / rejected): ______________________________
- Fresh Preview fingerprint, applied/pending range, and restore receipt (or explicitly unavailable): ______________________________
- Findings and follow-up owner: ______________________________
- Explicit acceptance decision: ______________________________

No line above is marked complete on the owner's behalf. Local agent test results must be linked from the implementation ledger before this checklist is presented for sign-off.
