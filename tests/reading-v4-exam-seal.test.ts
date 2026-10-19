import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { saveContentDraft, publishContentVersion } from "../src/lib/content/authoring";
import { startAcademicSet, activeAcademicAttemptForPassages } from "../src/lib/data/reading-assessments";
import { saveGeneralProgress } from "../src/lib/data/general-reading";
import { getAttemptDetail } from "../src/lib/data/reading";
import { submitReadingAttempt } from "../src/lib/services/reading/submit";
import { resolveOccurrence, readingSourceAccess } from "../src/lib/services/lexical/context";

/**
 * SEC-12: an EARLIER submitted attempt must never unlock Dictionary help for a
 * currently open assessment that contains the same canonical passage — at any of
 * the three passage positions, and whichever source id the caller sends.
 *
 * An Academic attempt row stores only its FIRST passage; positions two and three
 * are reachable solely through `reading_assessment_passages`. A policy that looks
 * at `reading_attempts.passage_id` alone therefore cannot see that passage two of
 * an open exam is under assessment.
 */

type Actor = { id: string; role: "owner"; mayPublish: true };

test("SEC-12 an older submitted attempt cannot unlock an overlapping active exam at ANY passage position", async () => {
  const env = await createTestDatabase();
  try {
    const [owner, a] = await env.query<{ id: string }>(
      "insert into users(name,role) values ('Owner','owner'),('A','student') returning id",
    );
    const actor = { id: owner!.id, role: "owner", mayPublish: true } as Actor;
    const user = { id: a!.id, role: "student" as const };

    const drafted = await env.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "reading",
        contentType: "general_set",
        sourceRef: "qa-exam-seal",
        title: "QA exam seal",
        track: "academic",
        payload: {
          suggestedMinutes: 60,
          passages: [1, 2, 3].map((p) => ({
            title: `Passage ${p}`,
            bodyText: "The bank approved the loan. " + "Authored QA passage text. ".repeat(5),
            questions: Array.from({ length: p === 3 ? 14 : 13 }, (_, i) => ({
              typeCode: "short_answer",
              questionText: `Question ${i + 1}`,
              correctAnswer: "bank",
              evidenceQuote: "The bank approved the loan.",
              explanation: "Authored reason",
            })),
          })),
        },
      }),
    );
    assert.ok(drafted.ok);
    if (!drafted.ok) throw Error("draft");
    assert.equal((await env.db.transaction((tx) => publishContentVersion(tx, { actor, versionId: drafted.version.id, to: "published" }))).ok, true);

    const passages = await env.query<{ passage_id: string; passage_no: number }>(
      "select passage_id,passage_no from general_reading_passages where set_id=$1::uuid order by passage_no",
      [drafted.version.targetId!],
    );
    assert.equal(passages.length, 3);
    // 0030 pins EVERY membership row to 'general_practice' by CHECK constraint, so a
    // formal Academic test and a General learning set are the same canonical rows.
    // That is precisely why the seal may not depend on product classification.
    assert.ok(
      (await env.query<{ reading_mode: string }>("select reading_mode from general_reading_passages where set_id=$1::uuid", [drafted.version.targetId!])).every(
        (r) => r.reading_mode === "general_practice",
      ),
      "the shared-membership precondition this test defends against",
    );

    // One tracked occurrence in EACH passage, so every position can be probed.
    const occurrences: { id: string; passageId: string; passageNo: number }[] = [];
    for (const slot of passages) {
      const [row] = await env.query<{ id: string }>(
        "insert into lexical_occurrences(passage_id,source_type,start_char,end_char,surface_form,resolution_status) values ($1,'reading',4,8,'bank','unresolved') returning id",
        [slot.passage_id],
      );
      occurrences.push({ id: row!.id, passageId: slot.passage_id, passageNo: slot.passage_no });
    }

    // The learner genuinely completes a STANDALONE attempt of passage two and
    // passage three earlier on (the product's own submit path grades them).
    const earlier: Record<number, string> = {};
    for (const slot of passages.filter((p) => p.passage_no !== 1)) {
      const [row] = await env.query<{ id: string }>("insert into reading_attempts(user_id,passage_id) values ($1,$2) returning id", [a!.id, slot.passage_id]);
      const detail = (await getAttemptDetail(row!.id, a!.id, env.db))!;
      assert.equal((await submitReadingAttempt(row!.id, a!.id, detail.questions.map((q) => ({ questionId: q.id, answer: "bank" })), env.db)).ok, true);
      earlier[slot.passage_no] = row!.id;
    }

    // With nothing open, those submitted reviews are legitimately readable.
    for (const no of [2, 3]) {
      assert.equal(await readingSourceAccess(user, earlier[no]!, env.db), "allowed", `own submitted review ${no} is readable while nothing is open`);
      const passageId = passages.find((p) => p.passage_no === no)!.passage_id;
      assert.equal(await readingSourceAccess(user, passageId, env.db), "allowed", `and so is its own passage while nothing is open`);
    }

    // Now the learner OPENS the full three-passage assessment over the same rows.
    const active = await startAcademicSet(a!.id, drafted.version.targetId!, env.db);
    assert.ok(active);
    const scope = (await getAttemptDetail(active!, a!.id, env.db))!;
    assert.equal(scope.sections.length, 3);
    assert.equal(scope.attempt.status, "in_progress");

    const [other] = await env.query<{id:string}>("insert into users(name) values('Other student') returning id");
    for (const slot of passages) {
      const input={userId:a!.id,role:'student' as const,passageId:slot.passage_id,answers:{},check:true};
      assert.equal(await activeAcademicAttemptForPassages(a!.id,[slot.passage_id],env.db),active);
      assert.equal(await saveGeneralProgress(input,env.db),null,`General Check cannot leak the key for active passage ${slot.passage_no}`);
      assert.equal(await saveGeneralProgress({...input,check:false},env.db),null,'a learning autosave cannot bypass the seal');
      assert.ok((await saveGeneralProgress({...input,userId:other!.id},env.db))?.result,'another learner is not locked by this user’s exam');
    }

    // Every route into the Dictionary must now be sealed, at every position.
    for (const occurrence of occurrences) {
      assert.equal(
        (await resolveOccurrence(user, "reading", active!, occurrence.id, env.db))?.status,
        "locked",
        `SEC-0${occurrence.passageNo} active attempt id, passage ${occurrence.passageNo}`,
      );
      assert.equal(
        (await resolveOccurrence(user, "reading", occurrence.passageId, occurrence.id, env.db))?.status,
        "locked",
        `SEC-12 bare passage id, passage ${occurrence.passageNo}: an old submission must not unlock the open exam`,
      );
      assert.equal(
        await readingSourceAccess(user, occurrence.passageId, env.db),
        "locked",
        `SEC-04 save gate, bare passage id, passage ${occurrence.passageNo}`,
      );
    }
    for (const no of [2, 3]) {
      assert.equal(
        (await resolveOccurrence(user, "reading", earlier[no]!, occurrences.find((o) => o.passageNo === no)!.id, env.db))?.status,
        "locked",
        `SEC-12 old attempt id, passage ${no}: the earlier review is locked while the exam is open`,
      );
      assert.equal(await readingSourceAccess(user, earlier[no]!, env.db), "locked", `SEC-04 save through the earlier review, passage ${no}`);
    }

    // After the open assessment is submitted, the reviews open again.
    const detail = (await getAttemptDetail(active!, a!.id, env.db))!;
    assert.equal((await submitReadingAttempt(active!, a!.id, detail.questions.map((q) => ({ questionId: q.id, answer: "bank" })), env.db)).ok, true);
    for (const occurrence of occurrences) {
      assert.equal((await resolveOccurrence(user, "reading", active!, occurrence.id, env.db))?.status, "unresolved", "own submitted review is authorized again");
      assert.equal(await readingSourceAccess(user, occurrence.passageId, env.db), "allowed");
      assert.equal(await activeAcademicAttemptForPassages(a!.id,[occurrence.passageId],env.db),null);
      assert.ok((await saveGeneralProgress({userId:a!.id,role:'student',passageId:occurrence.passageId,answers:{},check:true},env.db))?.result,'General Check opens after submission');
    }
  } finally {
    await env.close();
  }
});
