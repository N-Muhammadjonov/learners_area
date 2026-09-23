# Learners Area

A bilingual (Uzbek/English) education platform. IELTS is the first course
inside a multi-course platform — see "Adding a new course" below.

The architecture is real: a real database, server-side authorization on every
route, and a working resource/upload system that puts bytes in Cloudflare R2
without ever routing them through the app server. It is not a finished product
— see REMAINING below.

## Stack

Next.js 14 (App Router) · React 18 · TypeScript · PostgreSQL · Drizzle ORM ·
Tailwind CSS · Zod · bcrypt · jose · AWS S3 SDK (used against Cloudflare R2)

Drizzle was used instead of Prisma because Prisma's engine binaries are
fetched from a CDN at `generate`/`migrate` time; Drizzle needs no binary
download and talks to Postgres directly through `pg`. Both were acceptable
choices going in — this was an environment-driven decision, not a quality one.

## Run locally

```bash
cp .env.example .env        # fill in DATABASE_URL and a real AUTH_SECRET
npm install
npm run db:push             # create tables from src/db/schema.ts
npm run db:seed             # demo data — safe to run once on a fresh DB
npm run dev                 # http://localhost:3000
```

Other scripts: `npm run build`, `npm start` (production server), `npm run
lint`, `npm run typecheck`, `npm test` (Node's built-in test runner via tsx).

## Demo accounts

Created by `npm run db:seed`, passwords are dev-only:

| Role    | Email                          | Password        | Notes                      |
|---------|--------------------------------|------------------|-----------------------------|
| Admin (owner) | admin@learnersarea.uz    | Admin12345!      | `isOwner`=true — full control |
| Teacher | teacher@learnersarea.uz        | Teacher12345!    |                              |
| Teacher | teacher2@learnersarea.uz       | Teacher12345!    | second teacher, for testing ownership |
| Student | demo.student@learnersarea.uz   | Student12345!    | onboarded, has real history |
| Student | new.student@learnersarea.uz    | Student12345!    | fresh account, empty states |

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

Learners Area keeps its bucket **private**. Course content is authenticated
educational material, so there is no public bucket URL anywhere in this
project, and no `*` origin, and no `S3_PUBLIC_URL_BASE` variable to set. Files
are delivered through one authenticated route that authorizes the caller per
object and then issues a short-lived signed URL.

### Choosing a provider

`STORAGE_PROVIDER` (see `src/lib/services/storage/index.ts`):

| value    | provider                     | browser uploads directly? |
|----------|------------------------------|---------------------------|
| `local`  | `./public/uploads` on disk   | no — bytes proxied through the app server |
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
3. **CORS** — required for direct browser→R2 uploads. Bucket → Settings →
   CORS Policy:
   ```json
   [
     {
       "AllowedOrigins": ["https://learnersarea.uz"],
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
   Add the real production origin only. Never use `"*"`. Exposing a bucket or
   an origin more widely than this is the one change that would undo the
   private-by-default model.
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
- `r2`/`s3`: 302 to a signed GET URL valid for 5 minutes.
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
| `SpeechToTextService` | `stt/` | audio -> text, **separate on purpose** |

Assignment evaluation is an orchestrator, not an evaluator: an assignment linked
to a writing prompt is delegated to the writing service, a free-form response is
resolved generically, and objective multiple-choice grading never reaches a
provider at all.

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

## Testing

```bash
npm test                          # 80 unit tests (storage rules, RIWI signals, provider fallback, privacy)
npm run typecheck && npm run lint
npm run build
```

Against a running app with a real database:

```bash
# with `npm run dev` up and DATABASE_URL pointed at a seeded DB:
# verify-uploads and verify-coach need DATABASE_URL so they can assert against
# the real rows, not just the HTTP responses.
node scripts/verify-uploads.mjs   # 42 HTTP-level checks of the upload lifecycle
node scripts/verify-pages.mjs     # 69 render checks across roles and locales
DATABASE_URL=... node scripts/verify-coach.mjs   # 19 checks of the Coach subsystem
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
3. `npm run db:push`, or generate proper migrations with `drizzle-kit
   generate` for a production workflow instead of `push`.
4. Register a Telegram bot and set its login-widget domain to the real domain.
5. `npm run db:seed` only if you actually want the demo accounts in
   production — you probably don't.
6. Schedule `POST /api/admin/uploads/cleanup` (hourly is plenty) to sweep
   abandoned uploads.
7. Do not run the seed on a production database you care about; the demo
   passwords are public.

## REMAINING (honest, not padded)

- Mock tests: tables exist, no real vertical slice yet.
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
  Grammar topics/exercises and Writing prompts. Courses/Modules/Units/Lessons
  still need direct DB access.
- Assignments exist but are not surfaced in the student UI.
- Live Classes' "join" is self-reported attendance with no real video
  infrastructure behind it.
- Reading Short Answer grading is strict exact-match.
- Billing has schema, flag off, no UI.
- No real AI provider is wired *by default*; that is a configuration choice rather than a
  missing subsystem (see "Adding an external provider").
- Telegram auth is real but was never exercised against a live bot here.
- No browser-level (Playwright/Cypress) end-to-end tests — the verification
  scripts are HTTP-level. No CI configured.
- `isOwner` has no UI; it is a direct database flag.
