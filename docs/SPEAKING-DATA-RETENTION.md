# Speaking data retention

Audio, raw/reviewed transcript, attempts, sessions, evaluations and per-user usage are private classes independent from 30-day/latest-60 RIWI conversation pruning. Access is owner-scoped to the learner/product roles. Deleted/expired objects must be removed privately and never resurrected by import. Security logs must not copy raw audio or unnecessary transcript.

**OWNER ACTION REQUIRED:** approve a concrete duration, legal/product exceptions, deletion grace period, retry/orphan cleanup interval and whether historical evaluations remain after audio deletion. Closure does not silently invent these values.
