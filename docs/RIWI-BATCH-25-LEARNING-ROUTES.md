# Batch 25: source-bound Retention and Grammar routes

This is an unpublished code checkpoint based on verified remote commit
2f880809bf57ad3d37c373dc944b28037f20d0a0, tree
d2b35b4905032890ed309e2ba4381d622186b4d8. The inherited worktree and its Git
history are preserved. Its older local HEAD must not be used as the publication
diff base.

Accepted original-group progress remains **19/34 = 55.88%**. Five source tasks
in this checkpoint are parts of B04, not five independently closed original
groups. No new full-group acceptance, operational GO, commit or push is claimed.
The owner's publication rule still requires five new fully accepted original
groups per push.

## Implemented behavior

| Original source task | Current route | Evidence limits |
| --- | --- | --- |
| retention.reading_recall | riwi.retention.readingRecall.explainLatestSelf | Explain the caller's saved, structurally validated breakdown; never rescore or load hidden source/recall text. |
| retention.vocabulary_recall | riwi.retention.vocabularyRecall.explainSelf | Use the exact saved lexeme/sense and separately qualified productive-use evaluation. Self-reported reviews are not measured unaided recall. |
| retention.error_pattern | riwi.retention.errorPattern.explainSelf | At most ten owned attempts at the same source version/evaluator; a repeated gap needs two distinct attempts. |
| grammar.retention | riwi.grammar.retention.explainSelf | Only owned attempts at currently visible exercises. Written work without an owner/domain/source/contract-bound verdict is unassessed. |
| grammar.explanation | canonical Grammar or approved-source lookup, then the existing shared Coach teaching adapter | Rule, contrast, two or three distinct examples, common error and one mini check are structurally required. One bounded authorized source is sent; live provider quality is not proved by fixtures. |

The four private review tools accept only the server-authenticated caller and
read persisted role/account status again. Active Reading, Listening or Retention
attempts prevent these review answers. The existing recall-allocation lock keys
are reused in stable order.

Private prepared-review audit writes are required in the same read transaction.
They contain task/version identifiers and a checksum, not raw learning text.
An audit failure withholds the answer. These are prepared receipts, not proof
of answer delivery or new learning signals.

Private review answers are excluded from external-provider conversation
history. Transcript reads redact those old answers during a new active attempt
or after role/account revocation. A prepared review cannot be appended after a
new recall begins. These checks have local SQL regression coverage; independent
native multi-connection race acceptance is still required.

No review route changes points, grades, mastery, scheduling, meaningful
activity clocks or weakness records. No hidden exercise prompt, answer key,
private student quotation or foreign same-spelling sense is returned.

Grammar explanation uses the existing registered provider, master switch,
outbound privacy guard, strict adapter, router, audit and conversation pipeline.
It creates no second provider client. Only one relevant excerpt (at most 1,800
characters) and its anonymous K1 reference are sent; source/user IDs, exercise
counts, private attempts, answer keys and conversation history are withheld.
Examples are labelled illustrative. The generated answer needs exactly one K1
citation and the exact server-composed teaching-contract trace.

The approved-source precedence is preserved. A validated generated answer is
stored with external-provider provenance, the original authorized source
citation and its teaching trace. With external AI off or with invalid output,
the authored source is shown with explicit uncertainty and **no** teaching
execution trace. A raw excerpt is not counted as execution of the five-stage
Grammar contract.

## QA and acceptance

Current exact-source results are recorded in
RIWI-BATCH-25-QA-RESULTS.json with source-state and raw-log checksums. Both
rounds passed 251 affected backend tests and 260 UI tests with zero failures
or skips, and typecheck/lint exited zero. The source identity stayed
02504ba89fb05d1c8c78c3060112b6f957d9824ba8bfaf2eb30e22f314ce9820
throughout all eight gates. This is 511 distinct selected cases, executed twice.
The scope
is affected local PostgreSQL/WASM, shared-adapter fixtures, UI, typecheck and
lint. It is not native PostgreSQL, a live model call, authenticated browser
acceptance, restored-app boot, R2 expiry/copy acceptance or a production build.

Earlier diagnostic failures were corrected before the final source snapshot:
test-only imports used incorrect modules, and generated Grammar answers initially
used authored-source provenance, which the existing conversation validator
correctly refused. The conversation validation rule was preserved; the new
generated path now supplies the required external provenance and trace.

## Remaining work

B04 remains partial. Grammar transformation/free production and the specialized
Vocabulary tasks need individually authorized canonical task sources and full
runtime semantics; a generic sentence check or a catalog key is insufficient.
The two existing tutoring routes and deterministic reporting explanation keep
their prior checks, with affected regressions rerun for this checkpoint.

B01 still needs behavioral acceptance for all 68 original tasks. B05 still needs
applicable real-provider contract/evidence acceptance. D05 still needs current
restored-application boot acceptance in addition to earlier native archive
rehearsals. D09 still needs final required gates at the final exact source; these
affected tests do not close it. The owner's no-rebuild instruction is preserved.

No retention duration or RTO/RPO target is invented. Hosting migration work is
deferred as requested. Live model/browser, private object-store and recovery
acceptance remain explicit open requirements.
