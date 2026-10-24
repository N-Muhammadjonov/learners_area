/** Isolated QA only: real HTTP write paths followed by the real retention job. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/tooling-client";
import { auditLog, lexemes, listeningAttempts, listeningQuestions, listeningTests, users } from "../src/db/schema";
import { monthsAgo, runRetention } from "../src/lib/services/retention";

const base = new URL(process.env.BASE_URL ?? "http://127.0.0.1:3102");
const database = new URL(process.env.DATABASE_URL!);
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/learners_qa2");
assert.equal(process.env.STORAGE_PROVIDER, "local");
const password = randomUUID();
const studentId = randomUUID();
const staffId = randomUUID();
const testId = randomUUID();
const questionId = randomUUID();
const term = `qa2activity${randomUUID().replaceAll("-", "")}`;
const old = monthsAgo(20, new Date());
const email = `${studentId}@example.test`;
let cookie = "";
let passed = 0;
function check(value: unknown, label: string) { assert.ok(value, label); passed++; console.log(`PASS ${label}`); }
async function post(path: string, body: unknown) {
  const response = await fetch(new URL(path, base), {
    method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body), redirect: "manual",
  });
  return { response, data: await response.json() };
}
async function student() { return (await db.select().from(users).where(eq(users.id, studentId)))[0]!; }
await db.insert(users).values([
  { id: studentId, name: "QA2 HTTP activity", email, passwordHash: await bcrypt.hash(password, 10), role: "student", accountStatus: "active", createdAt: old, onboardingCompletedAt: new Date() },
  { id: staffId, name: "QA2 HTTP author", role: "teacher", accountStatus: "active" },
]);
try {
  await db.insert(listeningTests).values({ id: testId, createdByUserId: staffId, title: "QA2 activity fixture", audioType: "link" });
  await db.insert(listeningQuestions).values({ id: questionId, testId, order: 1, type: "short_answer", questionText: "Fixture answer?", correctAnswer: "test", explanation: "Fixture only" });
  const signedIn = await post("/api/auth/login", { email, password });
  check(signedIn.response.status === 200, "real login succeeds");
  cookie = signedIn.response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  check((await student()).lastMeaningfulActivityAt === null, "login alone does not fabricate study activity");
  const started = await post("/api/listening/attempts", { testId });
  check(started.response.status === 200 && started.data.id, "authorized listening attempt starts");
  check((await student()).lastMeaningfulActivityAt === null, "opening an attempt alone is not meaningful work");
  const beforeSubmit = new Date();
  const submitted = await post(`/api/listening/attempts/${started.data.id}/submit`, { answers: [{ questionId, answer: "test" }] });
  check(submitted.response.status === 200 && submitted.data.score === 1, "actual listening answer is graded and persisted");
  const listeningClock = (await student()).lastMeaningfulActivityAt;
  check(listeningClock && listeningClock >= beforeSubmit, "listening submission updates activity clock");
  const replay = await post(`/api/listening/attempts/${started.data.id}/submit`, { answers: [] });
  check(replay.response.status === 409, "completed listening submission cannot replay");
  check((await student()).lastMeaningfulActivityAt?.getTime() === listeningClock?.getTime(), "rejected replay does not refresh activity");
  await db.update(users).set({ lastMeaningfulActivityAt: null }).where(eq(users.id, studentId));
  await runRetention({ dryRun: false, actorUserId: staffId });
  check((await student()).accountStatus === "active", "real persisted listening work protects a missed summary update");
  const beforeVocabulary = new Date();
  const added = await post("/api/vocabulary", { items: [{ term, definitionEn: "Isolated HTTP fixture", translationUz: "Sinov" }] });
  check(added.response.status === 200 && added.data.added === 1, "real vocabulary add succeeds");
  const vocabularyClock = (await student()).lastMeaningfulActivityAt;
  check(vocabularyClock && vocabularyClock >= beforeVocabulary, "vocabulary add records meaningful activity");
  const duplicate = await post("/api/vocabulary", { items: [{ term, definitionEn: "Isolated HTTP fixture", translationUz: "Sinov" }] });
  check(duplicate.response.status === 200 && duplicate.data.added === 0, "duplicate add remains a no-op");
  check((await student()).lastMeaningfulActivityAt?.getTime() === vocabularyClock?.getTime(), "duplicate add cannot manufacture fresh activity");
  console.log(`${passed} passed; 0 failed`);
} finally {
  await db.delete(auditLog).where(inArray(auditLog.actorUserId, [studentId, staffId]));
  await db.delete(listeningAttempts).where(eq(listeningAttempts.userId, studentId));
  await db.delete(listeningTests).where(eq(listeningTests.id, testId));
  await db.delete(users).where(inArray(users.id, [studentId, staffId]));
  await db.delete(lexemes).where(eq(lexemes.term, term));
}
