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
npm test                          # 48 unit tests (pure logic + storage rules)
npm run typecheck && npm run lint
npm run build
```

Against a running app with a real database:

```bash
# with `npm run dev` up and DATABASE_URL pointed at a seeded DB:
node scripts/verify-uploads.mjs   # 35 HTTP-level checks of the upload lifecycle
node scripts/verify-pages.mjs     # 53 render checks across roles and locales
```

`scripts/verify-uploads.mjs` is the acceptance test for the resource system:
authorization boundaries (anonymous / student / second teacher / owner),
oversized and unsupported files, finalize-without-upload, arbitrary-key
injection, uploadId reuse, malformed links, private read behavior after
deactivation, path traversal, retained-vs-removed objects on edit, primary and
attachment replacement, cancel, abandoned-upload cleanup, and full deletion.
It asserts against the real server response, the real database and the real
filesystem — nothing is mocked.

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
- Speaking practice: recording, submission and history work end to end. What is
  deliberately absent is **speech-to-text and automated scoring** — there is no
  transcription provider wired, so an attempt stores its audio and duration and
  nothing else. The UI says so rather than showing a fake score, and the submit
  endpoint rejects a `transcript` in the request body.
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
- No real AI provider is wired for writing/speaking evaluation.
- Telegram auth is real but was never exercised against a live bot here.
- No browser-level (Playwright/Cypress) end-to-end tests — the verification
  scripts are HTTP-level. No CI configured.
- `isOwner` has no UI; it is a direct database flag.
