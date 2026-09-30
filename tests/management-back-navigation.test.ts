import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";
import { breadcrumbsFor, parentFor } from "../src/lib/nav/routes";

/**
 * D.7 — Management nested Back-navigation audit.
 *
 * The topbar answers "where am I and how do I get back" from ONE table
 * (`src/lib/nav/routes.ts`). A page that is not in that table renders neither a
 * crumb nor a Back button, which turns an admin screen opened from a link,
 * bookmark or chat message into a dead end. So the gate is mechanical: walk the
 * real page files and require every staff screen to resolve to a crumb — and
 * every nested one to resolve to a parent that is not itself.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Route groups add no URL segment; a dynamic segment is sampled as a real value. */
function pageRoutes(dir = "src/app/(app)", prefix = ""): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = `${dir}/${entry}`;
    if (statSync(join(ROOT, path)).isDirectory()) {
      if (entry.startsWith("(") && entry.endsWith(")")) routes.push(...pageRoutes(path, prefix));
      else if (entry.startsWith("[")) routes.push(...pageRoutes(path, `${prefix}/qa-sample`));
      else routes.push(...pageRoutes(path, `${prefix}/${entry}`));
    } else if (entry === "page.tsx") {
      routes.push(prefix === "" ? "/" : prefix);
    }
  }
  return routes;
}

const STAFF_ROOTS = ["/management", "/admin", "/teacher", "/owner"];
/** Redirect-only aliases never render chrome; their target is checked instead. */
const REDIRECT_ALIASES = new Set(["/admin/users"]);

const staffRoutes = pageRoutes().filter(
  (route) => STAFF_ROOTS.some((root) => route === root || route.startsWith(`${root}/`)) && !REDIRECT_ALIASES.has(route)
);

test("every staff screen declares a crumb, so nothing in Management is a dead end", () => {
  // The walk must actually find the screens: a silent empty list would pass.
  assert.ok(staffRoutes.length >= 20, `expected the staff route tree, found ${staffRoutes.length}`);

  for (const route of staffRoutes) {
    assert.ok(breadcrumbsFor(route, en).length > 0, `${route} has no crumb entry in src/lib/nav/routes.ts`);
    assert.ok(breadcrumbsFor(route, uz).length > 0, `${route} has no crumb entry for the Uzbek dictionary`);
  }
});

test("every nested staff screen has a parent that is not itself", () => {
  for (const route of staffRoutes) {
    if (route === "/management") continue; // the mode root: nothing above it on purpose
    const parent = parentFor(route, en);
    assert.ok(parent, `${route} is nested but has no parent to go back to`);
    assert.notEqual(parent!.href, route, `${route} points its Back button at itself`);
    assert.ok(parent!.href.startsWith("/"), `${route} has a parent that is not a route`);
  }
});

test("the materials screens sit under Management and are reachable from it", () => {
  const hub = read("src/app/(app)/management/page.tsx");
  assert.match(hub, /href: "\/admin\/materials"/, "the hub must link the materials editor");
  assert.match(hub, /dict\.admin\.materialsTitle/);
  assert.match(hub, /dict\.management\.materialsBody/);

  // The chain is Management → Materials → (kind) and never a dead end.
  assert.deepEqual(
    breadcrumbsFor("/admin/materials", en).map((crumb) => crumb.href),
    ["/management", "/admin/materials"]
  );
  assert.equal(parentFor("/admin/materials", en)?.href, "/management");
  assert.equal(parentFor("/admin/materials/lesson", en)?.href, "/admin/materials");
  assert.equal(parentFor("/admin/materials/lesson/qa-sample", en)?.href, "/admin/materials");

  // The nested screens keep their own inline way up as well.
  assert.match(read("src/app/(app)/admin/materials/[type]/page.tsx"), /href="\/admin\/materials"/);
  assert.match(read("src/app/(app)/admin/materials/[type]/[id]/page.tsx"), /href=\{`\/admin\/materials\/\$\{type\}`\}/);
});

test("every card on the Management hub leads to a screen with a back path", () => {
  const hub = read("src/app/(app)/management/page.tsx");
  const hrefs = [...hub.matchAll(/href: "(\/[^"]+)"/g)].map((match) => match[1]!);
  assert.ok(hrefs.length >= 10, `expected the hub cards, found ${hrefs.length}`);
  for (const href of hrefs) {
    assert.ok(breadcrumbsFor(href, en).length > 0, `Management card ${href} leads to a screen with no crumb`);
  }
});

test("the legacy admin alias redirects into the audited tree", () => {
  const alias = read("src/app/(app)/admin/users/page.tsx");
  const targets = [...alias.matchAll(/redirect\("([^"]+)"\)/g)].map((match) => match[1]!);
  assert.ok(targets.includes("/admin/people"), "the old people route must still resolve to the real one");
  assert.ok(breadcrumbsFor("/admin/people", en).length > 0);
});
