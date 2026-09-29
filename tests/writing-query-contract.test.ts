import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

test("Writing joins UUID owner IDs as UUIDs instead of comparing UUID to text", () => {
  const query = read("src/lib/data/writing.ts");
  const schema = read("src/db/schema.ts");
  assert.match(schema, /writingPrompts = pgTable\("writing_prompts",\s*\{\s*id: uuid\("id"\)/);
  assert.match(schema, /resourceBlocks = pgTable\([\s\S]*?ownerId: uuid\("owner_id"\)/);
  assert.match(query, /eq\(resourceBlocks\.ownerId, writingPrompts\.id\)/);
  assert.doesNotMatch(query, /resourceBlocks\.ownerId[^\n]*::text|writingPrompts\.id\}::text/);
});
