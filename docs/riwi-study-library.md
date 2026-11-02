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
and `/new chat` reset the local conversation context and material selection.

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

The chat's **Study a site material** disclosure searches current published
Reading passages, Listening transcripts, Writing model answers, Language
Stealing patterns, Speaking model answers, TED/podcast transcripts and finished
Retention versions. Reads use current canonical tables in place, so future
published material is available without exporting a global copy. Search is
literal, bounded to 30 results, and requires narrowing when there are more.

The reply labels selected source excerpts separately from original teaching
examples. A named supported grammar topic adds the approved grammar lesson.
Speaking vocabulary retains the source's authored Uzbek sense and example.
No neural language model, external provider, general free-form semantic parser,
automatic translation of arbitrary passages or certified IELTS score is implied.

Publication, Reading set membership, Listening sequence availability and course
enrollment checks apply on the server. Student assistance is blocked during
active Reading/Listening exams and Retention reading/recall. Retention students
can retrieve only their already finished version, including its historical
version identity. Unfinished memory-test material and scoring claims stay hidden.
Private learner answers, recordings, personal pattern banks and submissions are
not a shared knowledge source. Objective answer explanations keep their existing
post-submission, owner/roster and exact-attempt-version gates.

Production read-only inventory on 2026-11-03: 105 Reading passages; 61 published
Listening tests, of which 31 have nonempty transcript text; 15 Writing models;
150 Language Stealing patterns; 1,694 Speaking prompts with model answers;
25 TED/video transcripts; and 75 active Retention texts. Empty transcript fields
are not training evidence. This inventory is not evidence of production
deployment or of the same data being present in the separate QA database.

No schema migration is required. Main merge and production activation remain
separate from the feature-branch Preview and QA knowledge activation.
