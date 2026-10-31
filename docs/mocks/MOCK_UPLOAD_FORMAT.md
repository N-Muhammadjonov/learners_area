# Learners Area — dedicated Mock material uploads

Management → Mock Tests → Mock yaratish. The four non-Speaking slots accept **new Mock-only** structured UTF-8 `.json` files. They do not import content from the Listening MCQ, ordinary Reading, or Writing practice banks.

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

Upload the original Task 1 chart/image as PNG or JPEG in the separate media field. For Task 2, upload a different JSON with its full prompt and no media attachment.

## Speaking

**Do not upload a Speaking JSON.** Select one existing site topic for each of Part 1, Part 2 and Part 3. Every active question in the selected topic is frozen into the Mock’s version-bound content snapshot. The existing Speaking question bank is not edited.

## Security and publication

Only assigned management roles (`teacher` for own drafts, `owner` globally) may create material. Existing student attempts and other practice materials are not modified. A material is versioned when uploaded; Mock publication still performs complete server-side integrity validation. Media must be stored successfully before the material version is created. The browser never receives official answer keys before submission.
