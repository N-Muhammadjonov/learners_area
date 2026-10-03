import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator } from "@/lib/auth/current-user";
import { grammarBundleSchema } from "@/lib/grammar/import-schema";
import { importGrammarBundle } from "@/lib/data/grammar-import";
import { db } from "@/db/client";
const schema = z.object({dryRun: z.boolean().default(true), bundle: grammarBundleSchema}).strict();
export async function POST(req: NextRequest) {
  const user = await requireAdministrator();
  if (!user) return NextResponse.json({error: "forbidden"}, {status: 403});
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > 500000) return NextResponse.json({error: "invalid_input"}, {status: 413});
  let body: unknown;
  try {body = JSON.parse(raw || "null");} catch {return NextResponse.json({error: "invalid_input"}, {status: 400});}
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({error: "invalid_input"}, {status: 400});
  const result = await importGrammarBundle(parsed.data.bundle, parsed.data.dryRun, db, user.id);
  return NextResponse.json(result, {status: result.ok ? 200 : 409, headers: {"Cache-Control":"private, no-store"}});
}
