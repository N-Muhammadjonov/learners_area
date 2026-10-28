# Learners Area

Production uses Python FastAPI and the native HTML/CSS/Vanilla JavaScript frontend. The public homepage, robots.txt and sitemap.xml are served by FastAPI; account routes retain authentication and noindex. Railway builds with `python3 scripts/build_native_assets.py` and starts `python3 scripts/serve.py`. Cloudflare Worker protocols live in `workers/shared/`. Operator scripts, database migration SQL and learning content are retained. Retained TypeScript helpers serve operator CLIs only; FastAPI owns production routing, sessions, APIs and database access.


A bilingual (Uzbek/English) education platform. IELTS is the first course
inside a multi-course platform — see "Adding a new course" below.

The architecture is real: a real database, server-side authorization on every
route, and a working resource/upload system that puts bytes in Cloudflare R2
without ever routing them through the app server. It is not a finished product
— see REMAINING below.

## Stack

HTML5 / CSS3 / Vanilla JavaScript in `frontend/vanilla` for pages and UI;
Python 3.14 / FastAPI / asyncpg for static serving, browser read contracts,
authentication, lifecycle writes and PostgreSQL connections.
PostgreSQL schema and migration tooling remain Drizzle. Upload signing and AI
provider integrations run in the Python service.

This branch uses `app.asgi:application` from `services/backend`. The production
application and asset build use Python only. Browser assets are plain HTML5, CSS3
and JavaScript; no framework compilation, hydration or Node service is required.
Historical source is retained for parity tests and is excluded from deployment. The
token-protected `/_frontend/*` adapter remains separate from the browser-facing
`/api/frontend/*` read contracts.

See [the integration runtime guide](docs/vanilla-integration/README.md) for
startup, security boundaries, verification evidence and deployment limits.
Existing backend contracts and database operations remain documented in
[the backend setup and comparison report](services/backend/README.md).

## Run locally

```bash
cp .env.example .env        # configure the existing database and AUTH_SECRET
python3 -m venv services/backend/.venv
services/backend/.venv/bin/pip install -r services/backend/requirements-dev.txt
python3 scripts/build_native_assets.py
services/backend/.venv/bin/python scripts/serve.py --check
services/backend/.venv/bin/python scripts/serve.py --reload
```

Use a database with all 67 repository migrations applied. Migration and seed
commands remain available for explicitly chosen development databases; startup
never runs them.
`npm start` launches Python on port 8000. After the asset build, you can run
`services/backend/.venv/bin/python scripts/serve.py` directly without Node.
`compose.preview.yml` exposes the same Python application on port 3000.
Use `npm test` for the native frontend suite (optional Node developer tooling),
and run `(cd services/backend && .venv/bin/python -m pytest tests)` for the
Python suite. The backend README
lists the transport tests and the limits of the checks. `npm run backend:test:main`
compares the real pinned main handlers with FastAPI using isolated PostgreSQL
databases; set `MAIN_REFERENCE_ROOT` as described there. The current parity
record is `services/backend/contracts/main-parity.json`.

## Demo accounts

Created by `npm run db:seed`, passwords are dev-only:

| Role    | Email                          | Password        | Notes                      |
|---------|--------------------------------|------------------|-----------------------------|
| Owner   | owner@learnersarea.uz          | Owner12345!      | `role`='owner' — the only role that may manage ownership |
| Admin   | admin@learnersarea.uz          | Admin12345!      | `role`='admin' — admission, content, users |
| Teacher | teacher@learnersarea.uz        | Teacher12345!    |                              |
| Teacher | teacher2@learnersarea.uz       | Teacher12345!    | second teacher, used when testing an ownership transfer |
| Student | demo.student@learnersarea.uz   | Student12345!    | onboarded, has real history |
| Student | new.student@learnersarea.uz    | Student12345!    | fresh account, empty states |
| Student | pending.student@learnersarea.uz| Student12345!    | status `pending` — the admission screen has something to decide |

Authorization reads `users.role` (`owner` > `admin` > `teacher` > `student`).
`users.is_owner` is a historical column kept for the migration only: it is never
the authority, and no account above relies on it. The first owner of a real
deployment is created with `node scripts/bootstrap-owner.mjs --email <addr>`
(refuses to run while an active owner exists), and ownership moves only through
the audited, re-authenticated transfer in the owner area.

## Environment variables

See `.env.example` for the full annotated list. Names only, never values, and
never `NEXT_PUBLIC_*` for a secret — that inlines it into the browser bundle.

