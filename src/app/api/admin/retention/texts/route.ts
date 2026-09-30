import { NextRequest } from "next/server";
import { db } from "@/db/client";
import {
  createRetentionText,
  listRetentionInventory,
  listRetentionLevelPage,
} from "@/lib/data/retention-bank";
import { isRetentionLevel } from "@/lib/retention/levels";
import { requireRetentionAdmin } from "@/lib/retention/admin";
import { invalidJson, retentionJson } from "@/lib/retention/http";
import { createRetentionTextSchema, retentionListQuerySchema } from "@/lib/validation/retention";

/**
 * GET /api/admin/retention/texts?level=A2&filter=active&sort=label&page=1
 *
 * The Management screen asks for one level at a time: the inventory ("A2 4/15")
 * and that level's rows with both usage numbers. Two aggregate queries plus one
 * bounded list — never one query per text (§147).
 *
 * `?level=all` (or an unknown level) answers the inventory only, which is what
 * the level grid needs before anything is opened.
 */
export async function GET(request: NextRequest) {
  const gate = await requireRetentionAdmin();
  if (!gate.ok) return gate.response;

  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = retentionListQuerySchema.safeParse(raw);
  if (!parsed.success) return invalidJson();

  return retentionJson(async () => {
    const inventory = await listRetentionInventory(db);
    if (!isRetentionLevel(parsed.data.level)) {
      return { inventory, level: null, rows: [] };
    }
    const page = await listRetentionLevelPage({
      level: parsed.data.level,
      filter: parsed.data.filter ?? "active",
      sort: parsed.data.sort ?? "label",
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    }, db);
    return {
      inventory,
      level: parsed.data.level,
      rows: page.rows,
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      pageCount: page.pageCount,
    };
  });
}

/**
 * POST /api/admin/retention/texts — Add text.
 *
 * The body is exactly the two authoring fields (plus the level the screen is
 * already on): the text and the Measurement Structure. Internal label, sequence,
 * version, active flag and usage counters are assigned by the server.
 *
 * Refusals are specific on purpose: a word count outside the level's range
 * answers `retention_word_count_out_of_range` with the actual count and the
 * allowed range, and a structure that is not worth exactly 100 points answers
 * `retention_invalid_structure` with the list of problems, so the editor can
 * point at the field instead of saying "invalid".
 */
export async function POST(request: NextRequest) {
  const gate = await requireRetentionAdmin();
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const parsed = createRetentionTextSchema.safeParse(body);
  if (!parsed.success) return invalidJson();

  return retentionJson(async () => {
    const created = await createRetentionText({
      level: parsed.data.level,
      bodyText: parsed.data.bodyText,
      scoringStructure: parsed.data.scoringStructure,
      actorUserId: gate.user.id,
    });
    return { ok: true, ...created };
  });
}
