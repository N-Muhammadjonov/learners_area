/**
 * TED / PODCAST vs course video completion on a REAL PostgreSQL (isolated QA2 DB only).
 *   QA2_DATABASE_TESTS=1 DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 …
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { courseModules, courses, lessons, units, users, videoLessonQuestions, videoLessons } from "../src/db/schema";
import { createVideoLesson, recordWatched, saveResponse, submitAnswers } from "../src/lib/data/video-lessons";
import { after, before } from "node:test";
import { createResidueGuard, finishResidueGuard, type ResidueGuard } from "./support/qa2-residue";

/*
 * Fixtures this file creates are removed when it finishes, exception-safely, and only rows that did
 * not exist when it started can be removed — so seeded records are unreachable by construction.
 * Before this hook the file leaked its fixtures into the shared QA database, which changed what later
 * files observed: retention-db.test.ts failed outright once the residue from earlier files accumulated.
 */
const QA2_RESIDUE_GUARD = process.env.QA2_DATABASE_TESTS === "1";
let qa2ResidueGuard: ResidueGuard | null = null;
before(async () => {
  if (!QA2_RESIDUE_GUARD) return;
  qa2ResidueGuard = await createResidueGuard("video-completion-db");
  await qa2ResidueGuard.capture();
});
after(async () => {
  if (!qa2ResidueGuard) return;
  await finishResidueGuard("video-completion-db", qa2ResidueGuard);
  qa2ResidueGuard = null;
});