Core: `DATABASE_URL`, `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`.
Storage: `STORAGE_PROVIDER`, `R2_*` / `S3_*` (see below), `MAX_*_UPLOAD_MB`.
Optional: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`.
Feature flags: `BILLING_ENABLED`, `PUBLIC_PAYMENT_ENABLED`, `REAL_AI_ENABLED`,
`SAT_ENABLED` — all default `false`. See `src/lib/config/flags.ts`.

---

## File storage: Cloudflare R2, private by default

Learners Area keeps its storage **private**, and that has to be true for every
provider, not only for R2. Course content is authenticated educational material,
so there is no public bucket URL anywhere in this project, and no `*` origin,
and no `S3_PUBLIC_URL_BASE` variable to set. Files are delivered through one
authenticated route that authorizes the caller per object and then issues a
short-lived signed URL.

The `local` provider writes to `.data/uploads` (`STORAGE_LOCAL_DIR` overrides
it) — **outside** `public/`, and this is not a cosmetic choice. Next serves
everything under `public/` as a static file, so `GET /uploads/<key>` used to
return an applicant's document or a student's recording to anyone holding the
key, with no session and no authorization. The web root is not an object store:
the object key is not a secret, it travels in the URL the signed-in student is
given, so a second delivery path would make the authenticated one decorative.

Upgrading an existing deployment from the old layout is a one-time move:

```bash
mkdir -p .data && mv public/uploads .data/uploads
```

`scripts/verify-uploads.mjs` fails if an object is ever written under `public/`
or served from a static path again.

### Choosing a provider

`STORAGE_PROVIDER` (see `services/backend/app/step19_storage.py`):

| value    | provider                     | browser uploads directly? |
|----------|------------------------------|---------------------------|
| `local`  | `./.data/uploads` on disk    | no — bytes proxied through the app server |
| `r2`     | Cloudflare R2                | **yes** — presigned PUT straight to R2 |
| `s3`     | AWS S3 / MinIO / Spaces / B2 | **yes** — presigned PUT straight to the bucket |

`r2` and `s3` resolve to the same class on purpose: R2 implements the S3 API
and the same SigV4 signing scheme, so a second implementation would buy
nothing. `R2_*` variable names win over `S3_*` when both are set, so an
existing S3 configuration keeps working unchanged.

`local` is fine for development and for single-node self-hosting. It does not
work on hosts with an ephemeral or read-only filesystem (Vercel's default, for
one) — use `r2` there.

### Setting up R2

1. Cloudflare dashboard → R2 → create a bucket → "Manage R2 API Tokens" →
   create a token scoped to **that one bucket**, Object Read & Write (not
   Admin).
2. Set in `.env`:
   ```
   STORAGE_PROVIDER=r2
   R2_BUCKET_NAME=<your bucket name>
   R2_ACCESS_KEY_ID=<from the token>
   R2_SECRET_ACCESS_KEY=<from the token>
   R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   R2_REGION=auto
   ```
3. **CORS** — required for direct browser→R2 uploads. The browser uses the
   original presigned R2/S3 URL; do not route that signed PUT through a Vercel
   rewrite. Bucket → Settings → CORS Policy:
   ```json
   [
     {
       "AllowedOrigins": [
         "https://learnersarea.uz",
         "https://learners-area-git-arena-learners-area-next-learners-area.vercel.app"
       ],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3000
     },
     {
       "AllowedOrigins": ["http://localhost:3000"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3000
     }
   ]
   ```
   The second origin is the stable Vercel branch alias for
   `arena/learners-area-next`; use that alias for Preview QA instead of a
   one-off deployment hostname. Keep only exact trusted origins; never use
   `"*"`. Exposing a bucket or an origin more widely than this is the one
   change that would undo the private-by-default model.
4. **Do not** enable public access on the bucket. The app does not need it.

### The upload lifecycle

Every object goes through the same four steps, in both `direct` and `proxy`
mode, so the bookkeeping is identical:

```
1. POST /api/uploads/intent     server authorizes session + role + ownership
                                of the target material + file category + MIME
                                + extension + size, then generates an
                                unpredictable object key and issues a
                                5-minute presigned PUT for exactly that key
2. bytes                        browser PUTs straight to R2 (direct mode),
                                or POSTs to /api/uploads (proxy mode, local
                                disk). Real progress comes from XHR
                                upload.onprogress — fetch() cannot report it
3. POST /api/uploads/finalize   server HEADs the object, compares content
                                type and size against what the intent
                                declared, and only then marks it finalized
4. claim                        the resource create/update route resolves an
                                uploadId to the intent's own metadata
```

The application server never proxies production upload bytes. `STORAGE_PROVIDER=local`
is the only configuration that routes bytes through the app, and it does so
because there is no second host to talk to — not as a shortcut.

### Object keys

The original filename is never the identity. Identity is a UUID inside a
namespace, generated server-side (`src/lib/uploads/keys.ts`):

```
resources/<materialId>/primary/<uuid>.<ext>     editing an existing resource
pending/<intentId>/primary/<uuid>.<ext>         resource not created yet
resources/<materialId>/blocks/images/<uuid>.<ext>
resources/<materialId>/blocks/audio/<uuid>.<ext>
resources/<materialId>/blocks/files/<uuid>.<ext>
speaking/attempts/<attemptId>/audio/<uuid>.<ext>   a practice recording
```

The `pending/` namespace is what abandoned-upload cleanup sweeps: anything
still there past its intent's expiry is an orphan and gets deleted
(`POST /api/admin/uploads/cleanup`, admin-only). The original filename is kept
as display metadata only. Every key is additionally rejected by
`isSafeObjectKey` if it could escape the storage root.

### Reading files

`GET /api/resources/<objectKey>` is the only delivery path.

- It requires a session.
- It looks the key up in the database to find which material **or Speaking
  attempt** owns it. A practice recording is readable only by the student who
  made it and by a teacher/admin reviewing it — never by another student.
- It allows the read when the material is active, or when the caller manages
  that material (its author, or the platform owner). A deactivated resource
  stops being readable by students immediately, not whenever a cache expires.
- `r2`/`s3`: authorized reads use a 5-minute signed GET transport. Browser
  uploads are separate: the client PUTs directly to the original provider-signed
  URL and therefore require exact-origin R2/S3 CORS.
- `local`: streams the bytes from disk with `Range` support so `<audio>` and
  `<video>` seeking works.
- An unknown key answers **404**, not 403, so the route cannot be used to
  enumerate what is in the bucket.

The database stores `objectKey` and the stable `/api/resources/<key>` path —
never an expiring signed URL.

### Cleanup

- Removing a block deletes its object. Replacing one deletes the obsolete
  object only after the new one is authoritative.
- Deleting a resource deletes the primary object and every block object.
- Cancelling an upload deletes its object.
- The DB write commits first and storage cleanup follows. If storage cleanup
  fails it is logged, not fatal: the safer failure direction is a possibly
  orphaned object, never a resource pointing at bytes that no longer exist.

---

---

## Speaking practice

A student picks a prompt (`/speaking/practice`), gets a prep countdown, records
with `MediaRecorder`, reviews the take, uploads it and submits. Submitted
attempts are listed at `/speaking/history` with the recording playable inline.

```
GET  /api/speaking/prompts              active prompts
POST /api/speaking/attempts             create (status: recording)
GET  /api/speaking/attempts             own history; teacher/admin see all
GET|PATCH|DELETE /api/speaking/attempts/[id]
POST /api/speaking/attempts/[id]/submit
```

Authorization, all server-side:

- An attempt belongs to exactly one user. A stranger reading or scoping an
  upload to someone else's attempt gets 403; a submitted attempt rejects further
  recording uploads with 409.
- The recording goes through the same upload lifecycle as resource blocks
  (intent → PUT → finalize → HEAD verify) and lands under
  `speaking/attempts/<attemptId>/audio/<uuid>.<ext>`.
- Submitting requires a finalized, attached recording; there is no half-submitted
  state.
- Discarding an attempt is only possible while it is still `recording`, and the
  object is deleted with it.

Codec negotiation lives in `src/lib/audio/recorder.ts` (webm/opus → ogg/opus →
mp4/aac), the microphone stream is always released on stop or cancel, and the
recorder surfaces a typed `RecorderError` so the UI can distinguish a denied
permission from a missing API instead of showing a generic failure.

---

## AI Coach (RIWI + any future provider)

The Coach evaluates student work. It is **provider-independent**: RIWI, the
internal evaluator, runs with no API key at all, and any external AI can be
connected later as a drop-in adapter without touching a service, route, page or
database column.

### Services

Each domain has its own service, and they share one resolver, one registry, one
result schema, one persistence layer, one weakness history and one fallback
policy (`src/lib/services/coach/`):

| Service | File | Source of the work |
| --- | --- | --- |
| `WritingEvaluationService` | `writing.ts` | a writing submission |
| `SpeakingEvaluationService` | `speaking.ts` | a speaking attempt transcript |
| `GrammarEvaluationService` | `grammar.ts` | a produced (written) grammar answer |
| `VocabularyFeedbackService` | `vocabulary.ts` | a sentence using a target word |
| `AssignmentEvaluationService` | `assignment.ts` | an assignment (orchestrator) |
| `PronunciationEvaluationService` | `pronunciation.ts` | whether pronunciation can be judged at all |
| `StudyRecommendationService` | `recommendations.ts` | the learner's weakness rows -> next actions |
| `SpeechToTextService` | `stt/` | audio -> text, **separate on purpose** |

Assignment evaluation is an orchestrator, not an evaluator: an assignment linked
to a writing prompt is delegated to the writing service, a free-form response is
resolved generically, and objective multiple-choice grading never reaches a
provider at all.

`PronunciationEvaluationService` owns one decision — can pronunciation be judged
in this deployment? It asks the registry for providers that really declare audio
analysis, and when there are none the speaking result carries a band-less,
explicitly `limited` pronunciation criterion. `StudyRecommendationService` turns
the learner's weakness rows into at most three ordered actions (one per practice
area, strongest signal first) for the Coach dashboard; with no evaluated work it
returns nothing rather than advice with no evidence behind it.

### Provider resolution

```
Evaluation request
      |
      v
 AIProviderResolver                 (src/lib/services/coach/resolver.ts)
      |
 AI_PRIMARY_PROVIDER  -- "riwi" --> RIWI evaluates, nothing external is called
      |
      +-- "<external id>"
             | capability check (the provider must declare the capability)
             | bounded retries (transient failures only)
             | validate the response against the evaluation contract
             | success -> that provider's result is the only result
             +-> any failure -> RIWI evaluates instead
```

* Timeout, network error, provider 5xx, rate limit, quota, bad credentials,
  malformed response, schema mismatch, missing capability, an unregistered
  provider id and `AI_EXTERNAL_ENABLED=false` all end in the same place: RIWI.
* There is no recursive fallback. RIWI is a plain provider; it never calls the
  resolver. A RIWI failure returns a truthful error instead of looping.
* A submission that already has an evaluation is never evaluated again (a unique
  index on `(source_type, source_id)` plus a read-back makes it race-safe), so a
  provider is never paid twice for the same work.

### "Checked by ..."

Every result stores **who produced it** - provider id, display name, type,
version, model, prompt version, rubric version, and `fallback_used` /
`fallback_from`. The label shown to the student is read from that stored row,
never from configuration, so changing `AI_PRIMARY_PROVIDER` tomorrow cannot
relabel yesterday's feedback.

```
Checked by RIWI                      <- every evaluation produced internally
Checked by <display name>            <- a configured external provider that answered
```

If the configured provider fails, the UI says **Checked by RIWI** and the row
records `fallback_used = true`, `fallback_from = <that provider>`.

### What RIWI can and cannot do

| Capability | Real | Notes |
| --- | --- | --- |
| Writing: task response, coherence, lexical resource, grammatical range | yes | Word count vs target, paragraphing, sentence-length profile and variation, type-token variety, repetition, cohesive-device usage and overuse, overview/position detection, pattern-level grammar checks |
| Speaking: fluency, lexical resource, grammatical range | yes | From the transcript plus the recording duration: words per minute, hesitation sounds, vague phrases, discourse markers, answer length against part expectations |
| Speaking: pronunciation | no | Returned as `limited` with a **null** band. Judging pronunciation from text is not possible, and RIWI refuses to guess |
| Grammar production | verdict | Target structure present, sentence completeness, pattern detection. Correct / mostly correct / needs correction - never a band |
| Vocabulary active use | verdict | The word is genuinely used in a complete sentence, in a plausible form, without a known-wrong pattern. Recognising a word and producing it stay separate signals |
| Free-form assignments | verdict | Measured facts only (length, structure, cohesion, repetition). No band, because there is no rubric to band against |
| Any semantic judgement (argument quality, relevance, register) | no | Never claimed. Confidence stays below 1.0, and criteria that cannot be verified say so |

### Adding an external provider

```
1. src/lib/services/coach/providers/<vendor>/index.ts   -> implement EvaluationProvider
2. src/lib/services/coach/providers/index.ts            -> add it to bundledProviders
3. environment                                          -> its credentials (server-side only)
4. AI_PRIMARY_PROVIDER=<provider-id>                    -> deploy
```

`EvaluationProvider` (`src/lib/services/coach/types.ts`) is five optional
methods; an adapter declares the capabilities it really has and the
environment-variable **names** it reads. Every vendor-specific request and
response shape stays inside the adapter folder. `tests/support/test-provider.ts`
is a working example of an adapter that lives entirely outside the application.

### Coach data

* `evaluations` - one authoritative row per submission, with evaluator identity,
  criteria, strengths, weaknesses, issues, next actions and recommended practice.
* `coach_weaknesses` - the learner's shared weakness history, fed by RIWI and by
  any external evaluator through the same function. A category a later evaluation
  checks and does *not* flag moves open -> improving -> resolved. One clean pass
  never erases a pattern.
* `vocabulary_usages`, `assignment_responses` - the work an evaluation refers to,
  so feedback can never be displayed without the submission it judged.
* Teacher feedback lives in `writing_feedback` and is a separate track: an
  automated evaluation never writes there and never overwrites a teacher's
  judgement. Teachers see both, side by side, on the student page.

The Coach dashboard (`/coach`) answers "what do I keep getting wrong", "what
improved", "what should I practise now" and "what should I review today" from
those rows only. There is no synthetic trend line and no placeholder number: an
empty section says it is empty.

---

## Privacy and boundaries

* `resolver.ts`, `registry.ts`, `config.ts`, every adapter and the STT subsystem
  import `server-only`, so a client component that reaches them fails the build.
* External adapters never receive local identity: the resolver replaces the user
  id with `external-anonymous` and forwards only the text (or transcript) and the
  language the task needs. `tests/coach-providers.test.ts` asserts this.
* Provider credentials are read from the server environment by the adapter that
  needs them. Nothing is exposed through `NEXT_PUBLIC_*`, and `.env.example`
  contains names only.
* Speech-to-text is a separate subsystem with its own provider switch
  (`STT_PRIMARY_PROVIDER`): a transcription vendor is never reported as the
  evaluator, and an attempt's transcript records whether it came from STT or was
  typed by the student.
* An evaluation never stores a file URL or a signed URL; recordings stay private
  objects behind `GET /api/resources/<objectKey>`.
* `tests/coach-privacy.test.ts` asserts all of the above as source-level
  invariants, and `scripts/verify-coach.mjs` asserts it over HTTP.

---

## Resources (Telegram-shaped content)

A resource is a **primary file or link** plus an **ordered list of description
blocks** — not one textarea. Blocks may be text, link, image, audio or file,
in any order, with repeats. Order is persisted as `position` in
`material_blocks`; it is not left to client array order.

The composer (`/teacher/speaking`, `BlockComposer.tsx` +
`PrimaryFileField.tsx`) is shared by create and edit, so both surfaces behave
identically:

- a compact **+** opens File / Image / Audio / Text / Link — no giant modal,
  and native file selection with an `accept` filter
- drag-and-drop reorder on desktop, **plus** up/down buttons, so keyboard and
  touch users are never blocked by the fancy path
- per-file state: queued → uploading → finalizing → complete / failed /
  cancelled, with real byte progress, retry and cancel
- images show a local blob preview immediately, and the blob URL is revoked
  when the real object is available
- blocks that are already stored are labelled "kept as-is", so it is visible
  that saving will not re-upload them
- drag a file onto the composer to add it as a block

Editing an existing resource supports: rename, replace the primary file, edit
text blocks, add/remove/reorder blocks, replace an attachment, and delete.
Retained attachments are **not** re-uploaded and are **not** deleted by a
reorder.

Ownership is enforced server-side by `src/lib/auth/ownership.ts`: any
teacher/admin may create; only the author or an `isOwner=true` account may
edit or delete someone else's resource. `isOwner` has no UI yet — it is a
direct database flag (see `seed.ts`, where the seeded admin has it).

---

## Architecture notes

- **Auth**: email/password (bcrypt + a signed JWT session cookie via `jose`,
  edge-compatible so `middleware.ts` can verify it without a DB round trip)
  and Telegram login. Route protection + role checks live in `middleware.ts`;
  every API route that touches teacher/admin data **also** checks the role
  server-side, rather than relying on middleware or a hidden button.
- **Upload policy** lives in one place, `src/lib/validation/uploads.ts`, and
  is imported by both the client (pre-flight feedback) and every server route
  (authoritative check). There are no magic size constants in components.
- **i18n**: a small custom dictionary system (`src/lib/i18n`), not next-intl —
  the Uzbek file is typed against the English file's exact shape
  (`uz: Dictionary`), so a missing or mistyped key is a build error, not a
  silent blank string in production.
- **Writing evaluation**: `WritingEvaluationService` is an interface
  (`src/lib/services/writing-evaluation/types.ts`). The only implementation
  right now is a transparent heuristic — word count, sentence length, lexical
  variety, linking-word usage — clearly labelled in the UI as a demo, not a
  real score. Swap in a real model call behind the same interface when
  `REAL_AI_ENABLED` goes on; nothing else changes.
- **Reading**: objective grading (`src/lib/services/reading/grading.ts`), not
  a heuristic — True/False/Not Given, Yes/No/Not Given and Multiple Choice are
  exact matches, Short Answer is a strict normalised match (no partial credit
  for a valid synonym; worth revisiting before real use). The answer choices
  for True/False/Not Given and Yes/No/Not Given (`src/lib/reading-choices.ts`)
  are deliberately NOT translated — they're fixed IELTS exam terminology, shown
  in English regardless of UI locale, the same way "Task 1"/"Task 2" aren't.
  One real bug was caught and fixed here during testing: the buttons
  originally submitted the *translated display label* as the answer value,
  which only matched the English-only `correctAnswer` stored in the database
  when the UI happened to be in English — since Uzbek is the default locale,
  this silently marked every correct answer wrong. Fixed by separating the
  submitted value from the display label.
- **Grammar**: multiple-choice error-correction, objectively graded like
  Reading. Exercises are authored content (not auto-extracted from a student's
  writing — that needs real NLP/AI, out of scope for the demo provider) but
  can reference one of the student's own submissions for context, shown as a
  "from your own essay" badge only to that student.
- **Listening**: same exam → auto-grade → analysis pattern as Reading, audio
  in place of a passage — reuses the same upload/embed pipeline
  (`MaterialPlayer`, `/api/uploads/intent`), so a test's audio can be uploaded
  directly or linked. Multiple choice and Short Answer only (no
  True/False/Not Given — not a natural fit for audio).
- **Vocabulary**: a simplified SM-2-style scheduler
  (`src/lib/services/spaced-repetition.ts`), unit tested.
- **Responsive**: the sidebar is persistent from `md` up; below that a real
  drawer takes over (`MobileNav.tsx`) with Escape-to-close, a backdrop, and
  background scroll lock. There is no viewport at which navigation is simply
  missing.
- **Fonts**: system-font stacks (`src/app/globals.css`). Swap in
  `next/font/google` once deployed somewhere with normal internet access.

## Adding a new course (e.g. SAT)

Nothing in `users`, `courses`, `course_modules`, `units`, `lessons`,
`enrollments`, `assignments`, or auth is IELTS-specific. A new course is a new
row in `courses` plus its own modules/units/lessons — no schema changes
required for the shared systems. IELTS-specific tables (`writing_prompts`,
`reading_passages`/`reading_questions`, `listening_tests`, `speaking_prompts`)
are intentionally separate from the generic content tree.

---

## Brand and the public front door

Six approved artwork files live in **one** directory, `public/brand/`:

| File | Purpose |
|------|---------|
| `learners-area-logo-master-dark.png` | full master artwork — brand presentation only |
| `learners-area-logo-mark-dark.png` | compact mark on dark/night surfaces (sidebar, drawer) |
| `learners-area-logo-mark-light.png` | compact mark on light/day surfaces |
| `learners-area-logo-horizontal-dark.png` | wordmark lock-up on wide dark/night surfaces (auth screens) |
| `learners-area-logo-horizontal-light.png` | wordmark lock-up on wide light/day surfaces |
| `learners-area-favicon.png` | browser tab / home-screen identity |

The six files are owner-supplied artwork. The repository never draws, traces,
recolours or regenerates them, so a checkout that does not have them is missing
assets rather than broken: `tests/brand-assets.test.ts` and
`scripts/verify-brand.mjs` fail on the six 404s and pass the moment the files are
copied into `public/brand/`. That is the honest state of a fresh clone.

Their paths are written down **once**, in `src/lib/config/brand.ts`
(`BRAND_ASSETS`, `brandLogoFor()`), and every placement renders through
`src/components/brand/BrandLogo.tsx`. Swapping an asset is editing that one map;
no component builds a logo path, and `tests/brand-assets.test.ts` fails if one
starts to.

Day and Night show **different supplied files**. Both variants are rendered and
`[data-theme="night"]` on `<html>` selects one in CSS, so the correct artwork is
already painted on the server-rendered first frame and a theme switch swaps it
instantly. The artwork is never inverted, recoloured, traced or regenerated —
there is no `filter: invert()` anywhere, and the test suite checks that.

`/` is the public landing page: the headline, one divider and one action, in the
brand's night palette. The action's destination is decided on the server from the
account's real status (`/login`, `/dashboard`, or the waiting screen at
`/pending`), never from the cookie. `scripts/verify-brand.mjs` checks the whole
slice over HTTP, including that the six files are served as real PNGs.

### Who may see content: the four publication states

Authored content is not "on" or "off". Every publishable row (courses, Reading
passages, Listening tests, Writing prompts, Speaking materials and prompts, video
lessons) carries `publication_state` and `publish_at`, and exactly one function
decides what that means — `isLive()` in `src/lib/services/cms/publication.ts`:

| State | Students | Meaning |
| --- | --- | --- |
| `draft` | not visible | written, deliberately not shown yet |
| `scheduled` | visible once `publish_at` has passed | opens on a stated moment |
| `published` | visible | live now |
| `archived` | not visible | withdrawn, kept forever |

Three consequences are worth stating plainly.

1. **A list filter is not a gate.** A withdrawn passage used to be hidden from the
   list but still startable by anyone holding its id. Creation points now check
   `isLive()` and answer 404 — the same answer an unknown id gets, so a
   withdrawn title cannot be probed for.
2. **Archiving is not deleting.** A student's finished attempt, its score, its
   evidence quotes and its analysis stay readable after the content is archived.
   Only *starting* something new is refused. Nothing in the publication path
   removes a row.
3. **One endpoint, one rule.** `POST /api/admin/content/:type/:id/publication`
   serves every content type and is restricted to ADMIN and OWNER — a teacher
   authors questions but does not decide what students may see. Transitions the
   rule forbids (for example archiving and then scheduling without restoring
   first), a schedule with no moment, and a moment attached to a published row
   are all refused, and every accepted change writes an audit row with the
   previous and the new state.

`scripts/verify-publication.mjs` proves all of it against a real database,
including that an archived passage's history survives the archive.

---

## Testing

```bash
npm test                          # 232 unit tests (no database, no network)
npm run typecheck && npm run lint
npm run build
```

Against a running app with a real database:

One check needs a browser rather than HTTP, because `MediaRecorder` only exists
there — it proves a recording is not truncated and that the upload chain finishes:

```bash
npm i --no-save puppeteer-core            # not a project dependency
node scripts/browser/verify-mic-browser.mjs   # 12 checks, real Chromium, fake audio device
node scripts/browser/verify-register-ux.mjs   # 14 checks: the register button always recovers
```

The second browser script answers one question the unit tests cannot: when the API
fails, does the button return from "Loading…"? It intercepts the register call and
serves an HTML 500, then aborts the request outright, then lets a real registration
through to the waiting room, and finally performs one registration against an app
instance pointed at an unmigrated database. In all four cases the button must become
pressable again and an error must be visible. (That instance is started with
`DATABASE_URL` set to an empty database and `PORT=3001`.)

```bash
# the production migration tooling, tested against throwaway local databases
MIGRATION_TEST_ADMIN_URL="postgres://postgres@127.0.0.1:5433/postgres" \
  node scripts/verify-migration-tooling.mjs   # 24 checks: all five database states
```

```bash
# with `npm run dev` up and DATABASE_URL pointed at a seeded DB:
# verify-uploads and verify-coach need DATABASE_URL so they can assert against
# the real rows, not just the HTTP responses.
DATABASE_URL=... node scripts/verify-access.mjs        # 33 authorization checks across roles
DATABASE_URL=... node scripts/verify-pages.mjs         # 71 render checks across roles and locales
DATABASE_URL=... node scripts/verify-browser-flow.mjs  # 54 checks of the admission/login flow
DATABASE_URL=... node scripts/verify-theme.mjs         # 32 day/night checks
DATABASE_URL=... node scripts/verify-responsive.mjs    # 23 responsive-tier checks
DATABASE_URL=... node scripts/verify-vocabulary.mjs    # 103 vocabulary/SRS/points checks
DATABASE_URL=... node scripts/verify-owner.mjs         # 10 owner bootstrap/transfer checks
DATABASE_URL=... node scripts/verify-retention.mjs     # 10 retention checks with controlled timestamps
DATABASE_URL=... node scripts/verify-publication.mjs   # 34 publication-state checks (drafts, schedule, archive)
DATABASE_URL=... node scripts/verify-brand.mjs         # 31 brand checks (6 fail until the PNGs are placed)
node scripts/verify-a11y.mjs                           # 40 accessibility, locale-formatting and rendered-Uzbek checks
DATABASE_URL=... node scripts/verify-video-lessons.mjs # 17 video-lesson checks
node scripts/verify-uploads.mjs                        # 44 HTTP-level checks of the upload lifecycle
DATABASE_URL=... node scripts/verify-coach.mjs         # 21 checks of the Coach subsystem
DATABASE_URL=... node scripts/verify-shadowing.mjs     # 15 speech-shadowing checks
DATABASE_URL=... node scripts/verify-writing.mjs       # 18 writing checks
DATABASE_URL=... node scripts/verify-listening.mjs     # 45 listening checks
DATABASE_URL=... node scripts/verify-reading.mjs       # 32 reading checks
DATABASE_URL=... node scripts/verify-grammar.mjs       # 32 grammar checks
DATABASE_URL=... node scripts/verify-lessons.mjs       # 27 lesson/course checks
DATABASE_URL=... node scripts/verify-progress.mjs      # 19 progress checks
DATABASE_URL=... node scripts/verify-dashboard.mjs     # 21 dashboard checks
DATABASE_URL=... node scripts/verify-live-classes.mjs  # 24 live-class checks
DATABASE_URL=... node scripts/verify-support.mjs       # 26 support checks
DATABASE_URL=... node scripts/verify-admission-race.mjs # 6 admission-race checks
DATABASE_URL=... node scripts/verify-production-schema.mjs # 42 checks against a real (production) database
```

`scripts/verify-uploads.mjs` is the acceptance test for the resource system:
authorization boundaries (anonymous / student / second teacher / owner),
oversized and unsupported files, finalize-without-upload, arbitrary-key
injection, uploadId reuse, malformed links, private read behavior after
deactivation, path traversal, retained-vs-removed objects on edit, primary and
attachment replacement, cancel, abandoned-upload cleanup, and full deletion.
It asserts against the real server response, the real database and the real
filesystem — nothing is mocked.

`scripts/verify-coach.mjs` is the acceptance test for the Coach: an essay is
submitted, evaluated, persisted and labelled; submitting it twice does not
produce a second evaluation; a writing-linked assignment delegates instead of
re-evaluating; grammar and vocabulary production answers are graded by verdict;
and one student cannot read, write to or evaluate another student's work. It
also asserts that no credential or provider switch appears in any rendered page.

### What is NOT verified against a real bucket

The `r2`/`s3` provider has never talked to a live Cloudflare account from this
environment — no credentials and no network path to Cloudflare. It is written
against the documented AWS SDK / SigV4 behaviour, and every other layer around
it (intents, finalization, key strategy, private delivery, cleanup, the client
uploader) is exercised for real against the local provider. Treat the first
real upload as the acceptance test: upload something small, confirm the object
appears in the R2 dashboard, confirm `GET /api/resources/<key>` delivers it,
and confirm a second browser with no session gets a 401.

---

## Deploying for real

Not attempted from this environment. In outline:

1. Host the Next.js app (Vercel or any Node host) and point `DATABASE_URL` at
   a managed Postgres.
2. Set a real `AUTH_SECRET` (`openssl rand -base64 48`). Set
   `STORAGE_PROVIDER=r2` and the `R2_*` variables. **Leave the bucket
   private** and set the CORS policy to the real production origin.
3. Migrate the cloud database — see [Migrating the production
   database](#migrating-the-production-database) below. The repository ships
   ordered SQL migrations (`drizzle/0000…0016`) applied through
   `drizzle-kit migrate`, which is the production path. `npm run db:push` still
   exists for a throwaway database, but it is not how a real deployment is
   brought up.
4. Register a Telegram bot and set its login-widget domain to the real domain.
5. `npm run db:seed` only if you actually want the demo accounts in
   production — you probably don't.
6. Create the first owner once, from the machine that has the database:
   `DATABASE_URL=... OWNER_EMAIL=you@example.com OWNER_PASSWORD='...' node scripts/bootstrap-owner.mjs --email you@example.com`.
   It refuses to run when an active owner already exists, so it cannot be used to
   hijack a live deployment. Afterwards, unset `OWNER_PASSWORD` from the
   environment; there is no owner email or password in the code.
7. Set `PUBLIC_BASE_URL` to the real origin. That is what the sitemap, the
   canonical URLs and the CSRF origin check use, and it is what locks framing to
   `'self'` on the production host. Add `ALLOWED_FRAME_ANCESTORS` only if an
   embedding shell genuinely needs to frame the centre.
8. Schedule two sweeps:
   - `POST /api/admin/uploads/cleanup` (hourly is plenty) for abandoned uploads;
   - `POST /api/owner/retention` with `{"dryRun": false}` (daily or weekly) for
     the retention policy. Preview it first with `{"dryRun": true}` — the owner
     page at `/owner/retention` does the same thing with a button. Any scheduler
     works: the service is a plain function, takes an advisory lock so two runs
     cannot race, and deletes in batches of `RETENTION_BATCH_SIZE`.
9. Coach: set `AI_PRIMARY_PROVIDER` (default `riwi`). Nothing else is required —
   RIWI needs no credentials and evaluates everything on a machine with no API
   keys. To use an external model, install its adapter first (see "Adding an
   external provider"); pointing `AI_PRIMARY_PROVIDER` at an id that is not
   installed is safe but reported as a fallback in every result row.
10. Leave `STT_PRIMARY_PROVIDER=none` until a transcription vendor is configured;
   the app then states that no transcript provider exists instead of inventing
   one. Students can still type a transcript, which is labelled as theirs.
11. Do not run the seed on a production database you care about; the demo
    passwords are public.

### Migrating the production database

`npm run db:migrate` is the migration command; `scripts/migrate-production.mjs`
is the wrapper that makes running it against a *cloud* database safe, by looking
before it writes. Three commands, in order:

```bash
# 1. Inspect — read-only. Prints the chain, the current schema, and a verdict.
DATABASE_URL="postgres://…" node scripts/migrate-production.mjs

# 2. Apply — only for an "empty" or "resume" verdict. Asks you to type the
#    database name unless you pass --yes.
DATABASE_URL="postgres://…" node scripts/migrate-production.mjs --apply

# 3. Verify — read-only. 42 checks against the real database.
DATABASE_URL="postgres://…" node scripts/verify-production-schema.mjs
```

What the inspector decides, and why it is not simply "run the migrations":

| State found | Verdict | What happens |
| --- | --- | --- |
| no tables, no history | `empty` | the 17 migrations are applied from `0000` |
| history matches this journal, fewer than 17 rows | `resume` | the remaining migrations run |
| all 17 recorded | `up-to-date` | nothing to do, exit 0 (safe in a deploy script) |
| tables exist but no history | `partial` | **refused** — re-running would record migrations as applied without executing them |
| history does not match this journal | `divergent` | **refused** — the schema came from somewhere else |

Which connection string to use matters, on Supabase specifically:

| Endpoint | Port | For migrations |
| --- | --- | --- |
| `db.<ref>.supabase.co` (direct) | 5432 | works, but IPv6-only on newer projects |
| `<region>.pooler.supabase.com` (session pooler) | 5432 | **this is the one to use** |
| `<region>.pooler.supabase.com` (transaction pooler) | 6543 | refused — statements do not share a session |

The application can keep using whatever the deployment already uses; this is about
the migration command only. If the direct host fails with `ENETUNREACH`, that is
the IPv6 situation, not a wrong password — switch to the session pooler.

Nothing in the tooling drops, truncates or resets anything. It refuses to run
against `localhost` unless `ALLOW_LOCAL_MIGRATION=1` is set (that switch exists so
the tooling itself can be tested), it never prints the connection string, and it
passes `DATABASE_URL` to `drizzle-kit` through the environment rather than through
`argv`. `scripts/verify-migration-tooling.mjs` exercises all five states above
against throwaway databases on a local server.

Afterwards, if the database has no owner yet, create exactly one with
`node scripts/bootstrap-owner.mjs --email <real address>` — the verify step says
so explicitly. Never run `npm run db:seed` against production (the demo passwords
are public) and never run `reset-db.mjs` there at all; it drops the schema and is
for a local refresh only.

## Security model (what a deployment actually gets)

The server is the only authority; nothing below relies on hiding a menu item.

| Concern | Where it lives | What it does |
| --- | --- | --- |
| Security headers + CSP | `src/lib/http/security-headers.ts`, `src/middleware.ts` | Nonce-based `script-src` with `strict-dynamic`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors` decided per request (`src/lib/config/site.ts`), HSTS, `X-Content-Type-Options`, `Referrer-Policy`. `'unsafe-eval'` only in development. |
| CSRF | `src/lib/http/request-origin.ts` | Cookie-authenticated state-changing requests must come from a trusted origin (`TRUSTED_ORIGINS` + `PUBLIC_BASE_URL`). A request from elsewhere is refused before it reaches a route. |
| Abuse limits | `src/lib/http/rate-limit.ts` | Sliding window per action: failed sign-ins (per account and per IP), registration, password reset, admission applications, Telegram auth, evaluations, upload intents, vocabulary search. Only failures count against a login limit. |
| Indexing | `src/app/robots.ts`, `src/app/sitemap.ts`, private layout metadata | Only the public pages are in the sitemap; every private route is disallowed in `robots.txt` **and** rendered with `noindex, nofollow`. |
| Uploads | `src/lib/validation/uploads.ts`, `src/lib/uploads/keys.ts` | Allowlisted MIME types with size ceilings, server-generated collision-resistant keys, no browser-supplied keys, no server proxying of large bodies. |
| Audit trail | `src/lib/data/audit.ts` | Privileged events (admission decisions, role changes, ownership transfer, retention runs, content authoring, suspension) are recorded with actor, target and metadata. |

Private pages, routes and objects are guarded by database reads on every request
(`requireActiveUser`, `requireStaff`, `requireAdministrator`, `requireOwner`), so
a stale session cookie or a changed role takes effect on the next request rather
than whenever a cache expires.

## Public video lessons

A roadmap lesson can carry one public video lesson, authored in
`/admin/video-lessons` (administrators and owners) or seeded with
`node scripts/seed-video-lesson.mjs`.

- **What is stored** is a provider id and the validated video id — never embed
  HTML, never a raw URL, never a `dangerouslySetInnerHTML` blob. `video_lessons`
  has no column for markup, which is what makes arbitrary iframe injection
  impossible rather than merely discouraged.
- **Which hosts are accepted** is decided by one parser
  (`src/lib/services/video/provider.ts`): YouTube in its usual shapes
  (`watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, `m.`). A link that does not
  carry a real 11-character id is refused with a reason the author can act on,
  and the refusal is shown in the form.
- **The player** is a `youtube-nocookie.com` embed with `rel=0`,
  `playsinline=1` and a YouTube-only `frame-src` in the CSP. The video plays
  inside Learners Area, but the page says plainly that its source is still
  visible to the browser: this is convenience, not secrecy.
- **Stages exist only when they were authored**: before-you-watch, transcript,
  comprehension, script gap fill, opinion, summary. A lesson with no transcript
  shows no transcript tab instead of an invented one.
- **Transcript provenance is recorded** (`authored` / `licensed` / `permitted`)
  and displayed, and script-follow stays unavailable until the player really
  reports a position — no timestamp is ever guessed.
- **Answers are graded on the server** and the accepted answers never travel to
  the client, so the exercise still works after a refresh. The opinion and
  summary are written work for the teacher to read; they are not auto-scored and
  no model comment is invented.

## Data retention

`src/lib/services/retention.ts` is the single place where "how long do we keep
this" is decided; every window is an environment variable (see
`.env.example` → Retention) and every rule can be previewed:

```bash
# Preview (writes nothing) — also a button on /owner/retention
curl -sX POST http://localhost:3000/api/owner/retention -b "$COOKIE" \
  -H 'content-type: application/json' -d '{"dryRun": true}'
# Apply
curl -sX POST http://localhost:3000/api/owner/retention -b "$COOKIE" \
  -H 'content-type: application/json' -d '{"dryRun": false}'
```

- Inactivity is measured on **real work** (`users.last_meaningful_activity_at`,
  touched when an attempt is submitted, an evaluation is recorded or a lesson or
  video lesson is finished), never on sign-ins. A student with no recorded work
  falls back to their registration date.
- Teacher, administrator and owner accounts are outside the inactivity rule
  entirely; course and business content is never swept.
- Recordings leave the object store after their window, and only after a
  reference check; old submitted work is removed only when no evaluation refers
  to it.
- What an applicant **wrote** expires with the same six-month window as an
  inactive account: the note they sent with an application, the decision note and
  the rejection reason are cleared once the decision itself is that old. The
  decision is not erased — who applied, who decided, when and with what outcome
  stays, because that is the centre's own record. The admission form asks for the
  minimum in the first place (a name, an email, an optional note), and a rejected
  application leaves nothing behind but that record.
- A run takes an advisory lock, deletes in batches and is idempotent: a second
  run in a row removes nothing.

`scripts/verify-retention.mjs` proves all of that against the real database with
three-year-old throwaway rows, including the "sign-in is not studying"
distinction and the applicant-text rule (a three-year-old decision has its words
cleared while a decision from yesterday keeps its note, and neither decision row
is deleted) — 10 checks.

## Backup and recovery

Nothing here has been executed against a production deployment; it is the
procedure this schema and storage layout were designed for.

1. **Database.** Take a nightly logical backup and keep at least 14 days:
   `pg_dump --format=custom --no-owner "$DATABASE_URL" > learners-area-$(date +%F).dump`.
   Restore with `pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" <file>`.
   Migrations are numbered files in `drizzle/` and are applied with
   `npm run db:migrate`, so a restored older dump can be brought forward.
2. **Object storage.** Enable versioning (or a lifecycle rule) on the bucket. R2
   is the object store of record; the database only stores keys. A restore that
   brings back rows pointing at deleted objects is reported by the app as a
   missing object, never as fake content — the UI shows its empty state.
3. **Secrets.** `AUTH_SECRET` and the storage credentials live only in the host's
   environment. Losing `AUTH_SECRET` logs everybody out (it does not lose data).
4. **Recovery check.** After any restore, run the verification scripts
   (`verify-access`, `verify-pages`, `verify-owner`, `verify-retention`) against
   the restored database before announcing it is back.
5. **What is not automated here:** no scheduled backup job is shipped, because it
   belongs to the hosting provider (managed Postgres backups, R2 versioning).
   Turn it on there.

## Handover: what to do when the centre changes hands

Ownership is a role in the database, never an email address in the code.

1. The current owner opens `/owner/transfer` and signs in **again** (re-auth is
   required), then names the next owner. The change is one transaction: the new
   owner is promoted, the previous one is demoted, and a transfer that would
   leave the centre with zero live owners is rolled back. Every transfer is
   recorded in the audit log.
2. If the current owner is unavailable, transfer is not possible through the UI
   by design. Use the bootstrap path on the server console with the new owner's
   address and the `--promote` flag, which still refuses while an active owner
   exists — an operator has to demote the old one explicitly. This is the
   deliberate trade: a bootstrap that could always re-create an owner would be a
   back door.
3. Accounts outside the platform (the centre's Telegram bot, its Cloudflare
   account, its email sender) are **not** automated. Hand them over with this
   checklist: rotate the Telegram bot token, rotate the R2 access keys and the
   bucket CORS origins, hand over the domain and DNS, rotate `AUTH_SECRET`
   (logs everyone out), confirm the new owner's session, then remove the old
   operator's access to the host and the database.
4. Run `node scripts/verify-owner.mjs` after any ownership change: it proves
   exactly one live owner, that the previous owner lost the powers, and that the
   new one can hand back.

## REMAINING (honest, not padded)

- Mock tests: the page lists configured tests and the student's own finished
  attempts with real scores. There is no timed full-exam runner yet.
- Speaking practice: recording, submission, transcript-optional evaluation and
  history work end to end. What is deliberately absent is a **speech-to-text
  vendor**: `STT_PRIMARY_PROVIDER=none`, so an attempt has no transcript unless
  the student types one, and the UI says so instead of showing a fake score. The
  submit endpoint rejects a client-supplied `transcript` for the same reason, and
  RIWI reports pronunciation as not assessed rather than inventing a number.
- Coach: no external AI provider is installed, because one was deliberately not
  chosen. RIWI evaluates everything today; the adapters, registry, fallback,
  normalized result, persistence and UI are already vendor-agnostic.
- RIWI's estimates are heuristic and pattern-based. They are labelled as
  estimates everywhere, and criteria it cannot judge are reported as limited.
- Progress charts: numbers derive from persisted activity where they exist, but
  several cards have no underlying data source yet.
- Admin/CMS can create Reading passages/questions, Listening tests/questions,
  Grammar topics/exercises, Writing prompts and public video lessons, and can
  move any of them through the four publication states (draft / scheduled /
  published / archived) from the list it appears in.
  Courses/Modules/Units/Lessons still need direct DB access.
- Assignments have a student page and an evaluation path; they are not yet part
  of the roadmap's lesson flow.
- Live Classes' "join" is self-reported attendance with no real video
  infrastructure behind it.
- Reading Short Answer grading is strict exact-match.
- Billing has schema, flag off, no UI.
- No real AI provider is wired *by default*; that is a configuration choice rather than a
  missing subsystem (see "Adding an external provider").
- Telegram auth is real but was never exercised against a live bot here.
- No browser-level test suite *runner* is configured: two headless-Chromium
  scripts live under `scripts/browser/` and need `npm i --no-save puppeteer-core`
  plus a Chromium binary, but they are not part of `npm test`. No CI configured.
- The production database migration has never been executed against the real
  cloud database from this environment: no production `DATABASE_URL` is available
  here. The tooling, the refusal paths and the verification checklist are all
  tested against throwaway local databases, and the exact commands to run are in
  "Migrating the production database". Until it runs against Supabase, a
  deployment pointing at an unmigrated database answers `503` with
  `{"error":"service_unavailable","reason":"schema_missing"}` instead of an
  opaque 500 — the app says what is wrong instead of pretending.
- `users.is_owner` is a historical column; authorization reads `role`, and the
  OWNER role is managed through `/owner/transfer`.
