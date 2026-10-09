import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "../src/app/api/cron/riwi-chat-retention/route";

test("retention cron rejects missing, weak, and incorrect credentials before touching the database", async () => {
  const previous = process.env.CRON_SECRET;
  try {
    for (const [secret, authorization] of [
      [undefined, undefined],
      ["weak", "Bearer weak"],
      ["a".repeat(32), undefined],
      ["a".repeat(32), `Bearer ${"b".repeat(32)}`],
    ]) {
      if (secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secret;
      const response = await GET(new NextRequest("https://example.test/api/cron/riwi-chat-retention", {
        headers: authorization ? { authorization } : {},
      }));
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthorized" });
    }
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
