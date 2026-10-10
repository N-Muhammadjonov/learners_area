# §4 Real-browser Reading journey

Driven in real Chromium against `http://127.0.0.1:3000`, with PostgreSQL checked at every step. The learner
answers half the questions correctly and half deliberately wrongly, so the expected score is
computed by this probe and compared with what the server stored — a route that credited every
submission, or trusted a client-supplied score, cannot pass.

**25 / 25 steps passed · 1 recorded blocker(s) · 0 defect(s).**

## Answer-control shapes actually exercised

`ReadingExam.tsx` renders five different controls and they share no common data attribute:

| answer model | control | value stored |
| --- | --- | --- |
| ternary (TRUE/FALSE/NOT GIVEN, YES/NO/NOT GIVEN) | `button[data-answer-option][role=radio]` | normalised value |
| single choice with full text options | `ul[data-full-choices] input[type=radio]` | the choice text |
| single choice with letter-only options | `button[data-answer-option={letter}]`, `title`={text} | the choice text |
| multi-select | `input[type=checkbox][value={letter}]` | comma-joined letters |
| free text | `input[data-answer-input={id}]`, inline when the stem has a `___` blank | the typed text |

These were enumerated against the live DOM, not inferred from source: an earlier revision of this
probe knew only `data-answer-option` and `data-answer-input`, failed to answer plain multiple
choice, and appeared to report a scoring defect that did not exist. Submitting also opens a
native `confirm()`, which blocks the renderer until a dialog handler accepts it.

