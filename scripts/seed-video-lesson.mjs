#!/usr/bin/env node
/**
 * Seed one authored video lesson so the studio is reachable in QA.
 *
 *   DATABASE_URL=... node --import tsx scripts/seed-video-lesson.mjs [--video <url>] [--lesson <slug>] [--title "..."]
 *
 * Honesty rules this script follows:
 *   - the transcript is NOT seeded: we cannot write an authored or licensed
 *     transcript for a public video we did not produce, and fabricating
 *     timestamps would be worse than an empty state;
 *   - the video reference is verified against the provider's own oEmbed endpoint
 *     when the machine has network access, and the script says plainly when it
 *     could not be verified.
 *
 * The centre replaces this row with its own videos through /admin/video-lessons.
 */
import pg from "pg";
import { parseVideoInput, describeParseFailure } from "../src/lib/services/video/provider.ts";

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

const DEFAULT_VIDEO = "https://www.youtube.com/watch?v=arj7oStGLkU";
const videoUrl = arg("video", DEFAULT_VIDEO);
const lessonSlug = arg("lesson", null);
const titleOverride = arg("title", null);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL yo'q. `export DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)` qilib qayta urinib ko'ring.");
  process.exit(1);
}

const parsed = parseVideoInput(videoUrl);
if (!parsed.ok) {
  console.error(`Video havolasi rad etildi: ${describeParseFailure(parsed.reason)} (${parsed.reason})`);
  process.exit(1);
}

// The provider's own metadata, when the sandbox allows the call.
let providerTitle = null;
let verified = false;
try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const res = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${parsed.videoId}`)}&format=json`,
    { signal: controller.signal }
  );
  clearTimeout(timer);
  if (res.ok) {
    const body = await res.json();
    providerTitle = body.title ?? null;
    verified = true;
  }
} catch {
  verified = false;
}

if (verified) {
  console.log(`Tekshirildi (oEmbed): "${providerTitle}" — ${parsed.provider}:${parsed.videoId}`);
} else {
  console.log(
    `⚠️  EXTERNALLY UNVERIFIED: provayder metadatasi olib kelinmadi (internet yo'q).\n` +
      `   Yozilgan video id: ${parsed.provider}:${parsed.videoId}\n` +
      `   QA 2 dan oldin markaz o'z videosini /admin/video-lessons orqali qo'yishi kerak.`
  );
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const { rows: lessonRows } = await pool.query(
  `select l.id, l.title, l.slug from lessons l
     join units u on u.id = l.unit_id
     join course_modules m on m.id = u.module_id
   ${lessonSlug ? "where l.slug = $1" : 'order by m."order", u."order", l."order"'}
   limit 1`,
  lessonSlug ? [lessonSlug] : []
);
const lesson = lessonRows[0];
if (!lesson) {
  console.error(`Dars topilmadi${lessonSlug ? ` (slug: ${lessonSlug})` : ""}. Avval \`npm run db:seed\` bajaring.`);
  await pool.end();
  process.exit(1);
}

const title = titleOverride ?? providerTitle ?? "Demo video lesson — replace with your own";
const beforeYouWatch =
  "Predict before you watch: what is the speaker going to argue, and what problem is it solving? Write one sentence.";

const { rows: existing } = await pool.query("select id from video_lessons where lesson_id = $1", [lesson.id]);
if (existing.length > 0) {
  await pool.query(
    `update video_lessons
        set title = $2, provider = $3, video_id = $4, before_you_watch = $5, transcript = null,
            transcript_source = null, transcript_attribution = null, duration_seconds = null, is_active = true
      where id = $1`,
    [existing[0].id, title, parsed.provider, parsed.videoId, beforeYouWatch]
  );
  await pool.query("delete from video_lesson_questions where video_lesson_id = $1", [existing[0].id]);
  console.log(`Yangilandi: "${title}" → dars "${lesson.title}" (${lesson.slug})`);
} else {
  await pool.query(
    `insert into video_lessons (lesson_id, title, provider, video_id, before_you_watch, transcript_source, is_active)
     values ($1, $2, $3, $4, $5, null, true)`,
    [lesson.id, title, parsed.provider, parsed.videoId, beforeYouWatch]
  );
  console.log(`Yaratildi: "${title}" → dars "${lesson.title}" (${lesson.slug})`);
}

console.log(
  "\nEslatma: transkript va savollar ataylab bo'sh — ular faqat markazning o'zi yozgan,\n" +
    "litsenziyalangan yoki ruxsat berilgan matn bo'lishi mumkin. Ularni /admin/video-lessons\n" +
    "sahifasida qo'shing."
);

await pool.end();
