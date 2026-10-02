import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { db } from "@/db/client";
import { lexemes, lexicalUnitForms, lexicalUnits } from "@/db/schema";
import { isFunctionWord, lemmaNorm, lexicalTypeFor, partOfSpeechNorm } from "@/lib/text/lexical-normalize";
import { formsOf } from "./forms";

type Tx = Pick<typeof db, "select" | "insert" | "update" | "query">;

/** Identity of the lexeme a sense belongs to — identical to the 0029 backfill. */
export function unitIdentity(term: string, partOfSpeech: string | null | undefined) {
  return {
    language: "en",
    lemmaNorm: lemmaNorm(term).slice(0, 120),
    partOfSpeech: partOfSpeechNorm(partOfSpeech).slice(0, 30),
    lexicalType: lexicalTypeFor(term, partOfSpeech),
  };
}

/**
 * The lexical unit for (term, POS): found or created, with its surface forms.
 * Idempotent and race-safe (unique identity index + ON CONFLICT DO NOTHING).
 */
export async function ensureLexicalUnit(tx: Tx, input: { term: string; partOfSpeech?: string | null; provenance: string }): Promise<string> {
  const identity = unitIdentity(input.term, input.partOfSpeech);
  const where = and(
    eq(lexicalUnits.language, identity.language), eq(lexicalUnits.lemmaNorm, identity.lemmaNorm),
    eq(lexicalUnits.partOfSpeech, identity.partOfSpeech), eq(lexicalUnits.lexicalType, identity.lexicalType),
  );
  let unit = await tx.query.lexicalUnits.findFirst({ where, columns: { id: true } });
  if (!unit) {
    await tx.insert(lexicalUnits).values({
      ...identity, lemma: input.term.trim().slice(0, 120), isFunctionWord: isFunctionWord(input.term), provenance: input.provenance,
    }).onConflictDoNothing();
    unit = await tx.query.lexicalUnits.findFirst({ where, columns: { id: true } });
  }
  const unitId = unit!.id;
  const forms = formsOf(input.term, input.partOfSpeech);
  if (forms.length) {
    await tx.insert(lexicalUnitForms)
      .values(forms.map((form) => ({ lexicalUnitId: unitId, form: form.form.slice(0, 160), formNorm: form.formNorm.slice(0, 160), formType: form.formType })))
      .onConflictDoNothing();
  }
  return unitId;
}

/** Attach an existing sense to its unit when it has none yet. Never moves a linked sense. */
export async function linkSenseToUnit(tx: Tx, sense: { id: string; term: string; partOfSpeech: string | null; lexicalUnitId?: string | null }, provenance: string): Promise<string> {
  if (sense.lexicalUnitId) return sense.lexicalUnitId;
  const unitId = await ensureLexicalUnit(tx, { term: sense.term, partOfSpeech: sense.partOfSpeech, provenance });
  await tx.update(lexemes).set({ lexicalUnitId: unitId }).where(and(eq(lexemes.id, sense.id), isNull(lexemes.lexicalUnitId)));
  return unitId;
}

/** Units whose forms include this surface form (e.g. "ran" → run). Several = ambiguous by design. */
export async function unitsForSurface(tx: Tx, surface: string): Promise<string[]> {
  const rows = await tx.select({ id: lexicalUnitForms.lexicalUnitId }).from(lexicalUnitForms)
    .where(eq(lexicalUnitForms.formNorm, lemmaNorm(surface)));
  return [...new Set(rows.map((row) => row.id))];
}

/** Regenerate inflected forms for every unit (after the 0029 backfill inserted lemma forms only). Idempotent. */
export async function backfillLexicalForms(tx: Tx): Promise<{ units: number; forms: number }> {
  const units = await tx.select({ id: lexicalUnits.id, lemma: lexicalUnits.lemma, pos: lexicalUnits.partOfSpeech }).from(lexicalUnits);
  let forms = 0;
  for (const unit of units) {
    const rows = formsOf(unit.lemma, unit.pos);
    if (!rows.length) continue;
    const inserted = await tx.insert(lexicalUnitForms)
      .values(rows.map((form) => ({ lexicalUnitId: unit.id, form: form.form.slice(0, 160), formNorm: form.formNorm.slice(0, 160), formType: form.formType })))
      .onConflictDoNothing().returning({ id: lexicalUnitForms.id });
    forms += inserted.length;
  }
  return { units: units.length, forms };
}

