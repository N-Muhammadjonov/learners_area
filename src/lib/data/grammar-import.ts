import "server-only";
import { createHash } from "node:crypto";
import { recordAudit } from "./audit";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { grammarExercises, grammarTopics } from "@/db/schema";
import type { GrammarBundle } from "@/lib/grammar/import-schema";
export async function importGrammarBundle(bundle: GrammarBundle, dryRun: boolean, database = db, actorUserId?: string) {
  return database.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(73492760)`);
    const existing = await tx.select({title: grammarTopics.title, skillArea: grammarTopics.skillArea, order: grammarTopics.order}).from(grammarTopics);
    const keys = new Set(existing.map(topic => `${topic.skillArea}:${topic.title.toLowerCase()}`));
    if (bundle.topics.some(topic => keys.has(`${topic.skillArea}:${topic.title.toLowerCase()}`))) return {ok: false as const, error: "conflict"};
    const total = bundle.topics.reduce((n, topic) => n + topic.exercises.length, 0);
    if (dryRun) return {ok: true as const, dryRun: true, topics: bundle.topics.length, exercises: total};
    let order = Math.max(0, ...existing.map(topic => topic.order));
    for (const {exercises, ...topic} of bundle.topics) {
      const [created] = await tx.insert(grammarTopics).values({...topic, order: ++order}).returning({id: grammarTopics.id});
      await tx.insert(grammarExercises).values(exercises.map((exercise, index) => ({...exercise, topicId: created!.id, order: index + 1})));
    }
    if (actorUserId) await recordAudit({actorUserId, action: "grammar.bundle_imported", targetType: "grammar", metadata: {
      provenance: bundle.provenance, sha256: createHash("sha256").update(JSON.stringify(bundle)).digest("hex"), topics: bundle.topics.length, exercises: total,
    }}, tx);
    return {ok: true as const, dryRun: false, topics: bundle.topics.length, exercises: total};
  });
}
