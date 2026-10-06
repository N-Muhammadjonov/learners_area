import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import { MANAGEMENT_PREFIXES, isManagementRoute } from "../src/lib/nav/mode";

/**
 * The navigation mode is derived from the route - never from a click, a
 * component state or a stored preference - because a management page reached by
 * bookmark, refresh, a link in a chat or a typed URL must show the management
 * navigation. The rendered proof for that lives in
 * `scripts/verify-navigation.mjs` (direct request per mode, per role); what this
 * test adds is completeness: *every* management route that exists in the app is
 * recognised, and no learning route is caught by mistake.
 */

const ROOT = new URL("..", import.meta.url).pathname;
/** The physical route tree of the ordinary shell group (URL prefix `/app`). */
const APP = join(ROOT, "src/app/app/(shell)");
/** `/app/admin` -> `admin`: the directory name under the shell group. */
const shellSegment = (prefix: string) => prefix.replace(/^\/app\//, "");

function routeExists(path: string): boolean {
  try {
    return statSync(join(APP, path)).isDirectory();
  } catch {
    return false;
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "page.tsx") out.push(relative(APP, full));
  }
  return out;
}

test("management prefixes match the routes that actually exist", () => {
  for (const prefix of MANAGEMENT_PREFIXES) {
    assert.ok(routeExists(shellSegment(prefix)), `${prefix} has no route directory`);
  }
});

test("every management page in the app is recognised as management mode", () => {
  const pages = walk(APP);
  const managementPages = pages.filter((page) =>
    MANAGEMENT_PREFIXES.some((prefix) => page.startsWith(`${shellSegment(prefix)}/`)),
  );

  assert.ok(managementPages.length >= 10, `expected a real management half, found ${managementPages.length} pages`);

  for (const page of managementPages) {
    // The shell group's URL base is `/app`; the walk is relative to the group.
    const pathname = `/app/${page.replace(/\/page\.tsx$/, "")}`;
    assert.equal(isManagementRoute(pathname), true, `${pathname} must be in management mode`);
  }
});

test("learning routes stay in learning mode", () => {
  for (const pathname of ["/", "/app", "/app/reading", "/app/reading/attempts/abc", "/app/vocabulary", "/app/progress", "/app/mocks", "/app/support"]) {
    assert.equal(isManagementRoute(pathname), false, `${pathname} must stay in learning mode`);
  }
});

test("the prefix check respects path boundaries", () => {
  // A route that merely starts with the same letters is not a management route.
  assert.equal(isManagementRoute("/administrator"), false);
  assert.equal(isManagementRoute("/ownerx"), false);
  assert.equal(isManagementRoute("/teachers"), false);
  assert.equal(isManagementRoute("/managementplan"), false);
  // The exact hub path and anything under it are.
  assert.equal(isManagementRoute("/app/management"), true);
  assert.equal(isManagementRoute("/app/management/anything"), true);
  assert.equal(isManagementRoute("/app/admin"), true);
  assert.equal(isManagementRoute("/app/admin/people"), true);
  assert.equal(isManagementRoute("/app/owner/audit"), true);
  assert.equal(isManagementRoute("/app/teacher/students"), true);
});