const enabled = process.env.QA2_DATABASE_TESTS === "1";
const opts = { skip: !enabled && "set QA2_DATABASE_TESTS=1 for the isolated database" };
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const ytId = () => Array.from({ length: 11 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");

const created = { users: [] as string[], videos: [] as string[], courses: [] as string[] };
async function user() {
  const id = randomUUID();
  await db.insert(users).values({ id, name: "QA2 video completion", role: "student", accountStatus: "active" });
  created.users.push(id);
  return id;
}
async function courseLesson() {
  const suffix = randomUUID().slice(0, 8);
  const [course] = await db.insert(courses).values({ slug: `qa2-video-${suffix}`, title: "QA2 course" }).returning();
  created.courses.push(course!.id);
  const [mod] = await db.insert(courseModules).values({ courseId: course!.id, slug: "m", title: "M", order: 1 }).returning();
  const [unit] = await db.insert(units).values({ moduleId: mod!.id, slug: "u", title: "U", order: 1 }).returning();
  const [lesson] = await db.insert(lessons).values({ unitId: unit!.id, slug: "l", title: "L", order: 1 }).returning();
  return lesson!.id;
}
async function video(input: { lessonId?: string | null; durationSeconds?: number | null; questions?: { stage: "comprehension" | "gap_fill"; prompt: string; acceptedAnswers: string[] }[] }, owner: string) {
  const result = await createVideoLesson({ videoUrl: `https://youtu.be/${ytId()}`, title: "QA2 talk", lessonId: input.lessonId ?? null, durationSeconds: input.durationSeconds ?? null, questions: input.questions }, owner);
  assert.ok(result.ok, JSON.stringify(result));
  created.videos.push(result.videoLessonId);
  return result.videoLessonId;
}
async function staleQuestion(videoLessonId: string) {
  const [row] = await db.insert(videoLessonQuestions).values({ videoLessonId, stage: "comprehension", position: 0, prompt: "Historical standalone question", acceptedAnswers: ["yes"] }).returning();
  return row!.id;
}
const q1 = { stage: "comprehension" as const, prompt: "What is the main idea?", acceptedAnswers: ["memory"] };

test.after(async () => {
  if (!enabled) return;
  if (created.videos.length) await db.delete(videoLessons).where(inArray(videoLessons.id, created.videos));
  if (created.courses.length) await db.delete(courses).where(inArray(courses.id, created.courses));
  if (created.users.length) await db.delete(users).where(inArray(users.id, created.users));
});

test("guard: only the isolated local QA2 database", opts, () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2");
});

test("S7 authored standalone and course questions are both stored", opts, async () => {
  const owner = await user();
  for (const lessonId of [null, await courseLesson()]) {
    const id = await video({ lessonId, questions: [q1] }, owner);
    assert.equal((await db.select().from(videoLessonQuestions).where(eq(videoLessonQuestions.videoLessonId, id))).length, 1);
  }
});

test("S8 authored standalone questions gate completion and an explicit edit replaces them", opts, async () => {
  const owner = await user(); const learner = await user();
  const id = await video({ durationSeconds: 100 }, owner);
  const question = await staleQuestion(id);
  assert.equal((await recordWatched(id, learner, 100))!.state, "in_progress");
  assert.equal((await submitAnswers(id, learner, { [question]: "wrong" }))!.state, "in_progress");
  assert.equal((await submitAnswers(id, learner, { [question]: "yes" }))!.state, "completed");
  const edit = await createVideoLesson({ videoLessonId: id, videoUrl: `https://youtu.be/${(await db.query.videoLessons.findFirst({ where: eq(videoLessons.id, id) }))!.videoId}`, title: "QA2 talk edited", lessonId: null, questions: [] }, owner);
  assert.ok(edit.ok);
  assert.equal((await db.select().from(videoLessonQuestions).where(eq(videoLessonQuestions.videoLessonId, id))).length, 0);
});

test("C1/C2 standalone known duration: 79% in progress, 80% completed", opts, async () => {
  const owner = await user(); const learner = await user();
  const id = await video({ durationSeconds: 100 }, owner);
  assert.equal((await recordWatched(id, learner, 79))!.state, "in_progress");
  assert.equal((await recordWatched(id, learner, 80))!.state, "completed");
});

test("C4/C5 standalone unknown duration: opinion alone does not complete; a trusted end does, durably", opts, async () => {
  const owner = await user(); const learner = await user();
  const id = await video({ durationSeconds: null }, owner);
  assert.equal(await saveResponse(id, learner, { responseText: "My opinion", summaryText: "My summary" }), "in_progress", "opinion/summary are not watch completion");
  assert.equal((await recordWatched(id, learner, 30))!.state, "in_progress", "progress without an end report");
  const ended = await recordWatched(id, learner, 95, { ended: true });
  assert.equal(ended!.state, "completed");
  assert.ok(ended!.completedAt);
  // reload = a fresh read through another write path
  assert.equal(await saveResponse(id, learner, { responseText: "edited" }), "completed", "C6 later opinion edit keeps it completed");
  assert.equal((await recordWatched(id, learner, 0))!.state, "completed", "C7 replay from 0 keeps it completed");
});

test("unknown duration: an end report with nothing watched cannot complete", opts, async () => {
  const owner = await user(); const learner = await user();
  const id = await video({ durationSeconds: null }, owner);
  assert.notEqual((await recordWatched(id, learner, 0, { ended: true }))!.state, "completed");
});

test("known duration: an end report does not bypass the 80% threshold", opts, async () => {
  const owner = await user(); const learner = await user();
  const id = await video({ durationSeconds: 100 }, owner);
  assert.equal((await recordWatched(id, learner, 10, { ended: true }))!.state, "in_progress");
});

test("R1/R2/S9 course-linked: questions still gate completion (wrong -> not done, all correct -> done)", opts, async () => {
  const owner = await user(); const learner = await user();
  const lessonId = await courseLesson();
  const id = await video({ lessonId, durationSeconds: 100, questions: [q1] }, owner);
  const [question] = await db.select().from(videoLessonQuestions).where(eq(videoLessonQuestions.videoLessonId, id));
  assert.notEqual((await recordWatched(id, learner, 100, { ended: true }))!.state, "completed", "watching alone does not complete a course lesson with questions");
  assert.notEqual((await submitAnswers(id, learner, { [question!.id]: "wrong" }))!.state, "completed");
  assert.equal((await submitAnswers(id, learner, { [question!.id]: "memory" }))!.state, "completed");
});

test("R3 course-linked without questions: threshold, or a written response when duration is unknown (unchanged)", opts, async () => {
  const owner = await user(); const learner = await user();
  const known = await video({ lessonId: await courseLesson(), durationSeconds: 100 }, owner);
  assert.equal((await recordWatched(known, learner, 80))!.state, "completed");
  const unknown = await video({ lessonId: await courseLesson(), durationSeconds: null }, owner);
  assert.equal((await recordWatched(unknown, learner, 50, { ended: true }))!.state, "in_progress", "end report does not change the course rule");
  assert.equal(await saveResponse(unknown, learner, { responseText: "Response" }), "completed");
});
