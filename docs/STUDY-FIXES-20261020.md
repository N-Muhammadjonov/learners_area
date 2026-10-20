# Study, dictionary and account corrections — 20 October 2026

## Dictionary

The active full release remains `rel-v1-e7fa84dde5eec2f502957489`: 64,616 entries, 109,487 meanings and 81,099 source examples. Immutable source bytes, IDs, translations and attribution remain unchanged. Presentation metadata is derived from that approved source; see [source and attribution](DICTIONARY-R2-RELEASE.md). The source is not included as a new public download.

Every source entry, meaning, relation and example was scanned. Exact English definition + POS groups produce 151,665 synonym links across 61,773 meanings. Explicit source relations and small original editorial additions produce 2,457 phrase links across 2,092 meanings. Shared spelling alone cannot attach an idiom. This is an automated consistency audit, not independent human review or a claim that missing collocations have been authored for all meanings.

41,157 existing examples contain their headword or a supported inflection. The other 39,942 shared-synset examples remain in the source but are withheld from that word's learner card. The forecasting sense of `prefigure` has an original, sense-specific sentence. Saved-word materialization uses the same display policy; an idempotent mapped-example repair changes only example text, never meanings, saved associations, scores or SRS.

Synonyms and combinations now live inside each expanded meaning. Links carry their destination meaning ID. Metadata is checksum verified and tied to each English meaning; changing an English meaning invalidates old links. Uzbek-only edits retain links. The folder dialog contains one collapsed chooser regardless of folder count.

## Learning and management

Standalone TED/Podcast uses transcript, teacher notes, vocabulary and written/local voice reflection. Transcript opens in a blue dialog. Teacher vocabulary can be outside the transcript, using a separate authored-word segment rather than fictional transcript offsets. Existing course lesson questions remain unchanged. Local recordings can be played, recorded again or deleted; leaving the lesson releases the microphone and recording. Audio is not uploaded.

Statistics and individual results omit Assignments and the duplicate separate Retention section while retaining recorded results. People places Search before Role, hides last visit/session duration while online and uses exact Tashkent time offline. The vocabulary leaderboard shows 15 leaders by existing earned word points plus the caller's rank/name/English level. Day flashcard queues use blue/white; Revision uses a 3D flip. Typing Race changes only word-group gaps and correct-answer green. The dashboard has one IELTS label.

## Accounts

Profile can edit the existing onboarding study fields. Exam date uses explicit numeric day/month/year controls with real-calendar server validation. The IELTS label asks for the last awarded score. Profile shows the linked Telegram username and verified phone.

A verified student can change Telegram binding without changing the internal user UUID or learning history. The operation requires the current session, a fresh same-browser intent and the new Telegram account's verified phone; conflicting accounts fail closed and old sessions are revoked. Staff authority still uses its separate verified handover process. Signup and bot admission ask for a full name; a Telegram display name cannot overwrite an active student's chosen name.

## Validation

Targeted database, security and UI tests cover exact-sense links, full source counts and checksums, unrelated examples, saved associations, account replacement and replay protection, profile validation, authored video vocabulary outside transcript, top-15 ranking, recorder cleanup and Revision flip. All 42 bot tests pass. Browser and deployment receipts are recorded separately; unit tests alone are not production acceptance.
