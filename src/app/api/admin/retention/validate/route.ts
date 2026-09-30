import { NextRequest } from "next/server";
import { validateAuthoredContent } from "@/lib/data/retention-bank";
import { requireRetentionAdmin } from "@/lib/retention/admin";
import { invalidJson, retentionJson } from "@/lib/retention/http";
import { isRetentionError } from "@/lib/retention/errors";
import { createRetentionTextSchema } from "@/lib/validation/retention";

/**
 * POST /api/admin/retention/validate — the editor's live check.
 *
 * Same validator the save uses, so "the editor said it was fine" and "the server
 * accepted it" cannot diverge. It writes nothing and returns, on success, the
 * canonical word count the text will be stored with.
 *
 * A refusal here is a normal 200 body with `valid: false` and the issue list:
 * the editor is typing, and a red field is not an HTTP error condition.
 */
export async function POST(request: NextRequest) {
  const gate = await requireRetentionAdmin();
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const parsed = createRetentionTextSchema.safeParse(body);
  if (!parsed.success) return invalidJson();

  return retentionJson(async () => {
    try {
      const content = validateAuthoredContent({
        level: parsed.data.level,
        bodyText: parsed.data.bodyText,
        scoringStructure: parsed.data.scoringStructure,
      });
      return {
        valid: true,
        wordCount: content.wordCount,
        level: content.level,
        claims: content.scoringStructure.claims.length,
      };
    } catch (error) {
      if (isRetentionError(error)) {
        return { valid: false, error: error.code, details: error.details ?? null };
      }
      throw error;
    }
  });
}
