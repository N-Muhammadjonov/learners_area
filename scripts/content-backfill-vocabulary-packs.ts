#!/usr/bin/env -S node --conditions=react-server --import tsx
/**
 * Backfill vocabulary topic packs from the built-in TypeScript packs (§95, §100).
 *
 * WHAT THIS IS: the packs that used to be a constant in the code ARE real authored
 * teaching material — this script moves them into the database, where every other
 * piece of content lives, so a new pack is a content operation instead of a
 * deployment. It DOES NOT invent content: every word, gloss and example comes from
 * the existing pack definitions, and a word that already exists as a canonical
 * sense is REUSED rather than duplicated (`senseKeyOf` decides, exactly as the
 * vocabulary engine does).
 *
 * Idempotent by construction: packs are keyed by `source_ref` (`pack-<id>`) and
 * re-running only reports "unchanged"; `--force` re-pins a revision when the built-in
 * definitions changed. Nothing is deleted, and an admin-authored pack with the same
 * slug is never overwritten by a built-in one.
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/content-backfill-vocabulary-packs.ts --dry-run
 *   node --conditions=react-server --import tsx scripts/content-backfill-vocabulary-packs.ts --publish
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db/tooling-client";
import { vocabularyTopicPacks } from "../src/db/schema";
import { saveTopicPack } from "../src/lib/content/vocabulary-packs";
import { TOPIC_PACKS } from "../src/lib/services/vocabulary/packs";

type Outcome = { id: string; action: "created" | "revised" | "unchanged" | "skipped_admin_authored"; words: number; versionId?: string };

function parseArgs(argv: string[]) {
  return {
    dryRun: argv.includes("--dry-run"),
    publish: argv.includes("--publish") || argv.includes("--dry-run") === false,
    force: argv.includes("--force"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const actorUserId = process.env.CONTENT_BACKFILL_ACTOR_USER_ID ?? null;

  if (args.dryRun) {
    for (const pack of TOPIC_PACKS)
      console.log(`would backfill pack:${pack.id} — ${pack.label.en} (${pack.words.length} words)`);
    console.log(`\n${TOPIC_PACKS.length} pack(s) would be written; nothing was changed (--dry-run).`);
    return;
  }
  if (!actorUserId) {
    console.error("CONTENT_BACKFILL_ACTOR_USER_ID is required: a revision needs an author, and this script will not invent one.");
    process.exitCode = 2;
    return;
  }

  const outcomes: Outcome[] = [];
  for (const pack of TOPIC_PACKS) {
    const sourceRef = `pack-${pack.id}`;
    const existing = await db.select().from(vocabularyTopicPacks).where(eq(vocabularyTopicPacks.sourceRef, sourceRef)).limit(1);
    const slugTaken = await db.select().from(vocabularyTopicPacks).where(eq(vocabularyTopicPacks.slug, pack.id)).limit(1);
    if (slugTaken[0] && slugTaken[0].sourceRef !== sourceRef) {
      outcomes.push({ id: pack.id, action: "skipped_admin_authored", words: pack.words.length });
      continue;
    }

    const result = await db.transaction((tx) =>
      saveTopicPack(tx, {
        actorUserId,
        sourceRef,
        slug: pack.id,
        labelEn: pack.label.en,
        labelUz: pack.label.uz,
        words: pack.words,
        publish: args.publish,
      }),
    );
    if (!result.ok) {
      console.error(`failed to backfill ${sourceRef}: ${result.issues.map((issue) => issue.message).join("; ")}`);
      process.exitCode = 1;
      continue;
    }
    outcomes.push({ id: pack.id, action: existing[0] ? "revised" : "created", words: result.words, versionId: result.versionId });
  }

  for (const outcome of outcomes)
    console.log(`${outcome.action.padEnd(24)} pack:${outcome.id} — ${outcome.words} word(s)${outcome.versionId ? ` (${outcome.versionId.slice(0, 8)})` : ""}`);
  const written = outcomes.filter((outcome) => outcome.action === "created" || outcome.action === "revised").length;
  console.log(`\n${written} pack(s) written, ${outcomes.length - written} left alone.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
