# Learners Area — Owner Reference Package — 2026-10-02

Branch target: `arena/01a0f1a0-learners-area`

This folder contains the **last 15 owner screenshots from the ChatGPT conversation** that must be used together with:

`docs/arena-prompts/LEARNERS_AREA_ARENA_MASTER_PROMPT_V2_ULTRA_STRICT.txt`

## Mandatory handling

Arena must inspect **all 15 images** before implementation. Do not treat these images as decorative attachments. Each is an owner requirement/reference. Where a screenshot shows a current defect, fix the underlying product behavior. Where a screenshot shows an external reference, reproduce the interaction model/information hierarchy in Learners Area branding without copying third-party branding, copyrighted lesson content, logos, or proprietary text.

If a screenshot conflicts with older reference material, the latest owner prompt and these screenshots take priority.

## Screenshot index

1. `01-ted-youtube-more-videos-copy-link.webp`
   - Current Learners Area TED/PODCAST player state.
   - Shows YouTube-native “More videos” / link surfaces that the owner dislikes.
   - Audit app-owned vs provider-owned controls honestly; do not claim cross-origin iframe chrome was removed unless browser-verified.

2. `02-ted-opinion-summary-current.webp`
   - Current standalone TED/PODCAST lesson activity area.
   - Shows Your opinion / Summary structure and current spacing/typography.
   - Preserve accepted standalone activity contract while fixing missing Transcript/content states.

3. `03-reading-academic-general-mapping-current.webp`
   - Current Reading tab mapping defect.
   - The visible library/search/filter/passage-selection experience is currently under Academic Reading but owner requires it under General Reading.
   - Swap semantic content/data/URL/subtitle behavior, not labels only.

4. `04-retention-result-memory-current.webp`
   - Current Retention result/memory screen.
   - Preserve working score/history/memory behavior and visual hierarchy while avoiding regressions during Reading work.

5. `05-listening-import-intent-failed-transcript-blockers.webp`
   - Current Listening ZIP import failure.
   - Shows raw `intent_failed` and transcript blockers.
   - Fix the upload-intent/storage/import pipeline and human-readable errors; do not merely hide the code.

6. `06-speaking-hub-current-shadowing-no-material.webp`
   - Current incorrect Speaking hub.
   - Shows small top buttons, Shadowing at top level, and generic “no materials” state.
   - Final owner target is exactly four large primary entries: Speak with a partner / Practice on your own / Practice with AI / Speaking lessons.

7. `07-speaking-partner-practice-reference.webp`
   - Owner visual reference for large Speaking cards.
   - Use structural hierarchy and scale as reference, not external branding.
   - Learners Area final hub must be four cards, responsive and accessible.

8. `08-writing-translation-module-overview-reference.webp`
   - Writing module/navigation reference.
   - Shows the richer Writing product information architecture and Translation context.
   - Use together with the master prompt’s eight Writing workspaces.

9. `09-writing-activation-lab-reference.webp`
   - Activation Lab reference.
   - Shows own-list vs random words, mode selection, level/feedback setup, right-side explanation/stats.
   - Use real Learners Area vocabulary state and real AI provider; no fake stats.

10. `10-writing-question-types-reference.webp`
    - Translation/Task 2 question-type selector reference.
    - Required families: Opinion, Discussion, Problem-solution, Advantages-disadvantages, Two-part question.
    - Use accessible large selectable controls.

11. `11-writing-translation-active-reference.webp`
    - Active sentence-by-sentence Translation exercise.
    - Shows current-sentence focus, progress/timer, source-vs-answer workspace, future sentence locking.
    - Future model answers must not be leaked to the browser merely hidden with CSS.

12. `12-writing-translation-assessment-reference.webp`
    - Translation assessment result reference.
    - Target concepts: overall result, Meaning kept, Grammar, Vocabulary, band-level usage, sentence-by-sentence YOURS/MODEL/NOTE, Top 3 fixes.

13. `13-writing-activation-lab-detailed-reference.webp`
    - Additional detailed Activation Lab reference.
    - Reinforces setup hierarchy, practice mode, optional translation/upgrade path, real session metrics and mentor visibility rules.

14. `14-writing-grade-my-work-input-reference.webp`
    - Grade My Work submission form reference.
    - Requires Task 1/Task 2 choice, exact question, essay editor, real word count/autosave, New submission/My essays.
    - AI grading must use the existing external OpenAI provider architecture when presented as AI.

15. `15-writing-ai-assessment-result-reference.webp`
    - Grade My Work AI assessment result reference.
    - Requires OVERALL + exactly four IELTS criteria, examiner comment, criterion narratives, sentence-level corrections and top fixes.
    - Task 1 uses Task Achievement; Task 2 uses Task Response.
    - Never present RIWI heuristic fallback as external AI grading.

## Master prompt

Read this file **in full, from first line to last line** before editing:

`docs/arena-prompts/LEARNERS_AREA_ARENA_MASTER_PROMPT_V2_ULTRA_STRICT.txt`

Do not replace it with an older prompt from `arena/reference-materials`. Reference-material files remain supporting evidence; this V2 prompt plus the latest owner screenshots are the active execution contract for this work.

## Before coding

1. Verify branch and SHA.
2. Verify working tree.
3. Read the entire master prompt.
4. Inspect all 15 screenshots.
5. Read relevant `arena/reference-materials`.
6. Audit current code paths named by the master prompt.
7. Run baseline build/tests required by the prompt.
8. Only then edit.

No reset, rebase, force-push, merge to main, or Production changes.
