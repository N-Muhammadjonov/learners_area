# RIWI code checkpoint — 2026-11-02

The code changes below pass the recorded engineering checks. Full RIWI capability,
model training and live browser acceptance remain incomplete. Main merge is
blocked by the Owner's existing completion condition.

## Current main integration

`arena/learners-area-next` incorporates main
`cb3a331112bff58b889eb4b23bc0b950425985ed`: Food has 302 entries and Media has 126.
The nine bundled packs contain 1782 entries. The QA database repair checkpoint
`1f7b9ee5a9171400e0f36c7ed5846023fa7f6113` and the local Safari/recovery helpers
are preserved. This work changes neither main nor a production database.

## Fixed code defects

- Free-form assignment submission used an `ON CONFLICT` target with no matching
  unique constraint. It now saves an immutable response revision in a short
  transaction, with a learner row lock to serialize identical retries.
- Evaluations used the shared assignment ID as their source. A classmate could
  hit another learner's cached result; edited answers could reuse stale feedback.
  New evaluations use the owned response ID and `assignment_response` source.
  Exact retries reuse that response and evaluation; changed answers create a new
  source. Historical responses and evaluations are retained. No schema migration
  or historical rewrite is required.
- Retention protects both new response-linked evaluations and the learner's
  historical parent-linked evaluation. The probe only selects retention
  candidates; no shared-data purge was performed.
- Named flashcard headings were attached to offsets in an old pack. Replacing
  Food applied old headings to unrelated words and left unmatched rows fragile.
  The original 1498 source senses now bind their headings by canonical sense
  identity. Newly added words without authored headings use ordinary batches in
  the current pack's order. Existing private assessments and historical Food
  headings remain intact; custom/unmatched words survive without an exception.
- The ready-pack test bootstraps the actual application before its route module,
  so a focused invocation no longer fails on a circular import.

## Verification

See `VALIDATION.json` for counts, commands, source hashes and sanitized receipts.
The complete backend suite passes: 3359 tests and 38 subtests. Frontend passes:
1270 tests, with 11 existing skips. The native asset build succeeds (513 files).

The new isolated PostgreSQL/ASGI probe exercises two learners, identical retries,
changed responses, provider-failure recovery, denied roles, parent completion,
legacy/new retention protection, and the four Owner reads. All 33 assertions
pass. Separate contract and domain probes pass 16 and 39 assertions. These use
80 migration executions and 154 typed tables, without a shared database or live
provider. Recovery rehearsal preserves a populated Speaking attempt, verifies
ten canonical recovery tables, and reaches 79 journal entries. The real QA
snapshot verified eleven tables because that database also had a legacy table.

## Remaining gates

1. The Owner deferred reconnecting Safari. After reconnection, run the existing
   fixed-preview smoke runner and collect fresh HTTP statuses; its prior 503
   report predates the QA repair. Then test real navigation, role boundaries and
   task persistence. Local HTTP/SQL success does not certify the live deployment.
2. No trained language model, parameter-training receipt or independently
   validated subjective benchmark is present. The capability audit still exits
   1: legacy Writing relevance and Vocabulary sense counterexamples remain.
   Independent mode withholds unsupported bands/verdicts; that is a limited
   fallback, not semantic inference. Connecting Safari alone cannot supply a
   model or establish calibrated quality.
3. Existing endpoint provenance and Owner retention/storage/restore decisions
   remain open as recorded in the earlier audits. No destructive policy is
   selected by this checkpoint.

The Safari runner now pins preview `learners-area-kmmgxbz7p-learners-area.vercel.app`
at commit `761f760e815ab9ef35ec8a2b86480039d89ac030`, Vercel deployment
`dpl_DStQUb9rvWqmTnaa9N9KCRT2tsaX`. The Vercel API confirmed READY, the exact
branch/commit and Preview target before this follow-up target change. Existing
code-check receipts describe the earlier tested source hashes; the follow-up
changes only the runner's fixed origin/commit constants and this paragraph.
No HTTP success is inferred from READY. Browser control is not exposed in this
chat even though the Owner has signed into the in-app Vercel dashboard.
Run the fixed script in the Owner's Terminal with the exact preview open in
Safari. A full run requests the normal QA Owner password without displaying or
saving it. `--session-only` requires that preview's existing Owner session.
Sites remains private and unpublished; no deployment-protection bypass
credential was created.

## Resume after Safari reconnects

Use the existing repository and `arena/learners-area-next`; preserve local work.
Read this checkpoint and `../sites-qa-20261102/RECOVERY_AND_ROLLOUT.json`.
The QA upgrade is already applied: do not reimport, restore, or rerun it as a
substitute for HTTP testing. Reuse the authenticated QA Owner session when
possible. Never export cookies or stored credential hashes. Do not merge main
until the full-capability and validation condition actually passes.
