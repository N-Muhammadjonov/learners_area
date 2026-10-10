This is a reconciliation packet, not an executed integration or deployment.

RIWI is pinned to `7f805af85705906f6c37710a3030f3eb357e90c0`; website is pinned to `e710ff8b354bc9271301d6bd7f6be20dbbed83f6`. The two complete, non-truncated Git trees show 335 changed common blobs, 493 website-only paths and 377 RIWI-only paths. GitHub compare returned only 300 files, so that truncated list was not used for coverage. The exact path/hash matrix is `RIWI-BATCH-15-BRANCH-DIVERGENCE.json`.

The branches diverged from `a83351a3d2fcc2e81fc024e5e1a308f3410864b9`; website is ahead by 299 commits and behind by 50 relative to RIWI. These are ancestry counts, not completion percentages. Re-read both refs before using this packet; movement requires a new comparison.

The canonical SQL shared through 0035 is byte-identical. Both branches have independently rehearsed in isolated empty PGlite databases. RIWI has 51 journal entries and 113 application tables; website has 53 entries and 119 tables. This proves canonical DDL execution locally, not native PostgreSQL concurrency, deployed schema identity or production restore.

Every 0036–0050 prefix collides. `RIWI-BATCH-15-MIGRATION-CONFLICTS.json` records both complete journal entries, timestamps, SQL SHA-256, Git blobs, object hints and actual catalog differences. The paired effects are:

| Prefix | RIWI effect | Website effect | Integration dependency |
| --- | --- | --- | --- |
| 0036 | RIWI core/governance/chat | Speaking support and folder width | Both sets of effects; preserve each SQL hash |
| 0037 | Governance hardening | Private profile photos | Users/FK/auth; storage stays private |
| 0038 | Provider experiment idempotency | Dictionary release/publish authority | RIWI dictionary adapter must use website canonical release authority |
| 0039 | Learning-signal indexes | Academic Reading sets | Canonical set membership must feed authorized objective metadata |
| 0040 | Learning retention | Content import ledger | Do not equate content-import status with RIWI knowledge approval |
| 0041 | Reviewed knowledge links | Immutable content versions | Persist both version provenance and knowledge-review provenance |
| 0042 | Private knowledge upload | Mock composition | No active-exam answer/transcript access from new mock sections |
| 0043 | Target cursor indexes | Authoring identities/type-code expansion | Map only supported authored subtypes; unknown values fail safely |
| 0044 | Owner-history indexes | Lesson blocks/responses | New response store needs explicit privacy classification |
| 0045 | Assessment contracts/owner policies | Media lessons | Policy tables remain independent of ordinary lesson content |
| 0046 | AI Speaking sessions/raw review origin | Vocabulary topic packs | Preserve session/item linkage; reconcile transcript-origin width |
| 0047 | Speaking session lifecycle | Canonical assignments/targets | Server roster/target authorizations; no client-selected foreign IDs |
| 0048 | Security signals | Typing texts/trainer | Distinct typing authorities require an explicit canonical adapter |
| 0049 | Chat online baseline | Lesson notes | Chat retention must not delete notes or academic data |
| 0050 | Fenced Speaking evaluations | Lesson learning area | Keep attempt fencing and website lesson progression |

Website 0051 and 0052 add Listening question revisions and MCQ program days. They are not RIWI 0051/0052 migrations; their authoritative question bank must be preserved and integrated with canonical objective selection. No new migration was applied by this packet.

The five changed common columns need explicit resolutions before an integration patch can execute:

| Column | RIWI / website | Required resolution |
| --- | --- | --- |
| `reading_questions.type_code` | varchar(16) / varchar(40) | Preserve 40-character authored codes; adapt the server resolver only for verified semantics. Never truncate or guess an unknown subtype. |
| `speaking_attempts.transcript_origin` | varchar(20) / varchar(10) | Preserve the wider, explicit raw/reviewed origins and website content-version link; do not infer acoustic provenance. |
| `mock_attempts.mock_test_id` | NOT NULL / nullable | Preserve composed mock sections and their immutable versions; update old joins that assume one mandatory mock test. |
| `typing_run_texts.model_text_id` | NOT NULL / nullable | Reconcile website `typing_texts` and historical `writing_model_texts` through server-loaded identities. Never accept client target text or reinterpret old NULL rows. |
| `vocab_folders.name` | varchar(80) / varchar(200) | Widen forward where needed; never silently truncate existing folder names. |

There are 22 website-only tables and 16 RIWI-only tables. The exact columns, enums, PK/FK/unique/check constraints, indexes, functions and triggers are compared in the catalog report. Website-only private/profile/dictionary history/lesson response/assignment tables must be added to a reviewed closed portability allowlist before integration; the current RIWI allowlist deliberately does not claim to cover them.

Shared snapshots 0000–0027 are identical. Website has no later snapshots, despite handwritten DDL through 0052. RIWI snapshots extend through 0050. Generating a migration from website snapshot 0027 as if it described the present schema is unsafe. Reconstruct an integrated schema/snapshot only after the SQL and declaration decisions above are made, preserving every accepted historical file.

For a future authorized integration, use an isolated reviewed integration checkout, normally starting from the pinned website source because it contains newer canonical content workflows. Port the RIWI changes by feature with a path manifest; never copy an entire conflicting `schema.ts`, journal, auth service or route tree. Review all 335 common changed paths against their recorded blobs. For core conflicts preserve DB-backed guards, active-exam isolation, official grading, objective source snapshots, owner overlay hashes, policy provenance and private resource delivery. Shared route/theme/navigation changes require the four-role browser matrix.

Existing environments can have different immutable migration histories. `scripts/migration-chain.mjs` correctly rejects unknown hashes; concatenating the two journals would not produce a safe upgrade. Preserve both deployed hash receipts. A separately reviewed integration planner must recognize the exact observed histories and append adapted missing effects with new identities after the integrated tail; it must never edit accepted SQL, fabricate old history entries or renumber applied migrations. This packet does not implement or approve that planner because no target environment/history has been identified. Rehearse fresh plus both supported upgrades and native concurrent serialization before any shared migration.

Cutover remains NO-GO. The concrete preconditions are an authorized target fingerprint, actual migration history/catalog receipt, current provider backup/PITR safety point, isolated native restore and object read-back, contract/archive compatibility, two exact-state gates and the browser/runtime matrix. Freeze writes only at an explicitly selected cutover boundary, take one consistent final snapshot, verify counts/FK/hashes, then switch one source of truth. Never introduce dual writes. If a commit outcome is uncertain, preserve staged objects and the snapshot for reconciliation; do not delete them as presumed failure. Rollback means a documented switch to the preserved coherent source/safety point, not restoring stale DDL over newer migrations. No Production restore, branch merge or infrastructure change was performed.

Final ref refresh found three new website commits and nine changed paths. Both full trees were reread; every schema/journal/SQL/snapshot blob is unchanged from the independently rehearsed 061a4d7 input, and the equivalence list is preserved. Reconciliation is now pinned to e710ff8. Preserve its Listening distinction between resumable latest, latest completed and latest graded runs: an ungraded completion must not erase an earned grade or invent one. Preserve its bounded Speaking history reads and Live Partner search refinements. These are integration obligations; remote commit descriptions are not reused as local test receipts.
