# Learners Area

A bilingual (Uzbek/English) IELTS-first education platform. IELTS is the first
course inside a multi-course platform — see "Adding a new course" below.

This repository is a **Phase 1 foundation**: real architecture, a real
database, and seven modules (Writing, Reading, Listening, Grammar,
Vocabulary, Live Classes, Speaking) wired end to end, not a mockup. It is
not a finished product — see REMAINING below.

## Stack

Next.js 14 (App Router) · TypeScript · PostgreSQL · Drizzle ORM · Tailwind CSS

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
lint`, `npm run typecheck`, `npm test` (Node's built-in test runner via tsx,
covers the writing-evaluation heuristics and the spaced-repetition scheduler
— 17 tests).

## Demo accounts

Created by `npm run db:seed`, passwords are dev-only:

| Role    | Email                          | Password        | Notes                      |
|---------|---------------------------------|------------------|-----------------------------|
| Admin (owner) | admin@learnersarea.uz    | Admin12345!      | `isOwner`=true — full control |
| Teacher | teacher@learnersarea.uz        | Teacher12345!    |                              |
| Teacher | teacher2@learnersarea.uz       | Teacher12345!    | second teacher, for testing ownership |
| Student | demo.student@learnersarea.uz   | Student12345!    | onboarded, has real history |
| Student | new.student@learnersarea.uz    | Student12345!    | fresh account, empty states |

## Environment variables

See `.env.example`. Nothing is hard-coded to a payment or AI vendor.

- `DATABASE_URL` — Postgres connection string.
- `AUTH_SECRET` — signs session JWTs. Generate with `openssl rand -base64 48`.
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` — optional. Without them the
  "Continue with Telegram" button renders disabled rather than fake success
  (see `src/lib/auth/providers/telegram.ts` for the real HMAC-SHA256
  verification, and BotFather for creating a bot + enabling the login widget
  for your domain).
- `BILLING_ENABLED`, `PUBLIC_PAYMENT_ENABLED`, `REAL_AI_ENABLED`, `SAT_ENABLED`
  — feature flags, all default `false`. See `src/lib/config/flags.ts`.

## Connecting Cloudflare R2 (when you're ready)

1. In the Cloudflare dashboard: R2 → create a bucket → "Manage R2 API
   Tokens" → create a token scoped to **that one bucket**, Object Read &
   Write (not Admin). Copy the Access Key ID, Secret Access Key, and the
   Account ID.
2. Set in `.env`:
   ```
   STORAGE_PROVIDER=s3
   S3_BUCKET=<your bucket name>
   S3_REGION=auto
   S3_ACCESS_KEY_ID=<from the token>
   S3_SECRET_ACCESS_KEY=<from the token>
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_PUBLIC_URL_BASE=<your r2.dev public URL or custom domain for the bucket>
   ```
   `S3_PUBLIC_URL_BASE` matters for R2 specifically — unlike AWS S3, an R2
   bucket has no automatic public URL of its own; enable "Public access" (or
   a custom domain) on the bucket in the dashboard and put that base URL
   here, or uploaded files will save correctly but their links won't
   resolve for viewers.
3. **CORS** (required for any direct browser→R2 upload, i.e. once the
   client is wired to use `/api/uploads/presign` — see the Speaking
   architecture note below): in the bucket's Settings → CORS Policy, add
   an entry allowing `PUT` from your real origin, e.g.:
   ```json
   [
     {
       "AllowedOrigins": ["https://learnersarea.uz"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3000
     }
   ]
   ```
   Add `http://localhost:3000` as a second entry (or a second array item)
   for local development. Never use `"*"` for the production origin.
4. Restart the app. Everything already routed through `getStorageService()`
   (Speaking's primary file + blocks, Listening's audio) switches to R2
   automatically — no other code changes needed.
5. This environment has no network path to Cloudflare to verify any of the
   above end to end — please sanity-check the first real upload once
   connected (upload something small, confirm it appears in the R2 bucket
   in the dashboard, confirm the returned URL actually loads it).

## Architecture notes

