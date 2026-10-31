# Mock Speaking assignment modes

Management -> Mock Tests -> Create Mock -> Speaking.

## Same questions for all students (`fixed`)

The existing behavior is preserved: choose one Part 1 topic, one Part 2 cue card topic, and one Part 3 topic. A published, immutable `content_versions` snapshot binds these questions to the Mock. Every attempt receives the same set.

## Auto-select individually (`auto`)

The author publishes a frozen source pool of the **active, published Speaking questions** from the existing website bank. The pool is stored in a dedicated `module='mock'`, `content_type='speaking'` version; the main Speaking practice bank is never modified.

At the start of each student's attempt, server-side cryptographic randomness independently selects:

1. One Part 1 topic, including that topic's published questions.
2. One Part 2 cue card.
3. Only the published Part 3 questions explicitly linked to the chosen Part 2, determined by **both** matching `s166-NNN` topic ID and the exact `follow_ups` question text. This avoids accidentally mixing a duplicated question from another Part 3 topic.

The resulting question set is frozen in that student's `mock_attempts.mock_snapshot.speakingMaterial`. Refresh, Back/Forward, and resume read the same selection, without rerandomizing. The full pool is never returned to the learner. The learner's Speaking recording and per-student ZIP/manifest export include the selected question IDs and actual prompt texts.

Two independently chosen attempts can coincidentally receive the same topic combination; this is probabilistic assignment, not a global guarantee of unique sets. An empty or invalid linked Part 3 pool blocks publication/start, never falls back to unrelated topics.

No database migration is needed: the existing `content_versions.content_snapshot` and `mock_attempts.mock_snapshot` JSONB fields are used. Production browser/microphone E2E testing and live database write-through were **not executed** in the offline QA environment.
