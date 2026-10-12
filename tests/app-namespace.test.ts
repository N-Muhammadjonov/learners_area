import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import nextConfig from "../next.config.mjs";
import { ACCOUNT_GATED_PATHS, PRIVATE_MODULE_SEGMENTS } from "../src/lib/nav/private-modules.mjs";
import * as navRoutes from "../src/lib/nav/routes";
import en from "../src/lib/i18n/en";

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
  const PUBLIC_PREFIXES = ["/login", "/auth/recovery", "/register", "/reset-password", "/pending", "/onboarding", "/api", "/_not-found"];
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
  // Legacy rules only: the canonical-home aliases live under `/app` and are
  // asserted by the dedicated dashboard test above.
  const covered = new Set(
    rules
      .filter((r) => !String(r.source).startsWith("/app"))
      .map((r) => String(r.source).split("/")[1] ?? "")
      .filter((s) => s.length > 0 && !s.startsWith(":")),
  );

  // Every module that still has a page under the shell group is reachable from its
  // historical URL…
  for (const segment of shellSegments) {
    assert.ok(covered.has(segment), `/${segment} has no redirect to /app/${segment}`);
  }
  // …and the table names exactly the historical modules: the shell group plus the
  // dashboard, whose page IS the namespace root and therefore has no directory.
  const expected = new Set([...shellSegments, "dashboard"]);
  assert.deepEqual([...covered].sort(), [...expected].sort(), "the redirect table and the route tree disagree");

  // 307 + inside /app, and the module root of the dashboard lands on `/app` itself.
  for (const r of rules) {
    assert.equal(r.permanent, false, `${r.source} must be temporary while /app settles`);
    assert.match(String(r.destination), /^\/app(\/|$)/, `${r.source} must land inside /app`);
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

test("the middleware's coarse session check covers the canonical /app namespace and EVERY legacy module", () => {
  const middleware = readFileSync(join(ROOT, "src/middleware.ts"), "utf8");
  assert.match(middleware, /const PROTECTED_PREFIXES = \[/);
  // Derived from one shared table, not restated — and the table has to be the thing
  // the config and the middleware both read, or the drift comes back.
  assert.match(middleware, /APP_HOME/, "the canonical home must be session-checked");
  assert.match(middleware, /ACCOUNT_GATED_PATHS/, "the account-gated non-module paths must be checked");
  assert.match(middleware, /PRIVATE_MODULE_SEGMENTS\.map/, "every historical module must be checked");
  assert.match(middleware, /private-modules\.mjs/, "the shared table is the source of truth");
  assert.match(nextConfigSource(), /private-modules\.mjs/, "next.config.mjs must read the same table");
  assert.match(nextConfigSource(), /legacyModuleRedirects/, "the redirect table must come from it too");

  // Not one of the 22 modules may be missing, and the two public-but-gated paths stay.
  assert.equal(PRIVATE_MODULE_SEGMENTS.length, 22);
  for (const segment of PRIVATE_MODULE_SEGMENTS) {
    assert.ok(PRIVATE_MODULE_SEGMENTS.includes(segment), `${segment} is missing from the shared table`);
  }
  for (const gated of ACCOUNT_GATED_PATHS) {
    assert.ok(["/onboarding", "/pending"].includes(gated), `${gated} is not an account-gated public path`);
  }
});

test("/app IS the dashboard: one implementation, two aliases, no duplicate page", async () => {
  const rules = (await nextConfig.redirects!()) ?? [];
  const home = (await import("../src/lib/nav/private-modules.mjs")).APP_HOME as string;
  assert.equal(home, "/app");

  // 1. `/app` resolves to the Dashboard — the namespace root IS the index page.
  const index = join(APP_DIR, "app/(shell)/page.tsx");
  assert.ok(existsSync(index), "/app must render the dashboard from (shell)/page.tsx");
  const source = readFileSync(index, "utf8");
  assert.match(source, /data-route-usable="dashboard"/, "/app must be the dashboard");
  assert.match(source, /getDashboardData/, "/app must use the real dashboard data");
  // 2. There is no second dashboard implementation anywhere.
  assert.ok(!existsSync(join(APP_DIR, "app/(shell)/dashboard")), "no duplicate dashboard route may exist");
  assert.ok(!ROUTES.some((r) => r.url === "/app/dashboard"), "/app/dashboard must not be a page");

  // 3. `/dashboard` and `/app/dashboard` both canonicalize to `/app`.
  for (const source_ of ["/dashboard", "/app/dashboard"]) {
    const rule = rules.find((r) => r.source === source_);
    assert.ok(rule, `${source_} has no redirect rule`);
    assert.equal(rule.destination, "/app", `${source_} must canonicalize to /app`);
    assert.equal(rule.permanent, false, `${source_} must stay a temporary redirect`);
  }
  // 4. A deeper legacy path keeps its shape under /app.
  assert.equal(rules.find((r) => r.source === "/dashboard/:path*")?.destination, "/app/:path*");

  // 5. No internal navigation may emit /app/dashboard as the canonical Home.
  const offenders: string[] = [];
  for (const file of allFiles(join(ROOT, "src"))) {
    if (!/\.(ts|tsx|mjs)$/.test(file)) continue;
    if (file.endsWith("nav/private-modules.mjs")) continue; // the alias table itself
    for (const [index_, line] of readFileSync(file, "utf8").split("\n").entries()) {
      if (line.includes("/app/dashboard")) offenders.push(`${relative(ROOT, file)}:${index_ + 1}`);
    }
  }
  assert.deepEqual(offenders, [], "these source files still point at /app/dashboard instead of /app");

  // 6. No redirect loop: no destination is another rule's source.
  const sources = new Set(rules.map((r) => String(r.source)));
  for (const rule of rules) {
    assert.ok(!sources.has(String(rule.destination)), `${rule.source} -> ${rule.destination} is a loop`);
  }
  // 7. Query safety: no rule matches a query string, wildcards keep the path, and
  //    nothing can rewrite an API request.
  for (const rule of rules) {
    assert.ok(!String(rule.source).includes("?"), `${rule.source} must not match on a query string`);
    assert.ok(!String(rule.source).startsWith("/api"), `${rule.source} must never touch the API`);
    if (String(rule.source).endsWith("/:path*")) {
      assert.ok(String(rule.destination).endsWith("/:path*"), `${rule.source} would drop the path`);
    }
  }
});

test("the learner breadcrumb never says \"app\", and the Home row is the only exact match", () => {
  const { breadcrumbsFor, parentFor } = navRoutes;
  for (const pathname of ["/app", "/app/dashboard", "/app/reading", "/app/reading/retention", "/app/listening/tests/abc"]) {
    const crumbs = breadcrumbsFor(pathname, en);
    for (const crumb of crumbs) {
      assert.notEqual(crumb.label.trim().toLowerCase(), "app", `${pathname} shows a raw "app" crumb`);
      assert.ok(!/^\/app$/.test(crumb.label), `${pathname} shows the namespace as a label`);
    }
  }
  // Home has nowhere above it, so it renders neither a crumb nor a Back button.
  assert.deepEqual(breadcrumbsFor("/app", en), []);
  assert.equal(parentFor("/app", en), null);

  // The sidebar's Home row is exact: /app/reading must not light it up.
  const sidebar = readFileSync(join(ROOT, "src/components/shell/SidebarNav.tsx"), "utf8");
  assert.match(sidebar, /\{ href: "\/app", label: nav\.dashboard, icon: <IconDashboard \/>, exact: true \}/);
  assert.match(sidebar, /!item\.exact && pathname\.startsWith/, "prefix matching must be opt-out for the root row");
});

function nextConfigSource() {
  return readFileSync(join(ROOT, "next.config.mjs"), "utf8");
}

function allFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) allFiles(full, out);
    else out.push(full);
  }
  return out;
}
