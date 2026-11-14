# Learners Area — dedicated Mock material uploads

Management → Mock Tests → Mock yaratish. Each non-Speaking slot can bind a published canonical Exam Mode source, or accept a **new Mock-only** structured UTF-8 `.json` upload. Existing sources are frozen into teacher-owned immutable Mock versions. Academic Listening/Reading selection excludes MCQ and ordinary practice materials. Existing Reading selection is Academic only; a new General Training upload uses the selected General track.

## Listening (40 questions)

Upload a `.json` file and a real `.mp3`, `.m4a`, `.webm`, `.ogg`, `.wav` or other supported audio file. The audio file is uploaded separately in the same form; do not place arbitrary audio URLs in the JSON.

```json
{
  "title": "Listening Mock 01",
  "questions": [
    {"id": "1", "questionText": "<the original question text>", "correctAnswer": "<official key>", "type": "short_answer"}
  ]
}
```

The example shows **one item only** to illustrate the schema; the uploaded JSON must contain **exactly 40 real, distinct questions**, not placeholder copies. Include relevant options/groups/instructions and acceptedAnswers where required. No fake questions are generated.

## Reading (40 questions)

```json
{
  "title": "Reading Mock 01",
  "passages": [
    {"id": "P1", "title": "Original passage title", "bodyText": "<the complete original passage>"}
  ],
  "questions": [
    {"id": "1", "questionText": "<the original question text>", "correctAnswer": "<official answer>"}
  ]
}
```

Use **exactly 40 real questions**, grouped as printed in the official material. Include all real passages. The JSON must preserve the original question types, answer keys and word limits.

## Writing Task 1 and Task 2

```json
{"prompt":"<full original Task 1 question and instructions>"}
```

For Academic Task 1, upload the original chart/image as PNG or JPEG in the separate media field. General Training Task 1 letters do not require an image. For Task 2, upload a different JSON with its full prompt and no media attachment.

## Speaking

**Do not upload a Speaking JSON.** Select fixed topics for Part 1, Part 2 and Part 3, or use the existing per-student automatic assignment mode (Part 3 stays linked to the chosen Part 2). Every active question in the selected topic is frozen into the Mock’s version-bound content snapshot. The existing Speaking question bank is not edited.

## Security and publication

Only assigned management roles (`teacher` for own drafts, `owner` globally) may create material. Existing student attempts and other practice materials are not modified. A material is versioned when uploaded; Mock publication still performs complete server-side integrity validation. Media must be stored successfully before the material version is created. The browser never receives official answer keys before submission.

For question-level recordings and the question → audio → transcript export contract, see [Speaking question exports](SPEAKING_QUESTION_EXPORT.md).

## Native IELTS layout and Reading feedback

Set `layout` to `ielts-native-v1` for passage/part tabs, independent passage and question panes, radio choices, matching selects and inline completion fields. Each question has `part`, `groupId`, its original `type` and `options` (`label`, `text`). A group contains `id`, `part`, `title`, `instructions` and `questionIds`. Completion groups use `stimulusText` with `{{1}}` markers matching their question IDs. Heading groups can supply `sharedChoices`. Choose-two groups use `type: "multiple_choice_multi"`, `selectionCount: 2`, shared `options`, and two question IDs; both questions retain their shared `pair` numbers for grading in either order.

Reading questions may include `explanation`, `evidenceQuote` and `evidence` (`passageId`, `passageNo`, `paragraph`, `quote`). Quotes must occur exactly in the passage. These fields and answer keys are removed from exam payloads. Objective review appears only after the attempt and all four skills have been submitted.

## Locked publication and staff preview

New publication defaults to locked and writes `provenance.accessLocked` in the same update as publication. Locked catalog entries cannot start an attempt; direct start requests return `403 mock_locked`. Existing tests without this metadata retain their previous availability.

Management → Mock Tests → Create Mock lists Preview and Lock/Unlock controls. Owner can manage all tests; a teacher can manage only their own. Staff preview does not create an attempt or change learner access. `GET /api/staff/mocks/{testId}/preview` returns staff-only frozen materials, and `PATCH /api/staff/mocks/{testId}/access` accepts `{"locked":true}` or `{"locked":false}`. Lock changes do not edit the published material or existing submissions.
