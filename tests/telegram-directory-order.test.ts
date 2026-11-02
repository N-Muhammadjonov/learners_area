import assert from "node:assert/strict";
import test from "node:test";
import { compareDirectoryEntries, directoryUsername } from "../src/lib/telegram/directory-order";

test("username ordering ignores case and @ and keeps missing usernames last", () => {
  const entries = [
    { id: "4", entryType: "website_user", username: null },
    { id: "3", entryType: "telegram_contact", username: "Zebra" },
    { id: "2", entryType: "website_user", username: " @bob " },
    { id: "1", entryType: "telegram_contact", username: "ALICE" },
    { id: "5", entryType: "telegram_contact", username: "" },
  ];
  assert.deepEqual(entries.sort(compareDirectoryEntries).map(row => row.id), ["1", "2", "3", "5", "4"]);
  assert.equal(directoryUsername(" @@BoB "), "bob");
});

test("page prefixes from both sources merge into one global username order", () => {
  const entries = Array.from({ length: 27 }, (_, i) => ({
    id: String(i).padStart(2, "0"),
    entryType: i % 2 ? "website_user" : "telegram_contact",
    username: i >= 25 ? null : String.fromCharCode(65 + i),
    name: "★".repeat(27 - i),
  })).reverse();
  const expected = [...entries].sort(compareDirectoryEntries);
  const actual = [];
  for (let page = 1; page <= 3; page++) {
    const users = entries.filter(row => row.entryType === "website_user")
      .sort(compareDirectoryEntries).slice(0, page * 10);
    const contacts = entries.filter(row => row.entryType === "telegram_contact")
      .sort(compareDirectoryEntries).slice(0, page * 10);
    actual.push(...[...users, ...contacts].sort(compareDirectoryEntries).slice((page - 1) * 10, page * 10));
  }
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual.map(row => row.id)).size, 27);
  assert.equal(actual[24].username, "Y");
  assert.ok(actual.slice(25).every(row => row.username === null));
});

test("equal usernames have deterministic ordering across sources and IDs", () => {
  const entries = [
    { id: "b", entryType: "website_user", username: "Same" },
    { id: "a", entryType: "website_user", username: "same" },
    { id: "c", entryType: "telegram_contact", username: "SAME" },
  ];
  assert.deepEqual(entries.sort(compareDirectoryEntries).map(row => row.id), ["c", "a", "b"]);
});
