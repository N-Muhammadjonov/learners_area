# Vocabulary points ledger: Part 1 contract

## New events and effective leaderboard values

| Event | Effective points | What the server requires |
|---|---:|---|
| Save a new vocabulary entry | 0 | No point event is written. Duplicate saves are still idempotent. |
| Scheduled revision | +1 | The entry must be due; the server advances the schedule. The unique key identifies the exact prior `nextReviewAt` occurrence, so an HTTP replay cannot pay twice, while a later genuine scheduled occurrence can. A scheduled attempt is rewarded whether recall was right or wrong. |
| Verified game answer | +1 | The authenticated user's entry must belong to the selected server-derived set, and the submission kind must match that game's mechanics. The server grades the stored word/example; Matching Pairs submits both entry IDs, which the server checks for ownership, set membership, and identity equality. No client `correct`, `eligible`, or `points` field is accepted. |
| RIWI-accepted sentence | +2 | The API stores the sentence as unevaluated first, then accepts only the RIWI evaluator's `verdict === "correct"`. The unique key is learner + saved-word id + SHA-256 prefix of lowercased, whitespace-collapsed, punctuation-normalized text. Reposting identical normalized text under a new usage id earns 0 the second time. |

Flashcard self-assessment, incorrect answers, skips, and submissions incompatible with a game's verified mechanics award 0. Correct Matching Pairs award only after the server validates the selected pair. Games never modify SRS. The unique ledger index is the final replay guard. New game-answer dedupe scope is **one saved word × learner × Asia/Tashkent day across all game modes and sets**. Playing the same word in another mode that day is still useful practice but earns no second point.

Leaderboard lifetime totals and rank are derived from ledger event **kind**, not obsolete stored numeric values: `new_word → 0`, `revision → 1`, `game_answer → 1`, `sentence → 2`, unknown kinds → 0. Only student accounts are ranked; zero-effective-score users are omitted from the ranked list and receive rank 0. The existing ordinal rank policy is retained, with equal totals ordered deterministically by display name and then user id. Historical game-answer rows that used earlier per-mode/set dedupe are collapsed in the effective score by learner + saved entry reference + Tashkent day. The original rows and stored amounts remain unchanged for audit provenance. Recent awards use these same effective values; zero-value word saves are omitted, and recent labels do not claim a legacy word-save award is current policy.

## Historical rows and safety

No data migration or database mutation is included. Existing QA/Production ledger rows are immutable; old `new_word` amounts no longer affect the displayed lifetime score, and old revision/game/sentence amounts are mapped to current values by kind. Historical game rows with multiple modes/sets for one learner/entry/day contribute at most one effective game point. This is a read-time scoring rule, not a rewrite of audit history. Future saves create no `new_word` row and return 0. Production was not accessed or mutated.

## QA2 database tests

The DB integration tests run only with `QA2_DATABASE_TESTS=1` and the existing guard requires `DATABASE_URL` to use `localhost` or `127.0.0.1` with database `/learners_qa2`. They cover point-kind remapping, legacy cross-mode/day dedupe, server-verifiable games, revision replay, RIWI replay, and the Writing UUID join/empty typing summary. Do not point them at a remote QA or Production database.
