# RIWI selective learning and chat lifetime

RIWI remains a rule-based assistant. This feature learns bounded language
interpretations; it does not train an LLM or treat chat statements as new facts.

## Selection and correction

1. Reviewed informal Uzbek forms are normalized for retrieval. Original learner
   writing, quoted English, uploaded documents and displayed chat text stay intact.
2. An explicit mapping, such as `"qilesan" deganim "nima qilyapsan" degani`, or a
   confirmed clarification after an unknown answer, can become private memory.
   A target must be a reviewed control phrase, social intent, or exact topic from
   a currently active lesson. Assertions about a topic do not qualify as its name.
3. Accepted mappings belong to one authenticated user. A new, valid explicit
   correction replaces that user's previous interpretation, increments a revision,
   and keeps three small correction-history entries plus an audit hash. Existing
   reviewed meanings cannot be silently remapped to contradictory meanings.
   Retirement review uses the original message timestamp, so older writing cannot
   overwrite a more recent explicit correction.
4. Unverified factual questions continue through the existing bounded private
   review-candidate queue. Shared factual knowledge still follows the existing
   candidate, review, approval, activation and conflict/supersession workflow.
   No chat automatically writes global knowledge. Lesson references are checked
   against active knowledge at use time; answer bodies are not cached as memories.

Only explicit, short phrases qualify. Credentials, contact numbers, personal
results and other filtered personal content are rejected. File/material turns
and external-provider answers are excluded from retirement review. Student
learning writes are disabled during active assessments. Public signal APIs cannot
mint the reserved private-language model namespace.

There are at most 256 accepted private mappings per user. Existing mappings can
still be corrected at that limit. A lookup applies at most four non-overlapping
control substitutions in one pass. Social/topic mappings match the whole query.
Translation and sentence-correction requests keep their original source text.

## Persistence and deletion

Active-chat messages expire individually at seven days. New Chat archives the old
conversation once, with a fixed `archivedAt + 30 minutes` deletion deadline.
Repeated archive requests and later chats do not extend it. After retirement,
the seven-day per-message rule stops applying to that chat; it stays whole until
its retirement deadline. Before retirement,
the selector reviews up to 200 recent short user turns and keeps at most 20 valid,
distinct explicit mappings. It does not copy whole conversations or assistant
answers. Already reviewed conversations are marked to avoid repeated extraction.

Mappings use the existing server-only `riwi_learning_signals` table in user scope,
with a language-key UUID unrelated to conversation IDs. They therefore survive
raw-chat deletion without retaining its transcript. No new application schema is
needed. Archive/learning and turn/budget writes use one borrowed DB connection and
a transaction, including when the HTTP handler uses the read-pool facade.

The UI and API enforce visibility deadlines immediately. The QA database's
minute maintenance job physically reclaims expired rows; request-time cleanup
also removes expired rows for the authenticated actor. An idle database may have
up to one maintenance interval of physical cleanup delay. Production scheduler
activation remains a separate Owner-approved operation.

## Conversation budget

The server caps retained user/assistant message content at 128,000 Unicode
characters per conversation. It checks the whole next turn under the same lock
and transaction as insertion; an oversized turn is not partially saved. The UI
shows chat usage, preserves an over-limit draft and keeps New Chat available.
`characters / 4` is explicitly an estimated token count, not a billing meter.

## Evidence

Automated tests cover dialects, private scope, correction, source revalidation,
unsafe-input rejection, quota behavior, budget rollback and use across new chats.
Rollback-only SQL probes exercise the actual generated PostgreSQL statements on
temporary QA tables. They never modify live learner data. Native microphone
acceptance and browser proof are reported separately from automated tests.
