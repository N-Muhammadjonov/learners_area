# RIWI reference study guides and live site material

This change adds 175 original study guides: 50 Guardian/Macmillan articles with
three separately identified levels (150 guides), and 25 Cambridge grammar units.
The supplied Guardian bundle repeats one article, separates several levels into
different page ranges, and labels the first zoo level Pre-Intermediate. The
reference manifest preserves those identities and excludes overview pages from
the passage variants. The Cambridge scan was processed locally with Tesseract.
OCR was checked against covers, contents, headers, excerpts and grammar sections;
it is not represented as a verbatim proofread of every scanned token.

Only newly authored explanations and examples are distributed. Source file
hashes, page numbers, historical status and level identities are in
`services/backend/contracts/riwi_study_references_v1.json`. The publisher PDFs,
full passages, exercise keys and audio are not included. Internal permission
applies to our original notes, and does not assert a publisher redistribution
license. Historical news claims are attributed to the passage rather than
presented as current medical, legal, scientific or political facts.

Examples of guide queries: `Cambridge unit 25`, `Nominalizatsiya nima?`,
`Guardian wind farms intermediate`, and `Guardian zoos level 1`.
`/examples` continues the selected guide using another example set; `/clear`
and `/new chat` reset the local conversation context and automatically resolved material. Reply language is a separate upward UZ/ENG settings menu; changing it creates no chat turn and never retranslates history. `/language` is no longer a command.

## Activation

Run `python scripts/riwi-study-library.py --output-dir /your/review-directory`
to export two normal Owner knowledge-candidate payloads. Review the original
notes in `riwi_study_library_v1.json`, then use the existing candidate → approve
→ promote workflow in the intended QA environment. The Guardian source has 154
units (150 guides and four shared-rule records); Cambridge has 25 units. Both
stay within the existing 200,000-character source and 160-unit limits. Only
byte-matched packaged sources use intact structured units; arbitrary uploads
retain the general parser limit. Existing rights, scope, conflict and regression
checks remain in force. Runtime retrieval requires the exact active source
checksum and the current unit hash. Raw structured JSON is filtered from generic
retrieval, including truncated snippets.

## Site material

RIWI automatically resolves a named material or module from the question and an owned, unexpired conversation. It asks for clarification when a match is ambiguous. There is no manual material picker. Eligible content includes current published Reading passages, Listening transcripts, Writing model answers, Language Stealing patterns, Speaking model answers, TED/podcast transcripts and finished Retention versions. Reads use current canonical tables in place, so future
published material is available without exporting a global copy. Search is
literal, bounded to 30 results, and requires narrowing when there are more.

The reply uses neutral teaching headings and omits publisher names, PDF/page labels, provenance footers and source buttons. Internal source hashes, rights and citations remain available for governance. A named supported grammar topic adds the approved grammar lesson.
Speaking vocabulary retains the source's authored Uzbek sense and example.
No neural language model, external provider, general free-form semantic parser,
automatic translation of arbitrary passages or certified IELTS score is implied.

Publication, Reading set membership, Listening sequence availability and course
enrollment checks apply on the server. Students can read a full Listening
transcript only after completing the exact current published revision; missing
or historical revision identity does not reveal today’s transcript. Student
material assistance is blocked during
active Reading/Listening exams and Retention reading/recall. Retention students
can retrieve only their already finished version, including its historical
version identity. Unfinished memory-test material and scoring claims stay hidden.
Private learner answers, recordings, personal pattern banks and submissions are
not a shared knowledge source. Objective answer explanations keep their existing
post-submission, owner/roster and exact-attempt-version gates.

Production read-only inventory on 2026-11-03: 105 Reading passages; 61 published
Listening tests, of which 30 have nonempty transcript text; 15 Writing models;
150 Language Stealing patterns; 1,694 Speaking prompts with model answers;
25 TED/video transcripts; and 75 active Retention texts. Empty transcript fields
are not training evidence. This inventory is not evidence of production
deployment or of the same data being present in the separate QA database.

No schema migration is required. Main merge and production activation remain
separate from the feature-branch Preview and QA knowledge activation.


## Owner-supplied grammar document and question corpus

The November 3 revision adds 290 bilingual teaching cards and 12 support units
from the Owner-supplied original Grammar_with_Learners_Area.docx. Its SHA256 is
29bc917a2c5fb6e42696a4aa037eaa86b988ce4825f644ef957126f2baf7f86c.
Every teaching card has three bilingual examples: 290 supplied examples and 580
new examples authored for RIWI. Supporting data includes 112 irregular verbs,
25 error patterns, a 12-form tense map and 22 grammar terms. The original DOCX
binary is unchanged and not distributed. This is a rule/reference library,
not neural model training or a CEFR/band certification claim.

Build the three normal Owner payloads with
`app.riwi_grammar_reference.installation_payload(kind)` for foundation,
development and extension. Units are preserved only for byte-matched packaged
content. Exact active source/unit hashes, role/scope, conflict checks, Owner
approval and regression promotion remain mandatory. The active-unit conflict
scan is bounded at 1,000 units and still fails closed above that limit.
All three packs are active in QA (110+110+82 units); the total QA library is 665.
Production activation has not occurred.

All 1,640 supplied synthetic questions are preserved with file hashes and
category/permission decisions. They map to 287 authored bilingual response
profiles and governed lesson references. Repeated questions can share a profile;
this is not a claim of 1,640 independently generated answers. Full token/phrase
matching, curated bilingual anchors, closed Uzbek loan-word suffix rules and
Cyrillic/typo normalisation handle supported variations. Unknown inputs ask for
clarification without named topic suggestions.

Sentence support uses approved exact example translations, finite basic grammar
rules and dictionary lookups; arbitrary unseen sentences can remain unsupported.
Canonical dictionary results take priority over the approved grammar glossary.
Exact listed error patterns support correction without labelling every stylistic
alternative an error. Visible Thinking/O‘ylayapman lasts while a request is pending.

Unknown short educational questions can become private, user-scoped
`retrieval_failure` review signals. Contact details, secrets and sensitive records
are filtered out. These signals cannot automatically become shared knowledge,
even after ordinary signal review. An explicit clarification can create a local
alias within an owned, unexpired conversation; clear/new chat removes its effect.
Learner claims and private conversations are not automatically adopted as facts.
