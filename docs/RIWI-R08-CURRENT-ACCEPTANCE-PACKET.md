# Current evidence and reviewed code publication

Candidate source: `fdc822b9e14e1acfbbafcb8bff799c54d2ede71b248b8ae4eb559bc1a63e2a7d`
(1249 canonical files). Published RIWI base:
`5203241429908f66913529ec96b0214bd814da35` on `arena/01a10bac-learners-area`.
Verdict: NO-GO for operational cutover. No mandatory missing evidence is waived.

## Evidence dossier

| Scope | Result and evidence |
| --- | --- |
| Current source identity | All 1249 hashes independently rechecked in `evidence/riwi-interim-7-8-9-12-13-review/current-book-reconciliation.json`. New QA scripts/docs are outside that runtime inventory and have separate publication hashes. |
| Full native local gate | `RIWI-R06-LOCAL-VERIFICATION.json` and `evidence/riwi-r06-native-round1/`: 1478 backend / 261 UI, 0 fail/skip, typecheck/lint 0, 53 R06 HTTP and 13 R04 HTTP. Second interrupted round does not pass. |
| Five-group focused review | 94 backend tests, 0 fail/skip. Exact log and counts in `evidence/riwi-interim-7-8-9-12-13-review/focused-verification.json`. Fixtures/PGlite are not provider or browser evidence. |
| Prompt Book | Full original SHA and 68 task fields independently match. Registry count 106. Catalog acceptance is separate from every-task semantic acceptance. |
| R07 | Safe local rehearsal script prepared. Preflight refused absent psql/pg_basebackup before creating any cluster. External reported restore receipt is retained as a claim, with timing corrections. Provider restore remains open. |
| Browser/live environment | R06 student local Safari login observed; full four-role and exact deployed acceptance incomplete. Live provider and signed private object URL expiry remain open. |
| Deployment/build | No current-candidate deployment or production build claimed. Existing Preview is older; no shared migration or hosted write performed. |

## RIWI publication preparation

The incoming ZIP contains no runtime patch. Preserve the current R06 source
repair and add only reviewed QA documentation/evidence. Prepare the complete
path/hash diff against the published base. Verify the remote branch again before
publication; a changed head requires review of the newer work. Preserve new
remote work and use a normal non-force push. Never reset, rebase, switch, stash,
clean, merge or renumber migrations to make the diff fit.

The earlier plan deferred the combined push until R06 closure. After the owner
attempted the terminal push, the publisher was corrected to distinguish reviewed
code publication from operational acceptance. The current code and evidence can
be pushed together while R06/R07/R08/B01/B04/B05 retain their exact pending
statuses. A successful push does not earn closure credit or permit cutover.

## Website integration and cutover

`RIWI-BATCH-15-INTEGRATION-RUNBOOK.md` and
`RIWI-BATCH-15-MIGRATION-CONFLICTS.json` retain the concrete historical
0036–0050 collision analysis. Those historical website/RIWI SHAs are not current
cutover identities. Read both current complete trees and target migration
receipts before any integration. Never apply the RIWI journal to the newer
website database or replace its schema wholesale. The active task prepares RIWI
publication; it does not rebuild or merge the Learners Area website.

Actual cutover requires an identified isolated target, current schema/history,
provider safety point and tested isolated restore, private object read-back,
exact candidate deployment, four-role browser/live-provider matrix and all
mandatory requirement gates. Select contractual RPO/RTO only from an explicit
owner decision. Do not infer them from the synthetic receipt.

Abort on source/hash mismatch, migration identity conflict, fail/skip, incorrect
role authority, private data disclosure, provider/restore uncertainty or absent
mandatory evidence. Preserve the coherent pre-cutover source and safety point.
Rollback selects that coherent source and verified restore/object mapping; it
does not revert immutable migration files or restore stale DDL over newer data.
Check restore compatibility before switching traffic. No cutover, infrastructure
change or Production restore has been performed.

Closure ledger: 20/34 (58.823529%). RIWI/site overall percentages remain unknown.
