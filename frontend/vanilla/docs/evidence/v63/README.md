# V63: four remaining frontend routes (client delivery, NOT live acceptance)

Base inspected: `main` b62b78f469e4f73aa80f441f630b012dc422af39 (read-only).
Arena baseline inspected: `arena/96836bcf-learners-area` a35fbb7f90f94bd9b6e84f9ee996bbdc005e6e3c.
This package does not push, merge or change any Next.js original, database, Python backend or production site.

## Scope and implementation

1. **Grammar Lesson Authoring** (`/app/grammar/lessons/author`) uses the existing full native Listening LessonAuthoringDesk (V41) with `learningArea='grammar'`. It retains revision hydration, draft-only editing, lesson block editor (8 block types), upload controls, unit keyset search, publication/archiving with capability gate and existing write API, server issue handling, unsaved-change confirmation. Back links and new-lesson area are grammar-specific.
2. **Reading Lesson Authoring** (`/app/reading/lessons/author`) uses the same engine, with `learningArea='reading'`, reading back links, area-specific list projection and isolation. No duplicate editor or divergent business logic is introduced.
3. **Listening Tests Catalogue** (`/app/listening/tests`) is a native page showing the same `academicListeningCards` summary as `main` source's test catalogue. Uses the existing Arena validated Academic catalogue read projection. The original route keeps `/app/listening/tests/:id` deep links, lock state, progress, result, empty and retry. Old `?page` is intentionally ignored, as on `main`. There is no invented fixed number of cards, score or locked state.
4. **Listening Entry Redirect** (`/app/listening`) now redirects with history replacement to `/app/listening/lessons`, exactly as original `main`.

### Changes to existing files

- `js/routes.js`: one missing catalogue route inventory entry and four dispatches, before existing legacy route fallbacks.
- `modules/listening/lesson-authoring.js`: only area dispatch, role gate, new form area, area-specific navigation and cross-area read DTO safety. All current Listening authoring behavior retained.

### Additions

- `modules/listening/tests-catalogue.js`
- `modules/listening/landing.js`
- `tests/v63-four.test.mjs`
- this document

## Existing write APIs used unchanged

- `GET /api/admin/content/lessons/:id/edit`
- `POST /api/admin/content/lessons/:id/revision`
- `POST /api/admin/content/drafts`
- `POST /api/admin/content/versions/:id/publication`
- `GET /api/lessons/units`
- material upload endpoints as originally implemented in the V41 desk

## Backend blocker, not hidden

The original Next.js Grammar/Reading authoring pages call `listLessonsForStaff` and `listUnitOptions` *server-side*. The Arena V41 native desk reads a **proposed** `/api/frontend/view?route=/app/{grammar|reading}/lessons/author` envelope containing `{authorized,canPublish,lessons,units}`. No existing live GET is confirmed to implement these read projections. **They are BLOCKED live until a correctly authenticated backend read projection exists.** The frontend intentionally shows an integration notice, not fabricated drafts/courses or test lessons. The backend must scope the list to the selected area + unclassified lessons, check staff authorization and mayAuthorContent, restrict publication to admin/owner, and rederive user identity from the session. The new client additionally rejects cross-area records.

The Listening catalogue reuses `/api/frontend/view?route=/app/listening/academic` (same source `academicListeningCards` as the `/tests` page); this read projection is also proposed in the existing Arena migration. No new backend endpoint is invented, and no test result is presented as live verification.

## QA performed in sandbox

- `node --test qa/unit.test.mjs`: 6/6 PASS using a clean synthetic Git checkout, including installer safety, exact routing, source drift refusal, dirty/wrong branch and double integration refusal.
- `python qa/browser-smoke.py`: 10/10 Chromium DOM fixture PASS (tests catalogue real DOM states, locked, result, empty, error/retry, entry redirect).
- `node --check` for new JavaScript code.
- **Not executed in sandbox**: full Arena npm build/test/check:assets/check:content, live backend, original-rendered visual comparison, EN/UZ and all devices. These are mandatory checks on the real checkout before pushing. Tests are synthetic and cannot establish live parity.

The legacy V36 strict visual difference, Listening importer, Vocabulary live gameplay, staff read endpoints, Coach/Assignments read projections and V61 Live Classes GET projection are **outside this four-route package** and remain outstanding.
