import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  ALLOWED_TRANSITIONS,
  DEFAULT_PUBLICATION_STATE,
  PUBLICATION_STATES,
  canTransition,
  isLive,
  isPublicationState,
  publicationProblem,
} from "../src/lib/services/cms/publication";

/**
 * The publication rule.
 *
 * Two properties matter more than the rest and are asserted first: content that
 * is not live must be invisible to students whatever its timestamp says, and
 * archiving must never be a delete (nothing in this module removes anything —
 * it only decides what is shown).
 */

test("there are exactly four publication states", () => {
  assert.deepEqual([...PUBLICATION_STATES], ["draft", "scheduled", "published", "archived"]);
  assert.equal(DEFAULT_PUBLICATION_STATE, "published");
  // Rows created before the feature existed are published, which is what the
  // boolean they replaced said.
  assert.equal(isPublicationState("published"), true);
  assert.equal(isPublicationState("Published"), false);
  assert.equal(isPublicationState(null), false);
  assert.equal(isPublicationState(3), false);
});

test("only published content, or a schedule that has arrived, is live", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  assert.equal(isLive({ publicationState: "published" }, now), true);
  assert.equal(isLive({ publicationState: "draft" }, now), false);
  assert.equal(isLive({ publicationState: "archived" }, now), false);
  assert.equal(
    isLive({ publicationState: "scheduled", publishAt: "2026-09-26T09:59:00Z" }, now),
    true
  );
  assert.equal(
    isLive({ publicationState: "scheduled", publishAt: "2026-09-26T10:01:00Z" }, now),
    false
  );
  // A scheduled row whose moment has passed is live; the state column is not
  // rewritten on a timer, so the moment is what decides.
  assert.equal(isLive({ publicationState: "scheduled", publishAt: new Date("2020-01-01T00:00:00Z") }, now), true);
});

test("a schedule without a moment is a draft, not an accidental publication", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  assert.equal(isLive({ publicationState: "scheduled", publishAt: null }, now), false);
  assert.equal(isLive({ publicationState: "scheduled" }, now), false);
  assert.equal(isLive({ publicationState: "scheduled", publishAt: "not a date" }, now), false);
});

test("a scheduled state needs a moment and the other states must not carry one", () => {
  const moment = new Date("2026-09-26T10:00:00Z");
  assert.equal(publicationProblem("scheduled", moment), null);
  assert.equal(publicationProblem("scheduled", null), "missing_publish_at");
  assert.equal(publicationProblem("published", null), null);
  assert.equal(publicationProblem("draft", null), null);
  assert.equal(publicationProblem("archived", null), null);
  // A leftover date on a published row is refused rather than ignored: it would
  // otherwise sit in the database looking meaningful.
  assert.equal(publicationProblem("published", moment), "unexpected_publish_at");
  assert.equal(publicationProblem("draft", moment), "unexpected_publish_at");
});

test("staff can move content through every state, one deliberate step at a time", () => {
  for (const from of PUBLICATION_STATES) {
    for (const to of PUBLICATION_STATES) {
      if (from === to) {
        assert.equal(canTransition(from, to), false, `${from} -> ${to} should be a no-op, not a transition`);
        continue;
      }
      assert.equal(
        canTransition(from, to),
        ALLOWED_TRANSITIONS[from].includes(to),
        `${from} -> ${to}`
      );
    }
  }
  // The move that exists to stop accidents: an archived item cannot be put on a
  // future schedule without being brought back first.
  assert.equal(canTransition("archived", "scheduled"), false, "archived -> scheduled needs a restore first");
  assert.equal(canTransition("archived", "draft"), true);
  assert.equal(canTransition("archived", "published"), true);
  assert.equal(canTransition("draft", "published"), true);
  assert.equal(canTransition("scheduled", "archived"), true);
});

test("archiving never deletes anything — the rule only hides", () => {
  const source = readFileSync("src/lib/services/cms/publication.ts", "utf8");
  for (const forbidden of ["delete(", "DELETE", "truncate"]) {
    assert.equal(source.includes(forbidden), false, `publication.ts must not ${forbidden}`);
  }
  const route = readFileSync("src/app/api/admin/content/[type]/[id]/publication/route.ts", "utf8");
  assert.equal(/\.delete\(/.test(route), false, "the publication endpoint must never delete a row");
});

test("every publishable content type goes through the one endpoint and the one rule", () => {
  const route = readFileSync("src/app/api/admin/content/[type]/[id]/publication/route.ts", "utf8");
  for (const type of ["reading", "listening", "writing", "speaking", "speaking-prompt", "video", "course"]) {
    assert.ok(route.includes(`  ${type}: {`) || route.includes(`  "${type}": {`), `${type} is not handled`);
  }
  // Only ADMIN and OWNER may publish; a teacher must not be able to.
  assert.match(route, /requireAdministrator\(\)/);
  assert.equal(/requireStaff\(\)/.test(route), false, "publication is not a teacher decision");
  // Every accepted change is audited.
  assert.match(route, /recordAudit\(\{/);
  assert.match(route, /action: "content\.updated"/);
});

test("no content type keeps a second, private visibility rule", () => {
  // A new `is_active` filter would be a second answer to the same question.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(path)) continue;
      const code = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => line.split("//")[0])
        .join("\n");
      if (/isActive, true/.test(code) || /is_active"\)\s*,\s*true/.test(code)) {
        offenders.push(path);
      }
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
});

test("a student-facing gate exists wherever an attempt can be created", () => {
  const gates = [
    "src/app/api/reading/attempts/route.ts",
    "src/app/api/listening/attempts/route.ts",
    "src/app/api/writing/submissions/route.ts",
    "src/app/api/video-lessons/[id]/answers/route.ts",
  ];
  for (const path of gates) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /isLive|getStartable/, `${path} does not check that the content is live`);
  }
});