- **Auth**: email/password (bcrypt + a signed JWT session cookie via `jose`,
  edge-compatible so `middleware.ts` can verify it without a DB round trip)
  and Telegram login. Route protection + role checks (student/teacher/admin)
  live in `middleware.ts`; every API route that touches teacher/admin data
  **also** checks the role server-side (see `/api/teacher/feedback`,
  `/api/admin/*`) rather than relying on middleware or a hidden button alone.
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
  a heuristic — True/False/Not Given, Yes/No/Not Given and Multiple Choice
  are exact matches, Short Answer is a strict normalised match (no partial
  credit for a valid synonym; worth revisiting before real use). The answer
  choices for True/False/Not Given and Yes/No/Not Given (`src/lib/reading-
  choices.ts`) are deliberately NOT translated — they're fixed IELTS exam
  terminology, shown in English regardless of UI locale, the same way "Task
  1"/"Task 2" aren't translated. One real bug was caught and fixed here
  during testing: the buttons originally submitted the *translated display
  label* as the answer value, which only matched the English-only
  `correctAnswer` stored in the database when the UI happened to be in
  English — since Uzbek is the default locale, this silently marked every
  correct answer wrong. Fixed by separating the submitted value from the
  display label.
- **Grammar**: multiple-choice error-correction, objectively graded like
  Reading. Exercises are authored content (not auto-extracted from a
  student's writing — that needs real NLP/AI, out of scope for the demo
  provider) but can reference one of the student's own submissions for
  context, shown as a "from your own essay" badge only to that student.
- **File storage** (`src/lib/services/storage`): a `StorageService`
  interface — `upload`, `delete`, and an optional `presignUpload` for
  providers that support direct-to-storage upload — with three providers,
  switched by `STORAGE_PROVIDER`.
  - `local` (default): writes to disk, genuinely tested end to end,
    including a real bug caught and fixed along the way — Next's
    `next start` only serves `/public` files that existed at server
    *startup*, so a file uploaded while the server is already running
    404'd until restart. Fixed by serving uploads through a Route Handler
    (`/api/files/[...path]`) that reads from disk on every request instead
    of relying on Next's static serving. No presigned upload (nothing to
    presign against — the file already has to reach this server to land
    on its disk). Doesn't work on serverless hosts with an ephemeral
    filesystem (Vercel's default, for one).
  - `s3`: AWS S3 or any S3-compatible host — **Cloudflare R2**,
    DigitalOcean Spaces, MinIO — via `S3_ENDPOINT`. Real presigned-PUT
    upload support (`presignUpload`, 5-minute expiry, one object key) using
    the official AWS SDK's SigV4 signer, which R2 also implements. **Not
    tested against a real bucket** — no credentials exist in this
    environment — review before first real use once you connect R2.
  - `cloudinary`: written to their documented signed-upload/destroy API, no
    SDK dependency. Also untested against a real account. No presigned
    upload — Cloudinary's browser-direct equivalent (unsigned upload
    presets) is a different trust model that doesn't fit this app's
    per-request authorization, so Cloudinary uploads proxy through the
    server like `local` does.
- **Speaking materials — block-based content model**: a material is a
  **primary file/link** plus an **ordered list of description content
  blocks** (`material_blocks`: text, image, audio, file, link — each with a
  `position`), not one textarea — this is deliberately Telegram-message-
  shaped, per the spec that prompted this design (multiple blocks of each
  type, reorderable, individually removable). The composer
  (`/teacher/speaking`, `NewMaterialForm.tsx`) shows **real** upload
  progress per file via `XMLHttpRequest`'s `upload.onprogress` — `fetch()`
  can't report this, so the composer is the one place in the app using XHR
  instead. Removing a block, or deleting a material outright, deletes its
  storage object(s) too — verified: removing an image block 404s that file
  immediately; deleting a material 404s its primary file. Content ownership
  is enforced by `src/lib/auth/ownership.ts`: a poster can edit their own
  material; only an account with `users.isOwner = true` can edit someone
  else's — there's no UI to grant `isOwner` yet, it's a direct-database
  flag (see seed.ts, where the seeded admin has it). Link/image/audio
  blocks render inline (`src/lib/embed.ts` + `MaterialPlayer`/
  `BlockRenderer`) — YouTube/Vimeo/Google Drive become embedded players,
  direct media URLs get a native `<video>`/`<audio>` tag, so viewers never
  see a raw URL or leave the page; this is a UI courtesy, not a security
  boundary, and an unrecognised link honestly falls back to an external
  "Open" action instead of faking an embed. **Simplification**: reordering
  in the composer uses up/down buttons, not drag-and-drop (a deliberate
  scope cut — buttons are far less likely to ship subtly broken than
  hand-rolled DnD in one pass, and the block `position` they write is the
  real, persisted thing). Editing an *existing* material's blocks (after
  creation) isn't wired up yet — the management view can rename, activate/
  deactivate, and delete a material, and shows its blocks read-only.
