# Mock Speaking: question, audio, transcript export

The owner downloads the batch and supplies it to an external AI manually. This
feature makes no grading, STT-provider or paid AI request. It does not decide
which of two future recognizers is more accurate without reference evidence.

## Capture and file format

New question-mode attempts bind each frozen question ID to its own original
recording and recognition text, rather than treating an entire Part as one answer.
The ZIP contains manifest.json, questions.txt and original audio files. Each
question/cue card in questions.txt is followed by its exact audio filename, then
its transcript candidate; the next question follows in the same source order.
A unique question filename prevents one Part 1 answer from replacing another.
No student name/email/phone is added. Anonymous student IDs and immutable attempt
IDs connect the export to the import schema.

Audio bytes are never recompressed or rewritten. Upload and export verify byte
length and SHA-256. Finalized recordings and transcript captures are immutable;
exact network retries return the existing capture. Different audio or text for
an already finalized question is refused. Missing/changed media cannot produce
an apparently complete ZIP or DOCX. Batches split by attempt count and 64 MiB
audio size. A single attempt above that bound returns controlled 413. One export
assembles per worker; concurrent exports get retryable 503 while it runs.

Recognition preserves its returned characters, fillers such as ummm, repeats,
source errors and whitespace. No grammar correction or filler removal occurs.
This is NOT a guarantee that recognition heard every sound correctly. Optional
browser recognition requires processLocally=true; no cloud fallback or model
download starts silently. When unsupported, audio still saves and transcript
status unavailable is explicit. Available text is browser_unverified, not certified
verbatim. The student cannot see it during Exam. A 100% verbatim claim requires
checking against actual audio; engine confidence is not proof.
See [MDN local processing](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally)
and [recognition confidence](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionAlternative/confidence).

External grading must listen to original audio, rather than judge pronunciation
from text. Imported graded evidence must identify every frozen question correctly;
duplicate, missing or foreign question IDs are refused. FastAPI computes bands.
Import creates drafts; separate Teacher/Owner approval and publication are required.
Editing JSON or batch selection invalidates prior/in-flight validation results.

## Storage, authorization and rollout

The additive migration 20261101134624_mock_speaking_question_captures.sql creates
one private RLS-enabled table. It does not alter/drop legacy recordings, existing
questions, answers or grades. Anonymous/authenticated Data API roles have no access.
Backend routes enforce active student ownership and the current Speaking window.
Teacher media/batch access requires the current assigned roster; Owner can access
all; operational Admin cannot access private results/recordings.

Question uploads are bounded to 10 MiB, ten minutes per capture and the server
Speaking deadline. Stream and aggregate export limits bound memory/disk usage.
The application detects the new table only at attempt creation. Existing attempts
keep original Part mode and persisted deadlines. Deploy verified code first;
only after approval apply the table to production and start question-mode attempts.
Without it, Part recording continues; the question endpoint returns a controlled
unavailable response. Application startup never applies DDL. Once question-mode
attempts exist, retain a runtime that understands them. Prefer forward repair to
rolling back to an incompatible release; never delete captured data as a rollback.

## Related repaired flows

New Mock Writing gets the full shared 20 + 40 = 60 minutes. Existing persisted
deadlines are not extended. Dedicated Task 1 images use authorized Mock media;
General letters need no chart. Writing DOCX preserves original prompts, embedded
image bytes and student answer text. Ordinary Writing Exam expiry is owner-scoped;
revision/text autosaves commit atomically. A stale different answer is refused as
a conflict and kept visible locally for copying. Same-content retries remain
idempotent. Practice stays untimed/local, without paper creation or submission.

Automated evidence uses disposable PostgreSQL and synthetic users/media in
mock_upload_export_probe.py and writing_exam_integrity_probe.py, plus essential
frontend interaction and lifecycle tests. Manual microphone accuracy, visual/device
acceptance and any external AI grading remain the owner's checks.
