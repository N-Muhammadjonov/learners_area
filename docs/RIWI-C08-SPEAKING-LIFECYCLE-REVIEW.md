# C08 reviewed Speaking lifecycle — proposal only

State: PROPOSED, NOT_EFFECTIVE. No owner approval, deletion executor, scheduler or R2 lifecycle is enabled. D01's chat retention is independent. The machine-readable proposal is RIWI-C08-SPEAKING-RETENTION-PROPOSAL.json. Its durations and comparisons are candidates for review, not a privacy policy already accepted by the owner.

| Data class | Candidate lifecycle | Consequence and required decision |
| --- | --- | --- |
| Private recording object | Created-at age > 30 + 7 grace days; exact boundary retained | History keeps the attempt/metrics, but playback would become unavailable. Actual private object deletion/read-back requires an authorized store and a separate executor. |
| Raw transcript | Created-at age > 90 + 7 days | Clear raw text; origin/hash/timing metadata survives until metrics expiry. |
| Reviewed transcript | Created-at age > 90 + 7 days | Clear reviewed text; no raw-to-reviewed substitution. |
| Evaluation prose and quotations | At the earlier raw/reviewed expiry, propose redaction of derived text | Do not leave transcripts in quoted feedback. Exact allowed metric fields must be agreed before execution. |
| Metrics and linked evaluations | Created-at age > 730 + 7 days | Propose explicit linked-evaluation deletion and attempt deletion; evaluations.source_id has no FK, so relying on a cascade is insufficient. Session item/retry references can become null under their existing FK rules; downstream history must disclose missing source evidence. |
| Active recording, evaluator claim token, active session (direct or item link), recorded hold | Retain all linked classes, regardless of age | Claims still present are blocked even when their lease time is expired. Active abandoned shells need their own reviewed inactivity/cleanup policy before deletion; age alone never deletes them. |
| Pending/failed/abandoned uploads | Existing upload-intent cleanup remains separate; this proposal enables no new cleanup | Audit existing admin cleanup and private object rollback on an identified environment. Do not present count-of-expired-intents as proof they were deleted. |
| User/account deletion | No change to current account deletion pathways | DB cascades alone do not prove private audio, detached evaluations, exports or backup copies were removed. Require separate object enumeration, ownership and physical read-back receipts. |
| Export and backup copies | No implicit expiry or retroactive purge | Owner must specify export purpose, copy inventories, expiry, restoration window and hold propagation. Live-store deletion cannot be counted as backup deletion. |

Alternative durations returned by the external packet remain options: minimal audio 30/transcript 180 days, continuity audio 90/transcript 365 days, or no automatic deletion. They differ from the local 30/90/730 candidate above. No variant has been chosen or marked effective. Keeping evaluation prose indefinitely after source expiry would retain quoted transcripts and must be explicitly resolved, not silently inherited from those alternatives.

Before enforcement, record policy version, approver, approval timestamp, effective date, retention age anchor, class durations, jurisdiction/purpose, soft-delete or grace/rollback rules, hold and backup behavior, and withdrawal/account-deletion obligations. Broad instructions to finish groups are not a recorded choice of these particular durations.

The canonical read-only repeatable-read snapshot reads metadata and presence flags, not transcript/audio contents. It includes both direct and item-linked sessions, validates evaluation/session ownership, and refuses unsafe object keys before planning. Recording status and byte-size fields are required; older snapshots without them must be re-exported and cannot silently count as complete.

Dry-run outputs list eligible/ineligible attempt IDs, action counts, blocking reasons and proposed history consequences. `audioDeletionBytes.recordedBytes` sums only DB-recorded sizes of objects in delete_audio decisions; `unknownSizeObjects` preserves missing-size uncertainty. Protected objects do not inflate that sum. These are metadata amounts, not live R2 inventory or physical byte read-back. No raw text, key secret, database DSN or audio bytes are emitted in the plan.

Executable checks use isolated fixtures only. Boundary, claim/hold/active-session/active-recording, foreign key scope, unknown size and read-only tests are in tests/speaking-retention-plan.test.ts and tests/speaking-retention-snapshot-db.test.ts. External microphone/STT/store/lifecycle and the exact owner policy remain open, so C08 does not earn full-group closure.
