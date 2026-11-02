# Original RIWI teaching increment — 2 November 2026

This increment supplies 92 original, compact English/Uzbek lessons: 24 grammar topics
plus material for every one of the 68 existing Basebook task keys. Each lesson has
an explanation in both languages, an original worked example, a common mistake
and a practice prompt. This is teaching material coverage, not proof that RIWI can
perform or grade all 68 tasks.

The Owner explicitly requested teaching RIWI from the assistant's own knowledge.
The pack records assistant authorship and internal permission. It contains no
copied course book and no independently certified examiner bands. Adding this
library is retrieval-based teaching; no neural weights have been trained,
fine-tuned or transferred.

## What changed

- A versioned original curriculum and compiler produce one governed source with
  92 intact knowledge units. The compiled source checksum is recorded in
  VALIDATION.json.
- RIWI can select an approved lesson from a literal topic phrase, format it in the
  session language and continue the topic from its own conversation metadata.
  Selection requires an exact active source checksum and unit hash, with the
  existing global/role/user scope and active-account checks.
- Canonical dictionary, grammar and deterministic reports retain precedence.
  Unmatched curriculum JSON is filtered out of generic single-keyword retrieval
  so an unrelated question does not receive an arbitrary lesson.
- The existing chat provider router has an optional Vercel AI Gateway transport.
  It uses server-side deployment OIDC or an existing Gateway key, an explicitly
  configured provider/model ID, actor-aware shared admission and the current
  rollout/privacy/audit/output validation gates. Requests use temperature 0,
  at most 900 output tokens and a 16-second network timeout, with no automatic
  retry or automatic provider selection.
- This provider is registered for assistant chat. No subjective evaluator is
  switched to it; independent-v1 score withholding remains in force.
- The outbound secret detector also rejects Gateway key and OIDC assignments.

No environment variables, credentials, production data, model credits or Owner
switches were changed while preparing this increment.

## Verification actually performed

27 targeted pytest tests passed in a temporary Vercel VM, including existing
provider router and transport regression tests. Checks cover the 68 task keys,
92 parser units, bilingual formatting, 24 varied topic questions, source
integrity, inactive accounts, conversation scope, attack refusal, unknown answers,
Gateway credential/model validation, malformed output, disabled rollout and the
existing Owner candidate validation.

The Safari installation workflow passed nine isolated Node VM scenarios:
success, idempotent reuse, wrong Owner, external AI enabled, old code, wrong
origin, changed source checksum, unresolved conflicts and failed-answer cleanup.
These are simulated browser requests. A live Safari run has not occurred for
this increment.

The two new database queries also passed EXPLAIN in a read-only transaction on
the existing QA database. That verifies SQL/schema compatibility, not live source
activation or a full database regression run.

The VM used Python 3.14.4 and asyncpg 0.31.0; repository runtime pins were not
changed. Full backend/frontend suites and the frontend build were not rerun in
the disconnected local workspace. Earlier 3359 backend / 1270 frontend results
belong to the preceding checkpoint, not this new change.

The topic and factual checks were authored by the same assistant as the lessons.
They demonstrate constrained retrieval and selected factual anchors, not an
independent semantic benchmark or general language-model quality. See
VALIDATION.json for exact scope and tested file hashes.

## Activate the source on the new QA preview

The local execution environment disconnected during this work. This source has
not yet been written to QA. Once the repository is available locally, update the
existing arena checkout with a fast-forward pull. Do not discard local changes.

Open the exact new immutable Vercel preview, sign in as the existing QA Owner and
run from the repository root:

~~~sh
python3 scripts/riwi-safari-teach.py --origin https://learners-area-REPLACE-WITH-NEW-DEPLOYMENT-learners-area.vercel.app
~~~

Replace the placeholder with the actual immutable preview origin. The script
refuses production and branch aliases. It checks the expected active QA Owner,
new provider registry and disabled external AI before any write. It submits only
this compiled source through the normal candidate -> approve -> promote APIs.
Unresolved conflicts, a different previous checksum or ambiguous source names
stop the flow. An exact active source is reused without a second activation.

It then tests a grammar explanation and a follow-up, requiring the approved
source citation and exact curriculum topic marker. Only the new synthetic
conversation is deleted. The source and its normal audit events remain in QA.
No session cookie, credential or conversation text is exported. The sanitized
result is qa/riwi-safari-teach-last.json.

The older Safari conversation helper still targets its earlier pinned preview;
its historical pass must not be treated as validation of this increment.

## Connect and validate the actual language model separately

The adapter does not make a model functional by itself. A QA deployment still
needs a valid Gateway credential (or deployment OIDC), a supported explicit
AI_GATEWAY_MODEL and usable model credit/account access. No secret should be
pasted into chat or committed.

The non-secret server configuration for an Owner-only QA trial is:
AI_GATEWAY_MODEL=<verified provider/model ID>, RIWI_PRIMARY_PROVIDER=vercel,
RIWI_EXTERNAL_AI_ENABLED=true and AI_EXTERNAL_ENABLED=true. Keep all non-Owner
RIWI role flags disabled for that trial. The two external flags must remain off
during the library installer above. These settings are instructions for a later
verified QA trial; none were applied here.

Run bounded synthetic teaching cases through the normal authenticated chat
endpoint, verify external_provider provenance, inspect token usage and compare
answers with independently reviewed reference cases. In particular, test
unrelated writing, alternative valid corrections, ambiguous vocabulary senses,
multi-turn teaching and refusal. Do not enable unsupported bands based on a
successful transport response.

Main remains unmerged. Live source activation, a working model response,
independent semantic acceptance and the previously documented Owner policy and
release gates still prevent a 100% readiness claim.
