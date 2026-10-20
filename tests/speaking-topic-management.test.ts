import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { speakingPrompts, users } from "../src/db/schema";
import { speakingTopicDraft } from "../src/lib/speaking/topic-draft";
import { manageSpeakingTopic, SpeakingTopicConflict } from "../src/lib/speaking/manage-topic";
import { listActivePrompts, listLivePartnerQuestions } from "../src/lib/data/speaking-practice";
import { after, before } from "node:test";
import { createResidueGuard, finishResidueGuard, type ResidueGuard } from "./support/qa2-residue";

/*
 * Fixtures this file creates are removed when it finishes, exception-safely, and only rows that did
 * not exist when it started can be removed — so seeded records are unreachable by construction.
 * The QA2 database is shared by every gated file, so one file’s leftovers change what the next one
 * observes; this is what makes two consecutive runs against the same database meaningful.
 */
const QA2_RESIDUE_GUARD = process.env.QA2_DATABASE_TESTS === "1";
let qa2ResidueGuard: ResidueGuard | null = null;
before(async () => {
  if (!QA2_RESIDUE_GUARD) return;
  qa2ResidueGuard = await createResidueGuard("speaking-topic-management");
  await qa2ResidueGuard.capture();
});
after(async () => {
  if (!qa2ResidueGuard) return;
  await finishResidueGuard("speaking-topic-management", qa2ResidueGuard);
  qa2ResidueGuard = null;
});

const question = (topic: string, part: "part1" | "part2" | "part3" = "part1") => ({part,topic,promptText:"What do you enjoy?",cueCard:"who this person is\nhow you met\nPart 3 – Making friends",availableIn:["practice_alone" as const],studySupport:{vocabularyHtml:"<b>PRIVATE HELPER</b><script>alert(1)</script>",modelAnswerHtml:"<i>Sample</i>",ideasHtml:"<mark>Ideas</mark>",vocabulary:[]}});
test("topic batches reject mixed topics, multiple cue cards, duplicate and unrelated IDs", () => {
  const a = question("Work");
  assert.equal(speakingTopicDraft.safeParse({questions:[]}).success,false);
  assert.equal(speakingTopicDraft.safeParse({questions:[a,question("Study")]}).success,false);
  assert.equal(speakingTopicDraft.safeParse({questions:[question("Person","part2"),question("Person","part2")]}).success,false);
  assert.equal(speakingTopicDraft.safeParse({questions:[{...a,id:randomUUID()}]}).success,false);
  assert.equal(speakingTopicDraft.safeParse({questions:[a,a]}).success,true);
});
test("native topic authoring publishes one bank, edits atomically, removes and restores without deleting rows", {skip:process.env.QA2_DATABASE_TESTS !== "1"}, async () => {
  const target = new URL(process.env.DATABASE_URL!); assert.equal(target.hostname,"localhost");assert.equal(target.pathname,"/learners_qa2");
  const topic = `Topic QA ${randomUUID()}`; const ids: string[] = [];
  try {
    const rows = await manageSpeakingTopic(speakingTopicDraft.parse({questions:[question(topic),{...question(topic),promptText:"Why did you choose your studies?"}]}));
    ids.push(...rows.map(q => q.id)); assert.equal(rows.length,2);
    assert.ok(rows.every(q => q.availableIn.includes("live_partner") && !q.studySupport.vocabularyHtml.includes("script")));
    const original = {part:"part1" as const,topic,bank:"shared" as const,ids:[...ids]};
    await assert.rejects(manageSpeakingTopic(speakingTopicDraft.parse({questions:[question(topic)]})),SpeakingTopicConflict);
    await assert.rejects(manageSpeakingTopic(speakingTopicDraft.parse({original:{...original,ids:[ids[0]!]},questions:[{...question(topic),id:ids[0]}]})),SpeakingTopicConflict);
    assert.equal((await db.select().from(speakingPrompts).where(eq(speakingPrompts.topic,topic))).length,2);
    const edited = await manageSpeakingTopic(speakingTopicDraft.parse({original,questions:[{...question(topic),id:ids[0],promptText:"Changed question?"}]}));
    assert.equal(edited[0]!.id,ids[0]);
    const removed = await db.query.speakingPrompts.findFirst({where:eq(speakingPrompts.id,ids[1]!)});
    assert.equal(removed?.publicationState,"archived"); assert.equal(removed?.topic,topic);
    const [owner]=await db.select().from(users).where(eq(users.role,"owner")).limit(1);
    assert.ok(owner);
    await manageSpeakingTopic({archive:original,actor:{id:owner.id,role:"owner"}});
    assert.equal((await listActivePrompts()).filter(q => ids.includes(q.id)).length,0);
    assert.equal((await listLivePartnerQuestions()).questions.filter(q => ids.includes(q.id)).length,0);
    await assert.rejects(manageSpeakingTopic(speakingTopicDraft.parse({original,questions:rows.map(q => ({...question(topic),id:q.id,promptText:q.promptText}))})),SpeakingTopicConflict);
    const partner = (await listLivePartnerQuestions()).questions.filter(q => ids.includes(q.id));
    assert.equal(partner.length,0);assert.ok(partner.every(q => !("studySupport" in q)));
    for (const part of ["part2","part3"] as const) {
      const q = await manageSpeakingTopic(speakingTopicDraft.parse({questions:[question(`${topic} ${part}`,part)]}));ids.push(q[0]!.id);
      assert.equal(q[0]!.cueCard,"who this person is\nhow you met\nPart 3 – Making friends");
    }
  } finally {if(ids.length) await db.delete(speakingPrompts).where(inArray(speakingPrompts.id,ids));}
});
