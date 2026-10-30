/** Real HTTP/DB ownership acceptance, restricted to the isolated QA database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/tooling-client";
import { auditLog, grammarAttempts, grammarExercises, grammarTopics, users, writingPrompts, writingSubmissions } from "../src/db/schema";

const base = new URL(process.env.BASE_URL ?? "http://127.0.0.1:3103");
const database = new URL(process.env.DATABASE_URL!);
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/learners_qa2");
const [owner, other, admin, promptId, submissionId, topicId, publicId] = Array.from({ length: 7 }, () => randomUUID()) as [string,string,string,string,string,string,string];
const password = randomUUID();
const hash = await bcrypt.hash(password, 10);
const privateText = `Private sentence ${randomUUID()}`;
const publicText = `Shared sentence ${randomUUID()}`;
let passed = 0;
function check(condition: unknown, label: string) { assert.ok(condition, label); passed++; console.log(`PASS ${label}`); }
async function api(path: string, cookie: string, body?: unknown) {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? "GET" : "POST", redirect: "manual",
    headers: { cookie, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, text: await response.text() };
}
await db.insert(users).values([owner,other,admin].map((id) => ({
  id, name: "QA2 grammar privacy", email: `${id}@example.test`, passwordHash: hash,
  role: id === admin ? "admin" as const : "student" as const, accountStatus: "active" as const, onboardingCompletedAt: new Date(),
})));
try {
  const cookies = new Map<string,string>();
  for (const id of [owner,other,admin]) {
    const signedIn = await api("/api/auth/login", "", { email: `${id}@example.test`, password });
    check(signedIn.response.status === 200, `fixture ${id === admin ? 'admin' : id === owner ? 'owner student' : 'other student'} signs in`);
    cookies.set(id, signedIn.response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "));
  }
  const request = (user: string, path: string, body?: unknown) => api(path, cookies.get(user)!, body);
  await db.insert(writingPrompts).values({ id: promptId, taskType: "task2", category: "QA", prompt: "Fixture", targetWordCount: 250 });
  await db.insert(writingSubmissions).values({ id: submissionId, userId: owner, promptId, content: privateText });
  await db.insert(grammarTopics).values({ id: topicId, title: "QA2 privacy fixture", explanation: "Fixture", order: 999 });
  const authorPath = `/api/admin/grammar/topics/${topicId}/exercises`;
  const payload = { promptText: privateText, options: ["is", "are"], correctOption: "is", explanation: privateText, sourceSubmissionId: submissionId };
  check((await request(other, authorPath, payload)).response.status === 403, "student cannot author grammar content");
  const created = await request(admin, authorPath, payload);
  check(created.response.status === 200, "administrator creates an essay-derived exercise through real API");
  const privateId = JSON.parse(created.text).id as string;
  const stored = (await db.select().from(grammarExercises).where(eq(grammarExercises.id, privateId)))[0]!;
  check(stored.sourceOwnerUserId === owner, "database derives ownership from the actual writing source");
  await db.update(grammarExercises).set({ targetStructures: ["is"], translatePromptUz: privateText }).where(eq(grammarExercises.id, privateId));
  await db.insert(grammarExercises).values({ id: publicId, topicId, order: 2, promptText: publicText, options: ["is", "are"], correctOption: "is", explanation: "Shared", targetStructures: ["is"] });
  const pagePath = `/app/grammar/${topicId}`;
  for (const deleted of [false,true]) {
    if (deleted) await db.delete(writingSubmissions).where(eq(writingSubmissions.id, submissionId));
    const ownPage = await request(owner, pagePath);
    const otherPage = await request(other, pagePath);
    check(ownPage.response.status === 200 && ownPage.text.includes(privateText), `owner sees personalized exercise ${deleted ? 'after' : 'before'} source expiry`);
    check(otherPage.response.status === 200 && otherPage.text.includes(publicText) && !otherPage.text.includes(privateText) && !otherPage.text.includes(privateId), `no private text/id in other student's HTML/RSC ${deleted ? 'after' : 'before'} expiry`);
    check((await request(other, `/api/grammar/topics/${topicId}/submit`, { answers: [{ exerciseId: privateId, selectedOption: "is" }] })).response.status === 404, "private multiple-choice request fails closed");
    check((await request(other, `/api/grammar/exercises/${privateId}/practice`, { activity: "translate_it", answer: "It is ready." })).response.status === 404, "private practice request fails closed");
    check((await request(other, `/api/grammar/exercises/${privateId}/produce`, { answer: "It is ready." })).response.status === 404, "private production request fails closed");
  }
  check((await db.select().from(grammarAttempts).where(eq(grammarAttempts.userId, other))).length === 0, "denied requests create no foreign attempts");
  check((await request(other, `/api/grammar/exercises/${publicId}/practice`, { activity: "translate_it", answer: "It is ready." })).response.status === 200, "shared practice still works");
  check((await request(owner, `/api/grammar/exercises/${privateId}/practice`, { activity: "translate_it", answer: "It is ready." })).response.status === 200, "owner's private practice still works after source expiry");
  check((await request(admin, authorPath, payload)).response.status === 404, "expired source returns 404 instead of a database 500");
  await db.delete(grammarExercises).where(eq(grammarExercises.id, publicId));
  const emptyPage = await request(other, pagePath);
  check(emptyPage.response.status === 200 && emptyPage.text.includes("data-empty-state") && !emptyPage.text.includes(privateText), "no accessible exercises shows a real empty state without leaking private content");
  console.log(`${passed} passed; 0 failed`);
} finally {
  await db.delete(grammarTopics).where(eq(grammarTopics.id, topicId));
  await db.delete(auditLog).where(inArray(auditLog.actorUserId, [owner,other,admin]));
  await db.delete(users).where(inArray(users.id, [owner,other,admin]));
  await db.delete(writingPrompts).where(eq(writingPrompts.id, promptId));
}
