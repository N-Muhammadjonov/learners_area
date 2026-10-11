# Grammar written work: source-bound atomic persistence

Written corrections, assessed translations and activations now save their verdict, authoritative Coach evaluation and domain completion event in one transaction. RIWI resumption uses this same write boundary. Provider calls run outside the database transaction.

The code continues the unpublished Batch25 source 02504ba89fb05d1c8c78c3060112b6f957d9824ba8bfaf2eb30e22f314ce9820. Published base remains 2f880809bf57ad3d37c373dc944b28037f20d0a0. The old local Git HEAD is not the publication base. Existing source, original prompt archives and the frozen 25-30 handoff are preserved. No reset, rebuild, commit or push was performed.

## Resulting behavior

| Boundary | Behavior |
|---|---|
| Preparation | Validate active identity, current source ownership and the authored activity prompt. Store the writing as explicitly unassessed. |
| Original source | Required prepared audit stores the exact canonical source checksum, answer checksum, contract key and prompt/rubric versions in the same transaction as staging. It contains no answer, prompt, key or secret text. |
| RIWI resumption | Reuse one owned saved activation with its original prepared receipt. Missing legacy fingerprints or a changed prompt/answer return source unavailable before provider dispatch. Historical checksums are never fabricated. |
| Finalization | Lock and recheck active identity, visible source, original fingerprint, saved answer and activity. Validate domain, contract/version, supported band-free output and grounded quotations before accepting the result. |
| Atomic result | Evaluation, verdict and domain completion event commit together. Event failure rolls them back. Replaying the same attempt does not duplicate the evaluation/event. |
| Failure cleanup | Remove only new unassessed writing. Lock the attempt before checking committed evaluations in a fresh statement; accepted work survives cleanup races and later bookkeeping failure. Resumption never deletes previously saved work. |
| Feedback delivery | Read back the persisted, owned result and matching completion/preparation receipts. Recheck account/source access before returning feedback or correction keys. |
| Mastery/review | New pending writing is not an objective wrong answer. It does not reduce accuracy or add assessed sessions. Review labels it unassessed. Older authored-choice records keep their saved objective result. |
| Valid short answers | A one-letter correction such as an article remains eligible. Blank text, client-supplied source/contract fields and never-saved provider verdicts are refused. |

Translation still uses the existing strict shared semantic contract with external-only fallback policy. This patch creates no second provider client, new contract registry entry, migration or UI redesign. It does not execute the separate source-book transformation/free-production contracts merely because a Grammar route exists.

The prepared receipt proves source identity at staging. It is not proof of answer delivery, correctness, mastery or a completed learning event. An old saved production without that evidence remains readable as historical work but is not regraded against a possibly changed prompt.

## Current verification

Final source: 8039340dad0055e14ec49f0c111ba8ca139977d78f58ab01dc43cea945472399, 1238 canonical source files.

Two affected rounds each passed 285 backend cases, 260 UI cases, typecheck and lint. Failures, skips, cancellations and todos were zero. This is 545 distinct selected cases, executed twice (1090 test executions). Every gate verified the same unchanged source manifest. Raw commands, receipts and log checksums are in docs/evidence/riwi-batch26-assistant/ and RIWI-BATCH-26-QA-RESULTS.json.

The 13 dedicated production cases exercise actual canonical-migration SQL writes, event/audit failure rollback, source/owner/account/answer mutation fencing, replay, accepted-result recovery, denied feedback, malformed provenance, unsupported translation fallback, ungrounded quotations, pending mastery, resumed owned work, legacy source rejection and short-answer compatibility. Existing gateway integration fixtures now invoke the real atomic persistence callback rather than returning an unsaved fabricated Grammar record. The immutable ownership trigger was preserved; tests use distinct fixtures where an ownership change cannot be reversed.

Verification uses local PostgreSQL/WASM and provider transport/service fixtures. Native multi-connection races, live semantic-model quality, authenticated browser journeys, current restored-application boot and a production build remain unverified. The no-rebuild instruction is preserved. Earlier v1 gates at b037da7e passed before the original-source receipt repair; final acceptance evidence refers only to the v2 hash above.

## Acceptance and continuation

B04 remains partial: all specialized Grammar/Vocabulary source-task semantics still need individual runtime acceptance. B01 all-68 task behavior, B05 applicable real-provider checks and the wider original groups remain open. This patch receives no new full-group credit.

Current remaining prompt: 19/34 = 55.88%. Overall RIWI/project percentages remain unknown because no complete verified denominator is available. The five-new-fully-closed-groups publication requirement is not met.

The external 25-30 package remains frozen at its Batch25 hash. Returned patches must first match that package's old hashes, then be reconciled with this newer source; its full repo must not overwrite the preserved current tree. Original D01/D02/D03/D06 acceptance is not new progress, and D04/D05 acceptance remains separate.
