# Reading workspace and catalogue presentation

The Reading catalogues keep the Learners Area shell and wallpaper. Lessons,
Academic, General and Question Types each have one section heading above the
navigation, matching Listening. Redundant Back, Lessons history/author actions
and the Retention Reading shortcut are removed. The underlying author/history
routes retain their existing permissions.

Academic intro, attempts and General sessions retain their public URLs but live
under the authenticated `(focus)` route group. The site sidebar, topbar and
wallpaper cannot mount around a session. A shared viewport grid owns the header,
independently scrolling passage/questions, resizable separator, text size controls
and persistent question navigation/submission. Mobile uses passage/question tabs.
The existing draft, timer, deadline, grading and General Check controllers are
preserved; no extra answer keys, lexical data or permissions reach an active exam.

The global blue-glass rules explicitly exclude a mounted Reading focus surface,
including input and dictionary popup styling. The catalogue is unaffected. Answer
fields start at 16 characters and remain bounded by the question pane. Repeated
word-limit hints are omitted when the authored group instruction already states
the limit.

General shows one card per passage, grouped by source test, with filters,
question-type badges and real per-passage progress. The duplicate set-card list is
removed; legacy set/full-session URLs remain supported. Database pagination remains
bounded and existing source IDs and content are unchanged.

General lexical lookup prioritises the longest exact authored occurrence over its
component words. Competing senses and invalid offsets fail closed. Recognition of
`find out` and its separable/inflected forms prevents a shorter word occurrence
from supplying an incorrect meaning. Recognition supplies no invented definition:
without an authored full-phrase occurrence, the existing unchecked-meaning UI is
used. Lookup/save endpoints still recheck access and contextual identity.

## Design evidence

- Owner-provided screenshots of the requested white split-pane interface.
- Owner's available `99 Actual IELTS Reading Passages — IELTS Booster.html` and
  [reference catalogue](https://booster-bonus.pages.dev), for per-passage grouping.
- [British Council computer-test features](https://takeielts.britishcouncil.org/what-is-ielts/how-it-works/test-modes/ielts-on-computer):
  timer, question navigation, adjustable text and highlighting.
- [IELTS official sample/practice experience](https://ielts.org/take-a-test/preparation-resources/sample-test-questions/academic-test):
  three Reading parts and 40 questions. This is Learners Area practice, not an
  official IELTS product; no third-party branding or scripts are embedded.

The two newly named Downloads HTML paths were absent in this workspace; the
available original library HTML, screenshots and official sources were inspected.

## Validation

Focused UI coverage verifies Academic lexical isolation, General lookup/Check,
autosave, restored answers, XSS handling and registry controls. Phrase cases cover
overlapping occurrences, ambiguous meanings, separable forms and lookup request
identity. Catalogue SQL and existing focus/access contracts remain covered.
Browser acceptance checks layout and white question/input styling before release,
then the authenticated production route. No content import or migration is needed.