| step | result | evidence | browser | database |
| --- | --- | --- | --- | --- |
| authenticated actor is the expected learner | PASS | demo.student@learnersarea.uz id=6a2cc410 role=student status=active; an authenticated API call answers 200 | logged in at /app | users.role=student |
| a published passage offers a real start control in the UI | PASS | 1 start control(s): {"text":"Open","card":"Urban Beekeeping and the Modern City Requested question type: True / F"} | /app/reading/question-types?type=true_false_not_given | read-only |
| clicking start opens an attempt owned by this learner | PASS | url=/app/reading/attempts/af897fee-617c-4cd9-a21f-68d3a23dcfb6?type=true_false_not_given; data-attempt=af897fee; owner matches=true; passage matches=true; status=in_progress; a new attempt row was created | /app/reading/attempts/af897fee-617c-4cd9-a21f-68d3a23dcfb6?type=true_false_not_given | reading_attempts.user_id=6a2cc410 |
| the passage text and every question render in the browser | PASS | passage blocks=1 labelled paragraphs=0 (1417 chars of text on screen); question nodes=6 of 6 in the database; countdown timer=897s; panes={"passage":"shown","questions":"hidden"}; tabs=passage/questions | 1417 chars rendered | reading_questions=6 |
| the countdown timer is running in the UI (exam timing is live, not static) | PASS | data-time-remaining=897s | [data-time-remaining] | read-only |
| the learner can switch from the passage pane to the questions pane | PASS | clicked [data-practice-tab="questions"]; questions pane is now shown | real click on the pane tab | read-only |
| every question was answered through the control its type actually renders | PASS | 6/6 answered; control shapes exercised: choice_single, ternary, text | shapes=choice_single/ternary/text | not yet persisted |
| the UI marks those questions answered and the tab counter agrees | PASS | data-answered=true on 6/6 nodes; questions tab reads "Questions6 of 6 answered" | 6 answered nodes | read-only |
| answers autosave to the database before any submit | PASS | save indicator=saved; reading_answers rows=6 of 6; attempt still unsubmitted=true | data-save-state=saved | reading_answers=6 |
| each stored answer is the one entered for THAT question (answer identity) | PASS | all 6 stored answers match the intended pattern (even order = correct, odd order = deliberately wrong) | — | reading_answers.user_answer checked individually for 6 questions |
| draft rows are either already graded consistently or grading is deferred to submit | PASS | is_correct=true on 0/6 draft rows while the attempt is open; expected if graded during autosave=3, expected if deferred to submit=0 (the route documents "grading happens once, at submit"); any other value would mean a partial or inverted mark | — | reading_answers.is_correct=0 |
| leaving and returning resumes the same attempt with its answers intact | PASS | same attempt id=true; answers still rendered as answered=6/6 | /app/reading/attempts/af897fee | read-only |
| SEC-12 exam seal: no meaning lookup or vocabulary saving in the sealed exam surface | PASS | lookup/dictionary/save-word controls=0; clickable word targets=0; lexicalAssistance enabled in the DOM=false (ReadingExam passes lexicalAssistance={false}) | 0 lexical controls present | read-only |
| submitting produces an authoritative server-side score | PASS | score=3 of 6; expected from the answering pattern=3; is_correct rows=3; submitted_at set=true; status=completed; before submit score was null; native confirm dialogs accepted=1 | clicked [data-submit-attempt], accepted 1 confirm dialog(s) | reading_attempts.score=3 |
| the score is NOT the number of answers submitted (grading is real, not crediting) | PASS | answered 6, scored 3 — a route that credited every submission or trusted a client score would report 6 | — | score=3 != questions=6 |
| a replayed submit with ALL-CORRECT answers cannot re-grade a sealed attempt | PASS | well-formed replay carrying 6 correct answers → HTTP 409 body="{"error":"already_submitted"}"; score stayed 3 (a re-grade would have produced 6); attempts for this learner+passage=1 | — | reading_attempts.score=3, count=1 |
| after submission the exam is replaced by a read-only review | PASS | exam component unmounted=true; submit control gone=true; editable question nodes left=0; per-question evidence blocks in the review=6 of 6; type breakdown rows=4; score shown in the UI=3/6; remaining enabled inputs are shell chrome, not answer controls: ["INPUT[checkbox]@other","INPUT[checkbox]@other","INPUT[checkbox]@other"] | ReadingAnalysis review rendered | status=completed |
| the review shows the per-question result for every question | PASS | 6/6 questions carry a data-evidence block; UI score "3/6" equals the database score 3/6 | data-evidence per question | score=3/6 |
| reloading a submitted attempt server-renders it read-only (the seal is durable) | PASS | HTTP 200; exam component present=false; answer controls rendered=0; evidence blocks=6 | fresh navigation to the attempt | read-only |
| NEGATIVE CONTROL: answers cannot be written after the attempt is sealed | PASS | PATCH on the real answer-write path with well-formed correct answers → HTTP 409 body="{"error":"already_submitted"}" (the route maps already_submitted to 409); rows holding "tampered"=0; score still 3 | — | reading_answers + reading_attempts re-read after the attempt |
| the attempt persists in Reading history | PASS | HTTP 200; the row still exists for this learner=true with score=3; links to it on the page=1; score visible=true; rendered: "← Back Your attempts Urban Beekeeping and the Modern City Score: 3/6" | /app/reading/history | reading_attempts id=af897fee |
| progress figures are recomputed from this learner's attempts and match PostgreSQL | PASS | HTTP 200; reading card present=true; attempts shown=1 vs database=1; accuracy shown=50% vs round(3/6*100)=50%; submitted=1; card reads "Reading 1 attempts 50% 1 submitted" | [data-progress-module="reading"] value=50% | reading_attempts: attempts=1 submitted=1 score=3/6 |
| NEGATIVE CONTROL: student B opening A's attempt sees none of A's protected data | PASS | HTTP 200 (a 200 here is the known valid-UUID/no-row routing decision, judged separately); A's unique wrong-answer string present in B's HTML=false; answer controls rendered=0; B id=8676829b; rendered: "Learners Area This page was not found. The link may be out of date, or the address may hav" | B loaded /app/reading/attempts/{A's id} | reading_attempts.user_id != 8676829b |
| the privacy judgement is made on the PAYLOAD, not the status code | PASS | status and leakage are recorded on separate axes; a streamed 200 shell whose body holds none of A's answers is a routing decision, not an IDOR | — | read-only |
| B cannot write to A's attempt through the real routes (refusal AND no DB effect) | PASS | PATCH → 404 "{"error":"not_found"}"; POST submit → 404 "{"error":"not_found"}"; DB effect: owner still 6a2cc410 (B is 8676829b), score still 3, answer rows still 6 | — | reading_attempts.user_id unchanged, score=3, reading_answers=6 |
| General Reading Passage 1 / 2 / 3 / Full Reading, and the formal 3-passage/40-question Academic exam | BLOCKED | OWNER_ASSET_REQUIRED — general_reading_sets=0; sets satisfying the page's own rule (exactly 3 sequentially numbered passages, 40 questions total, none empty)=0; reading_passages carrying test_no=0; reading_assessments rows=0. The UI shows an honest empty state rather than a broken list: "← Back General Reading Learning mode: read at your own pace, check your answers, and look up words right in th". §4 forbids fabricating IELTS materials, so no substitute was invented and this is recorded, not silently skipped. | /app/reading/general HTTP 200 | general_reading_sets=0, numbered passages=0 |

## Mutation test — the seal assertions are effective, not vacuous

§11: a test that still passes with the production guard removed is not a security test. The
critical property here is that a submitted attempt cannot be re-graded, so it was attacked
directly. `submitReadingAttempt` guards the seal twice: an early return when
`attempt.status !== "in_progress"`, and a `where` clause on the final UPDATE that repeats the
same status condition. Both were disabled in one mutation (the guard was rewritten to
`attempt.status !== "in_progress" && attempt.status !== "completed"` and the UPDATE's status
condition dropped), the mutant was built and served — build `k_fNBk6tzzGtgxjjcbS23`, distinct
from the clean build `cRV__skGjhqx7kUCPb7zX`, because a mutation tested against a running
`next start` would exercise the previous compilation and prove nothing.

Three independent assertions went RED, and the probe exited 1:

| assertion | clean build | mutant |
| --- | --- | --- |
| replayed submit with all-correct answers | `409 already_submitted`, score stays 3 | `200 {"ok":true,"score":6}` — the sealed attempt was re-graded |
| database score after the replay | 3 | 6 |
| `reading_answers` rows for the attempt | 6 | 12 — the re-grade inserted a second graded copy |

The source was then restored byte-exact (`cmp` clean, no `MUTATION-PROBE` markers, empty
`git diff`), rebuilt clean, and the journey re-run to 25/25 with exit 0. The row sweeper removed
the mutant's extra rows and reported no residue, and all 21 baseline tables were re-checked
afterwards and found unchanged.

## Blocker

General Reading (Passage 1 / Passage 2 / Passage 3 / Full Reading) and the formal Academic
Reading exam are `OWNER_ASSET_REQUIRED`: `/app/reading/academic/[setId]` refuses any set that is
not exactly 3 passages with exactly 40 questions, and no qualifying set exists in the database.
§4 forbids fabricating IELTS materials, so no substitute was invented. The UI states this
honestly to the learner rather than rendering a broken list.

