# Learners Area refinement status 2026 10 04

Base: 447cf120318bc93931cde50d0b90790267826a2f. Production is excluded. Preview migration 0037 was explicitly approved and already applied; do not reapply it.

## Changes

- Day uses the supplied gold/blue transparent logo cutout; Night retains its existing mark. Shared action colours are blue/violet. Focus layout removes desktop width limits.
- TED practice below the video uses the actual ten-lesson PDF's prediction, gist, detail, vocabulary matching, collocation gap, noticing, speaking, summary and delayed retrieval tasks. Content attaches by exact normalised lesson title; a Study With Me video is not assigned fabricated TED questions. Publishing those ten video records is separate from the practice implementation.
- Owner HTML/ZIP Listening runs its own HTML/CSS/JS in an opaque sandbox. The launcher receives inert media Blobs and creates local URLs so audio plays without exposing credentials or resource URLs. The two supplied formats and a foreign unversioned manifest are covered. Vocabulary and Script Completion open the host folder picker; explicit Save uses the canonical site Vocabulary service. Unknown contextual senses remain unresolved. Source exercise state is device-local, not a server-certified IELTS/mock result.
- Listening catalogue is shared by staff and learners; upload appears in Academic, name-only edit and recoverable archive preserve attempts. Additional-question editor is removed from the catalogue. Native exam Notes precedes Volume; the authored runtime adds Notes beside known Volume controls. Authored-only imports do not advertise fabricated native question counts/progress or start empty native graded attempts.
- Partner has centred student/photo avatars, controls below the profile, topics before questions, instant topic/question search, Next/Back, adjacent entry microphone check, auto availability when the realtime service and eligibility/rules permit. No manual Go Online button. Leaving the room cleans presence; in-call users are busy. Actual remote two-user calling needs configured signalling/TURN and is not certified by local component tests.
- Profile supports circular 256px PNG cropping, private upload and authenticated removal. Browser upload/removal were exercised locally.
- Shadowing is removed from navigation/lessons; the retired route redirects. Administrator/owner duplicate My Students is removed; teacher roster restrictions remain. Management home is above People under Main.
- People links to stored student mock statistics/trend and separate Reading/Listening/Speaking/Writing results. No invented missing-test dates or overall IELTS bands.
- Retention exports student data/results directly as PDF/DOCX/ZIP without RIWI. Owner authorization, bounded repeatable-read snapshot, private delivery and audit apply. Unicode font ships in the traced route. ZIP contains JSON/PDF/DOCX plus checksums.
- Speaking topic management filters Part 1/2/3 and searches topic/question/cue text.

## Verified evidence

- `../evidence/refinement-runtime-final-gate-2/summary.txt`: native PostgreSQL 1056/1056; UI 208/208; typecheck, lint, build and whitespace checks passed. The earlier gate exposed two defects, both repaired before this passing gate.
- The later browser-discovered Partner button label repair is covered by `../evidence/partner-next-final-tests.log` (4/4), including an actual Next transition. The final delivery build passed after that repair and the authored-import metadata clarification; 20 final importer/literal regressions and lint passed. Browser search `whe` displayed Hometown, and Next moved from question 1/3 to 2/3 (`../evidence/partner-next-question-final.png`).
- Actual first HTML: six source activities render, Script Completion audio plays (1645.034671 seconds; readyState 4), publication opens the same learner document. Vocabulary reasonable returned Saved; Script Completion give someone a lift opened the site folder selector. Screenshot `../evidence/authored-listening-vocabulary-saved.png`.
- Actual ZIP named Listening Test 2 internally identifies itself as Listening Test 10. Its own nine-activity window and source Script Completion render; its audio plays. Publishing the ZIP succeeded, and its original + Add to Vocabulary opened the Listening folder picker and returned Saved (`../evidence/authored-zip-vocabulary-saved.png`). Inspection preserves 15 vocabulary entries and its JPEG map without inventing native questions. The filename is not used to rewrite its internal title.
- The earlier original Listening Test 2 HTML was parsed and browser-imported as 40 exam questions / 60 script gaps / eight activities; its full source path subsequently disappeared from Downloads. The preserved DATA/PARTS fixture tests that format, but it is not a substitute for the full original HTML runtime file.
- `../evidence/student-export-tests.log`: Unicode PDF pagination, DOCX XML and ZIP checksums passed. PDF and the complete single-page DOCX sample were rendered and visually inspected; no missing Uzbek/Cyrillic glyphs or clipping.
- 0037 strict-TLS Preview backup/restore and post-apply preservation receipts are in `docs/receipts/`; 98 old tables preserved, 17 schema checks passed, no pending migrations.

## Delivery and remaining acceptance

At the time this file is written the refinement is local. Record the actual commit, Preview Ready deployment and exact `/api/version` SHA before claiming it is live. Authenticated Preview browser acceptance is required separately from local evidence.

Network-dependent uploaded apps, module dependency graphs and multiple unbound binary assets require packaging adaptation. This importer does not promise that every arbitrary internet application will run unchanged. Real microphone permission and two-person remote audio acceptance remain separate checks; missing realtime infrastructure must be reported.

The owner will supply the Vocabulary system for its subsequent audit after this batch. That future audit has not been performed against material not yet supplied.
