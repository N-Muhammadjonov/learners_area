import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingPrompts } from "@/db/schema";
import { speakingTopicDraft, speakingTopicIdentity } from "./topic-draft";
import { sharedSpeakingChannels, usesSharedSpeakingBank } from "./study-support";
import { cleanStudyHtml } from "./rich-text";
import type { z } from "zod";
export class SpeakingTopicConflict extends Error {}
type Identity = z.infer<typeof speakingTopicIdentity>;
function scope(identity: Omit<Identity, "ids">) {
  return and(eq(speakingPrompts.part, identity.part), identity.topic === null ? isNull(speakingPrompts.topic) : eq(speakingPrompts.topic, identity.topic),
    identity.bank === "shared" ? sql`(${speakingPrompts.availableIn} @> '["practice_alone"]'::jsonb OR ${speakingPrompts.availableIn} @> '["live_partner"]'::jsonb)` : sql`NOT (${speakingPrompts.availableIn} @> '["practice_alone"]'::jsonb OR ${speakingPrompts.availableIn} @> '["live_partner"]'::jsonb)`);
}
/** Serialize owner topic writes, then validate the full group before any mutation. */
export async function manageSpeakingTopic(input: z.infer<typeof speakingTopicDraft> | { archive: Identity }) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(76432109)`);
    const original = "archive" in input ? input.archive : input.original;
    const existing = original ? await tx.select().from(speakingPrompts).where(scope(original)).for("update") : [];
    if (original && (existing.length !== original.ids.length || existing.some(q => !original.ids.includes(q.id)))) throw new SpeakingTopicConflict("Topic changed. Reload it before saving.");
    if ("archive" in input) {
      return tx.update(speakingPrompts).set({publicationState: "archived"}).where(inArray(speakingPrompts.id, original!.ids)).returning();
    }
    const first = input.questions[0]!;
    const target = {part: first.part, topic: first.topic, bank: usesSharedSpeakingBank(first.availableIn) ? "shared" as const : "ai" as const};
    const occupied = await tx.select({id: speakingPrompts.id}).from(speakingPrompts).where(scope(target));
    if (occupied.some(q => !original?.ids.includes(q.id))) throw new SpeakingTopicConflict("This topic exists. Open it to add questions.");
    if (original) await tx.update(speakingPrompts).set({topic:first.topic}).where(inArray(speakingPrompts.id,original.ids));
    const kept = new Set(input.questions.flatMap(q => q.id ? [q.id] : []));
    const removed = existing.filter(q => !kept.has(q.id));
    // Soft removal preserves past attempts and saved vocabulary references.
    for (const q of removed) await tx.update(speakingPrompts).set({publicationState: "archived"}).where(eq(speakingPrompts.id, q.id));
    const saved = [];
    for (const [index, q] of input.questions.entries()) {
      const {id, studySupport, ...draft} = q;
      const values = {...draft, availableIn: sharedSpeakingChannels(draft.availableIn), category: draft.part,
        prepSeconds: draft.part === "part2" ? 60 : 0, answerSeconds: draft.part === "part2" ? 120 : draft.part === "part3" ? 45 : 30,
        studySupport: {...studySupport, vocabularyHtml: cleanStudyHtml(studySupport.vocabularyHtml), modelAnswerHtml: cleanStudyHtml(studySupport.modelAnswerHtml), ideasHtml: cleanStudyHtml(studySupport.ideasHtml)}, publicationState: "published" as const, publishAt: null};
      const rows = id ? await tx.update(speakingPrompts).set(values).where(eq(speakingPrompts.id,id)).returning() : await tx.insert(speakingPrompts).values({...values, createdAt:new Date(Date.now() + index)}).returning();
      saved.push(rows[0]!);
    }
    return saved;
  });
}