- **Listening**: same exam → auto-grade → analysis pattern as Reading, audio
  in place of a passage — reuses Speaking's upload/embed pipeline
  (`MaterialPlayer`, `/api/uploads`), so a test's audio can be uploaded
  directly or linked. Multiple choice and Short Answer only (no
  True/False/Not Given — not a natural fit for audio). Admin/teacher can add
  tests and questions at `/admin/listening`.
- **Vocabulary**: a simplified SM-2-style scheduler
  (`src/lib/services/spaced-repetition.ts`), unit tested.
- **Fonts**: this sandbox has no network access to a font CDN, so the type
  system ships on solid system-font stacks (`src/app/globals.css`). Swap in
  `next/font/google` once deployed somewhere with normal internet access.

## Adding a new course (e.g. SAT)

Nothing in `users`, `courses`, `course_modules`, `units`, `lessons`,
`enrollments`, `assignments`, or auth is IELTS-specific. A new course is a new
row in `courses` plus its own modules/units/lessons — no schema changes
required for the shared systems. IELTS-specific tables (`writing_prompts`,
`reading_passages`/`reading_questions`, and the not-yet-built
`listening_tests` / `speaking_prompts`) are intentionally separate from the
generic content tree.

## Deploying for real

Not attempted from this environment (no outbound access to a hosting
provider, no domain). In outline: host the Next.js app (Vercel or any
Node host), point `DATABASE_URL` at a managed Postgres, set a real
`AUTH_SECRET`, register a Telegram bot and set its login-widget domain to
your real domain, run `npm run db:push` (or generate proper migrations with
`drizzle-kit generate` for a production workflow instead of `push`) against
the production database, then `npm run db:seed` only if you actually want the
demo accounts in production — you probably don't.

## REMAINING (honest, not padded)

Not started: Mock tests (real stub route, tables already exist — see
`src/db/schema.ts`), and Speaking's own recording/AI-mock/grammar side.
Client isn't wired to use the presigned direct-to-R2 upload path yet
(`/api/uploads/presign` is real and correct — R2/S3 uploads currently still
proxy through `/api/uploads` like every other provider, which works fine,
just isn't the "browser never touches our server for the bytes" version the
architecture supports). Editing an existing material's blocks after
creation isn't wired up (rename/activate/delete are). Block reordering in
the composer is up/down buttons, not drag-and-drop. Listening's
test/question audio is a placeholder URL in seed data (the wiring is real
and tested — grading, upload, embed — the seeded audio link itself isn't a
real file). S3/Cloudinary provider code is untested against a real account
(see Architecture notes above) — review before first real use, especially
before connecting R2. No UI to grant `isOwner`; it's a direct-database flag
for now. Live Classes' "join" is self-reported attendance with no real
video infrastructure behind it. Admin can create Reading passages/questions
and Grammar topics/exercises; Courses/Modules/Units/Lessons still need
direct DB access. Reading's Short Answer grading is strict exact-match.
Billing UI (schema exists, flag is off). Real AI providers for
writing/speaking evaluation. Telegram auth is real but untestable here (no
bot token). No automated end-to-end (browser) tests — only unit tests for
pure logic and manual HTTP-level verification (see the
conversation this was built in). No CI configured.
