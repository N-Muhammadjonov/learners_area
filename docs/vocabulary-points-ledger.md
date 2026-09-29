# Vocabulary points ledger: Part 1 contract

## New events

| Event | Points | What the server requires |
|---|---:|---|
| Save a new vocabulary entry | 0 | No point event is written. Duplicate saves are still idempotent. |
| Scheduled revision | +1 | The entry must be due; the server advances the schedule. The unique key identifies the exact prior `nextReviewAt` occurrence, so an HTTP replay cannot pay twice, while a later genuine scheduled occurrence can. A scheduled attempt is rewarded whether recall was right or wrong. |
| Verified game answer | +1 | The authenticated user's entry must belong to the selected server-derived set, and the submission kind must match that game's mechanics. The server grades the stored word/example; Matching Pairs also submits both entry IDs, which the server checks for ownership, set membership, and identity equality. No client `correct`, `eligible`, or `points` field is accepted. |
| RIWI-accepted sentence | +2 | The API stores the sentence as unevaluated first, then accepts only the RIWI evaluator's `verdict === "correct"`. The unique key is learner + saved-word id + SHA-256 prefix of lowercased, whitespace-collapsed, punctuation-normalized text. Reposting identical normalized text under a new usage id earns 0 the second time. |

Flashcard self-assessment, incorrect answers, skips, and submissions incompatible with a game's verified mechanics award 0. Correct Matching Pairs award only after the server validates the selected pair. Games never modify SRS. The unique ledger index is the final replay guard. Game dedupe scope is one saved word × game mode × selected set (folder/topic identity where relevant) × Asia/Tashkent calendar day; a repeat in that scope awards 0. Another game or another calendar day is a different attempt scope.

Leaderboard lifetime totals and rank are aggregated from `vocab_point_events`; the browser cannot submit totals. Recent provenance shows only positive current-style awards and deliberately does not label a legacy new-word row as a current award.

## Historical rows and safety

No data migration or database mutation is included in this Part 1 code change. Existing QA/Production `new_word` rows and all other historical rows remain immutable and continue to contribute their stored `points` to lifetime ledger sums. Consequently, an existing account's historical total can include old +2 word-save awards (and old sentence values); this is intentionally not silently rewritten. Future saves create no `new_word` row and return 0. Recent-award provenance excludes `new_word`, so it will not claim that saving a word currently earns points. If the owner later wants historical totals rebased, that requires an explicitly approved, separately backed-up migration and is outside this Preview task. Production was not accessed or mutated.

## QA2 database tests

The DB integration tests run only with `QA2_DATABASE_TESTS=1` and the existing guard requires `DATABASE_URL` to use `localhost` or `127.0.0.1` with database `/learners_qa2`. Do not point these tests at a remote QA or Production database.
