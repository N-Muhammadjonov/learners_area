import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import nextConfig from "../next.config.mjs";

/**
 * The `/app` namespace, from the route tree's point of view.
 *
 * These are the checks a `next build` does not make (and did not make on the merged
 * tree: `/api/lessons/[id]` and `/api/lessons/[lessonId]` coexisted, the build passed,
 * and the conflict only surfaced at runtime as an HTTP 500). They are cheap, they read
 * the real filesystem, and they fail loudly.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP_DIR = join(ROOT, "src/app");

/** Every page.tsx / route.ts in the app, with its URL path and its filesystem path. */
function routeTree() {
  const routes: { url: string; file: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry !== "page.tsx" && entry !== "route.ts") continue;
      const parts = relative(APP_DIR, dir)
        .split("/")
        .filter((p) => p && p !== "." && !(p.startsWith("(") && p.endsWith(")")));
      routes.push({ url: "/" + parts.join("/"), file: relative(ROOT, full) });
    }
  };
  walk(APP_DIR);
  return routes;
}

const ROUTES = routeTree();

/** Route groups are invisible in the URL, so two groups can collide where files cannot. */
function duplicateUrls() {
  const byUrl = new Map<string, string[]>();
  for (const r of ROUTES) {
    if (r.url === "/") continue;
    byUrl.set(r.url, [...(byUrl.get(r.url) ?? []), r.file]);
  }
  return [...byUrl.entries()].filter(([, files]) => files.length > 1);
}

/**
 * For one parent URL path, every dynamic child must use the SAME slug name.
 * Next.js refuses `'id' !== 'lessonId'` at runtime, not at build time.
 */
function slugConflicts() {
  const byParent = new Map<string, Set<string>>();
  for (const dir of allDirs(APP_DIR)) {
    const parts = relative(APP_DIR, dir)
      .split("/")
      .filter((p) => p && !(p.startsWith("(") && p.endsWith(")")));
    const last = parts.at(-1);
    if (!last || !last.startsWith("[") || last.startsWith("[...")) continue;
    const parent = "/" + parts.slice(0, -1).join("/");
    byParent.set(parent, (byParent.get(parent) ?? new Set()).add(last));
  }
  return [...byParent.entries()].filter(([, names]) => names.size > 1);
}

function allDirs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    out.push(full);
    allDirs(full, out);
  }
  return out;
}

test("no two routes resolve to the same URL, and one parent never uses two slug names", () => {
  assert.deepEqual(duplicateUrls(), [], "two route groups produced the same URL");
  assert.deepEqual(
    slugConflicts(),
    [],
    "a parent path uses differently named dynamic segments — Next.js answers 500 at request time",
  );
});

test("every authenticated page lives under /app, and only the public pages do not", () => {
  const PUBLIC_PREFIXES = ["/login", "/register", "/reset-password", "/pending", "/onboarding", "/api", "/_not-found"];
  const offenders = ROUTES.filter(
    (r) =>
      r.url !== "/" &&
      !r.url.startsWith("/app") &&
      !PUBLIC_PREFIXES.some((p) => r.url === p || r.url.startsWith(`${p}/`)),
  );
  assert.deepEqual(offenders, [], "these routes are outside /app and are not public pages");

  for (const page of ["/app/listening", "/app/reading", "/app/writing", "/app/speaking", "/app/admin/content"]) {
    assert.ok(ROUTES.some((r) => r.url === page), `${page} must exist in the /app namespace`);
  }
  // The shell and the focus surfaces are siblings under one gate.
  assert.ok(existsSync(join(APP_DIR, "app/layout.tsx")), "the /app namespace gate is missing");
  assert.ok(existsSync(join(APP_DIR, "app/(shell)/layout.tsx")), "the ordinary shell layout is missing");
  assert.ok(existsSync(join(APP_DIR, "app/(focus)/layout.tsx")), "the focus layout is missing");
  assert.ok(!existsSync(join(APP_DIR, "(app)")) && !existsSync(join(APP_DIR, "(focus)")), "the old route groups must be gone");
});

test("the legacy redirect table covers exactly the modules that moved, and never /api", async () => {
  const rules = (await nextConfig.redirects!()) ?? [];
  const shellSegments = new Set(
    readdirSync(join(APP_DIR, "app/(shell)")).filter((e) => statSync(join(APP_DIR, "app/(shell)", e)).isDirectory()),
  );
  const covered = new Set(
    rules
      .map((r) => String(r.source).split("/")[1] ?? "")
      .filter((s) => s.length > 0 && !s.startsWith(":")),
  );
  for (const segment of shellSegments) {
    assert.ok(covered.has(segment), `/${segment} has no redirect to /app/${segment}`);
  }
  for (const segment of covered) {
    assert.ok(shellSegments.has(segment), `/ redirect /${segment} names a module that does not exist`);
  }
  // Query strings and deep paths survive: the destination keeps `:path*` and Next
  // carries the search string across a 307.
  for (const r of rules) {
    assert.equal(r.permanent, false, `${r.source} must be temporary while /app settles`);
    assert.match(String(r.destination), /^\/app\//, `${r.source} must land inside /app`);
  }
  assert.ok(!rules.some((r) => String(r.source).startsWith("/api")), "never redirect an API path");
  // Two rules per module on purpose (the module root and every deeper path); the
  // pair must still be unique, and no module may be redirected twice to two places.
  const pairs = rules.map((r) => `${r.source} -> ${r.destination}`);
  assert.equal(new Set(pairs).size, pairs.length, "duplicate redirect rule");
  const destinations = new Map<string, string>();
  for (const r of rules) {
    const from = String(r.source).replace("/:path*", "");
    const to = String(r.destination).replace("/:path*", "");
    assert.equal(destinations.get(from) ?? to, to, `/${from} has two destinations`);
    destinations.set(from, to);
  }
});

test("the middleware's coarse session check covers /app and the historical module paths", () => {
  const middleware = readFileSync(join(ROOT, "src/middleware.ts"), "utf8");
  assert.match(middleware, /const PROTECTED_PREFIXES = \[/);
  assert.match(middleware, /^\s*"\/app",$/m, "the /app namespace must be session-checked");
  for (const legacy of ["/dashboard", "/listening", "/reading", "/writing", "/speaking", "/admin", "/owner", "/teacher"]) {
    assert.match(middleware, new RegExp(`^\\s*"${legacy}",$`, "m"), `${legacy} must still be session-checked`);
  }
  // Public-but-account-gated surfaces stay outside /app on purpose.
  assert.match(middleware, /^\s*"\/onboarding",$/m);
  assert.match(middleware, /^\s*"\/pending",$/m);
});

test("the API namespace never moves under /app", () => {
  assert.ok(!existsSync(join(APP_DIR, "app/api")), "APIs must stay at /api");
  assert.ok(existsSync(join(APP_DIR, "api")), "the API root is /api");
});
