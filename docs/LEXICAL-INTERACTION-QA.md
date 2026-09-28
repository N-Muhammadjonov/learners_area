# Shared lexical interaction — QA 2

## Actual inventory

The shared `ClickableText` owns selection, keyboard interaction, popup placement,
lookup cancellation and saving. Existing users: ReadingExam passage/paragraphs,
RetentionCheck (Reading analysis and standalone retention), Listening completed
attempt transcript and revision explanations, VideoLessonStudio timed transcript.
This phase also wires ReadingAnalysis evidence/explanations, SpeedTrainer transcript,
and ResourceBlocks text (the shared composer reader across lessons/material owners).
No separate podcast-transcript product exists in this checkout. Audio/video embeds,
images, PDFs and editable answer/transcript fields are not wrapped or claimed as
text lookup surfaces. No new dictionary or premium redesign was introduced.

## Contract and evidence

Words are plain inline spans with original separators, no padding/underline/hover
style and no per-word tab stops. Each text region is one labelled keyboard stop:
Left/Right, Home/End choose a word; Enter opens; Escape restores the region focus.
A live status announces keyboard selection. Pointer selection uses native browser
behavior, never preventDefault: noncollapsed selection, movement >8px, hold >=500ms,
context menu, cancelled pointer and multi-click do not open a word. Popup body portal,
viewport/column clamp, scroll/resize tracking and prior async protections remain.

Fresh full regression: 294/294, zero skipped; nested React DOM cases 13/13, including
native Selection ranges, drag/hold/cancel and keyboard navigation. An initial run
caught two ASCII-apostrophe localization regressions; corrected, then full suite
passed. Typecheck/lint passed; production build passed before the apostrophe-only
correction (the next build must include that text correction).

Real browser: 320px viewport popup x=8..312, no overflow, keyboard End/Enter opened
permission and focused the dialog; Escape returned text focus. 1440px reading has
zero word buttons. Native automation drag did not create any selection in two
attempts, and locator click did not open a popup; screenshot and DOM coordinates
differ. Do not count those as pointer PASS or assume application failure. Actual
pointer/selection verification remains pending reliable browser input. DOM tests
prove handlers, not physical interaction. Prior save/reload and current Vocabulary
folder/DB agree for decades and growing. No console errors in the folder check.
