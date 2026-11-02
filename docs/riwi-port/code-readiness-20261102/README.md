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

1. The Owner's Safari run at `2026-11-02T14:14:29+05:00` passed all eight checks on
   preview `761f760`; the four repaired Owner reads now return 200. See
   `SAFARI_SMOKE_PASS.json`. A subsequent live run passed ten conversation
   transport/persistence/refusal/cleanup checks. Real navigation, cross-account
   role acceptance, task persistence and useful tutoring remain open.
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

## Live conversation follow-up

The Owner's Safari conversation run at `2026-11-02T09:28:42Z` passed ten transport,
persistence, refusal and cleanup checks on preview `761f760`. The saved finding
is `SAFARI_CONVERSATION_PASS_LIMITED.json`. The normal answer had provenance
`unavailable` and `normalAnswerAvailable=false`. Useful tutoring failed this
check; transport success does not close that capability gate.

Reproduce the conversation transport run using the same preview's session:

```sh
python3 scripts/riwi-safari-conversation-smoke.py
```

The runner checks the expected active QA Owner and disabled external AI before
posting any message. It creates one synthetic conversation, verifies exact
round trips for three turns (including a fixed prompt-injection refusal), then
deletes only its newly returned conversation ID and verifies 404. It never
exports cookies, credentials or conversation text, and does not retry a POST.
QA audit/security test records remain. If no conversation ID is returned, the
runner cannot infer whether a failed server request wrote partial data; it does
not search for or delete other conversations.

`normalAnswerAvailable` is recorded separately. A transport/persistence pass
with provenance `unavailable` does not establish useful tutoring. Semantic
quality and full acceptance remain unvalidated regardless of transport status.
No visual browser checks or cross-account role certification are claimed.

The QA database was inspected with one aggregate read-only query: zero grammar
topics, zero published grammar topics and zero active knowledge sources. No
lesson, knowledge approval, provider configuration or shared database row was
changed during this diagnosis. The repository's small grammar foundation bundle
is explicitly an AI draft for Owner review; it was not silently published to
make the live question pass.

A second defect was found in literal grammar retrieval: it searched for the
whole question inside a title and truncated the question to 80 characters. The
follow-up code matches bounded normalized literal phrases in either direction,
keeps the 300-character input boundary and treats `%`/`_` as punctuation. It
filters unpublished/empty lessons, prefers an exact topic title and returns
unavailable for multiple remaining matches instead of choosing an arbitrary
row. Explicit topic IDs remain authoritative. This retrieves published lesson
text; it does not synthesize comparisons or infer answers to arbitrary questions.

The lookup repair passes 21 isolated PostgreSQL store checks and five API checks,
including a saved and deleted conversation using explicit published context.
The full backend regression remains 3359 tests plus 38 subtests passed. No
shared QA lesson data or training artifacts were introduced. A live retest of
this repair needs a suitable published content source and its candidate preview;
the existing Safari helper continues to pin the already tested `761f760`.

The runner's request sequence passes twelve isolated Node VM tests, including
wrong-origin/actor/provider gates, altered transcripts, foreign reply IDs, POST
failures, missing answers, refusal failures and cleanup failures. These are
runner tests with mocked requests, not a live conversation result:

```sh
node --test qa/riwi-sites-20261102/test-safari-conversation-runner.mjs
```

## Resume after Safari reconnects

Use the existing repository and `arena/learners-area-next`; preserve local work.
Read this checkpoint and `../sites-qa-20261102/RECOVERY_AND_ROLLOUT.json`.
The QA upgrade is already applied: do not reimport, restore, or rerun it as a
substitute for HTTP testing. Reuse the authenticated QA Owner session when
possible. Never export cookies or stored credential hashes. Do not merge main
until the full-capability and validation condition actually passes.
