import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { listeningMcqDesktopPackage } from "../scripts/listening-mcq-desktop-package";
import { validateCanonicalListeningPackage } from "../src/lib/import/listening/canonical";
import { listeningPackageSchema } from "../src/lib/listening/package";
import { importCanonicalListeningPackage } from "../src/lib/import/listening/importer";
import { mcqChoiceCorrect } from "../src/lib/listening/mcq-choice";
import { originalMcqAudioUrl } from "../src/lib/listening/original-mcq";
import { mcqDayFor, mcqProgramDays } from "../src/lib/data/listening-mcq";
import { listeningMcqSessions, listeningQuestions } from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

test("owner documents preserve all 150 prompts, options, keys and independent recordings", () => {
  let multiple = 0;
  const keys = new Set<string>();
  for (let day = 1; day <= 30; day++) {
    const { manifest, canonical, stored } = listeningMcqDesktopPackage(day);
    const original = JSON.parse(readFileSync(new URL(`../content/listening/mcq/day-${String(day).padStart(2, "0")}/questions.json`, import.meta.url), "utf8"));
    assert.equal(stored.questions.length, 5);
    assert.equal(canonical.assets.length, 5);
    for (const [index, question] of stored.questions.entries()) {
      assert.equal(question.text, original[index].prompt);
      assert.deepEqual(question.options, original[index].options.map((o: {code: string; text: string}) => `${o.code}) ${o.text}`));
      assert.equal(question.key, Array.isArray(original[index].answer) ? original[index].answer.join(",") : original[index].answer);
      const multi = question.typeCode === "mcq_multi";
      if (multi) multiple++;
      const choices = (Array.isArray(original[index].answer) ? original[index].answer : [original[index].answer]).map((code: string) => question.options[code.charCodeAt(0) - 65]);
      assert.ok(mcqChoiceCorrect(multi ? JSON.stringify(choices) : choices[0], question.key, question.options, multi));
      const media = manifest.media[index]!;
      assert.equal(originalMcqAudioUrl(manifest.sourceRef, day, index + 1), `/api/resources/${media.objectKey}`);
      keys.add(media.objectKey);
    }
  }
  assert.equal(keys.size, 150);
  assert.equal(multiple, 9);
  assert.equal(originalMcqAudioUrl("other-source", 1, 1), null);
  assert.equal(originalMcqAudioUrl("listening-mcq-day-01", 2, 1), null, "an ordinal alone cannot select another source's audio");
});

test("short real MCQ recordings are valid; full tests retain the sixty second minimum", () => {
  const { canonical, stored } = listeningMcqDesktopPackage(1);
  assert.ok(canonical.content.audio.durationSec < 60);
  assert.ok(validateCanonicalListeningPackage(canonical).ok);
  assert.ok(listeningPackageSchema.safeParse(stored).success);
  for (const collection of ["academic", "general", "essential", "question_types"]) {
    assert.equal(validateCanonicalListeningPackage({ ...canonical, content: { ...canonical.content, collection, programme: undefined } }).ok, false);
    assert.equal(listeningPackageSchema.safeParse({ ...stored, collection, programme: undefined }).success, false);
  }
});

test("all thirty days import idempotently; all five final stages unlock only the next day", async () => {
  const database = await createTestDatabase();
  try {
    await database.query(`insert into users (id,name,role) values ('${OWNER}','Owner','owner'),('${STUDENT}','Student','student'),('${OTHER}','Other','student')`);
    const ids: string[] = [];
    for (let day = 1; day <= 30; day++) {
      const { manifest, canonical } = listeningMcqDesktopPackage(day);
      const options = { actorUserId: OWNER, publish: true, publishAuthorized: true,
        assets: manifest.media.map((media, index) => ({ key: index === 0 ? "audio.full" : `audio.question${index + 1}`, role: "audio" as const,
          uploadId: OWNER, objectKey: media.objectKey, mimeType: media.mimeType, size: media.bytes, originalName: media.path.split("/").pop()! })) };
      const result = await database.db.transaction(tx => importCanonicalListeningPackage(tx, canonical, options));
      assert.ok(result.ok, JSON.stringify(result));
      if (!result.ok) throw Error("import refused");
      ids.push(result.targetId);
      const again = await database.db.transaction(tx => importCanonicalListeningPackage(tx, canonical, options));
      assert.ok(again.ok);
      if (again.ok) { assert.equal(again.targetId, result.targetId); assert.equal(again.action, "unchanged"); }
    }
    const counts = await database.query<{tests: number; questions: number; blocks: number}>("select (select count(*)::int from listening_tests) tests,(select count(*)::int from listening_questions) questions,(select count(*)::int from resource_blocks) blocks");
    assert.deepEqual(counts[0], { tests: 30, questions: 150, blocks: 150 });
    let catalogue = await mcqProgramDays({ id: STUDENT, role: "student" }, {}, database.db);
    assert.equal(catalogue.days.length, 30); assert.equal(catalogue.hasNextPage, false);
    assert.equal(catalogue.days.filter(day => day.locked).length, 29);
    assert.equal(await mcqDayFor(2, { id: STUDENT, role: "student" }, {}, database.db), null);
    const day = await mcqDayFor(1, { id: STUDENT, role: "student" }, {}, database.db);
    assert.ok(day); assert.equal(new Set(day.questions.map(q => q.audioUrl)).size, 5);
    for (const q of day.questions) { assert.equal("options" in q, false); assert.equal("correctAnswer" in q, false); assert.equal("explanation" in q, false); }
    const questions = await database.db.select().from(listeningQuestions).where(eq(listeningQuestions.testId, ids[0]!)).orderBy(listeningQuestions.order);
    await database.db.insert(listeningMcqSessions).values(questions.map((q, index) => ({ userId: STUDENT, testId: ids[0]!, questionId: q.id, stage: index === 4 ? "chosen" as const : "reasoned" as const })));
    assert.equal(await mcqDayFor(2, { id: STUDENT, role: "student" }, {}, database.db), null, "four finished questions are insufficient");
    await database.db.update(listeningMcqSessions).set({ stage: "reasoned" }).where(eq(listeningMcqSessions.questionId, questions[4]!.id));
    catalogue = await mcqProgramDays({ id: STUDENT, role: "student" }, {}, database.db);
    assert.equal(catalogue.days[1]!.locked, false); assert.equal(catalogue.days[2]!.locked, true);
    assert.ok(await mcqDayFor(2, { id: STUDENT, role: "student" }, {}, database.db));
    const other = await mcqProgramDays({ id: OTHER, role: "student" }, {}, database.db);
    assert.equal(other.days[1]!.locked, true); assert.equal(other.progress.daysCompleted, 0);
  } finally { await database.close(); }
});
