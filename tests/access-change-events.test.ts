import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readAccessChangeUserId } from "../src/lib/auth/access-change-event";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const uuid = "00000000-0000-4000-8000-000000000001";

test("owner-triggered access event contains only a validated target user UUID", () => {
  assert.equal(readAccessChangeUserId(JSON.stringify({ userId: uuid })), uuid);
  for (const value of [undefined, "", "{", "[]", JSON.stringify({ userId: "not-a-uuid" }),
    JSON.stringify({ userId: uuid.slice(0, -1) }), JSON.stringify({ userId: "x".repeat(400) })]) {
    assert.equal(readAccessChangeUserId(value), null);
  }
});

test("the authority trigger invalidates every role/status writer and publishes only on transaction commit", () => {
  const publisher = read("src/lib/auth/publish-access-change.ts");
  const migration = read("drizzle/0060_auth_session_revocation.sql");
  assert.match(publisher, /if \(!accessEventsConnectionString\(\)\) return/);
  assert.match(publisher, /pg_notify\('la_access_changed'/);
  assert.match(migration, /BEFORE UPDATE OF role, account_status, auth_version/);
  assert.match(migration, /NEW\.auth_version := OLD\.auth_version \+ 1/);
  assert.match(migration, /pg_notify\('la_access_changed'/);
  assert.doesNotMatch(publisher, /setInterval|setTimeout|listen|subscription/i);
});

test("the client listens for access changes without interval polling or trusting pushed roles", () => {
  const client = read("src/components/interaction/AccessChangeListener.tsx");
  const layout = read("src/app/app/layout.tsx");
  assert.match(layout, /<AccessChangeListener enabled=.* role=\{user\.role\} expiresAt=\{authority\?\.expiresAt\}/);
  assert.match(client, /new EventSource\("\/api\/auth\/changes"/);
  assert.match(client, /addEventListener\("access-changed", update\)/);
  assert.match(client, /fetch\("\/api\/auth\/state", \{ cache: "no-store"/);
  assert.match(client, /router\.refresh\(\)/);
  assert.match(client, /let checkedThisDisconnect = false/);
  assert.match(client, /addEventListener\("error", failed\)/);
  assert.match(client, /privateResources\.setScope\(null\)/);
  assert.doesNotMatch(client, /setInterval|localStorage|sessionStorage/);
  assert.match(client, /scheduleExpiry/);
  assert.match(client, /addEventListener\("online", reconcile\)/);
});

test("SSE and one-shot state endpoint use verified server user identity", () => {
  const stream = read("src/app/api/auth/changes/route.ts");
  const state = read("src/app/api/auth/state/route.ts");
  const bus = read("src/lib/auth/access-change-bus.ts");
  assert.match(stream, /await getCurrentSessionAuthority\(\)/);
  assert.match(stream, /hasPrivateAccess\(user\.accountStatus\)/);
  assert.match(stream, /subscribeAccessChanges\(user\.id/);
  assert.match(stream, /Cache-Control": "private, no-store, no-transform"/);
  assert.match(state, /await getCurrentSessionAuthority\(\)/);
  assert.match(bus, /LISTEN la_access_changed/);
  assert.match(bus, /readAccessChangeUserId\(message\.payload\)/);
  assert.match(bus, /this\.listeners\.get\(userId\)/);
  assert.doesNotMatch(bus, /new Pool|db\.query\.users/);
  assert.match(stream, /setInterval\(\(\) => send\(": keep-alive/, "SSE heartbeat performs no identity lookup");
  assert.match(stream, /subscription\.ready\.then\(\(ok\) => \{[\s\S]*else \{[\s\S]*send\("event: access-changed/, "LISTEN setup cannot silently miss an earlier revocation");
});

test("privileged mutations still authorize against current database role", () => {
  const auth = read("src/lib/auth/current-user.ts");
  const role = read("src/app/api/admin/users/[id]/role/route.ts");
  const status = read("src/app/api/admin/users/[id]/status/route.ts");
  assert.match(auth, /validateSessionAuthority/);
  assert.match(read("src/lib/auth/session-authority.ts"), /client\.query\.users\.findFirst/);
  assert.match(role, /await requireAdministrator\(\)/);
  assert.match(status, /await requireAdministrator\(\)/);
  assert.match(read("src/app/app/layout.tsx"), /hasPrivateAccess\(user\.accountStatus\)/);
});

test("Railway reuses its existing session pooler credentials without a second secret", () => {
  const cfg = read("src/lib/auth/access-event-config.ts");
  assert.match(cfg, /process\.env\.AUTH_EVENTS_DATABASE_URL\?\.trim\(\)/);
  assert.match(cfg, /process\.env\.DATABASE_URL\?\.trim\(\)/);
  for (const path of ["src/app/app/layout.tsx", "src/app/api/auth/changes/route.ts",
    "src/lib/auth/access-change-bus.ts", "src/lib/auth/publish-access-change.ts"]) {
    assert.match(read(path), /accessEventsConnectionString\(\)/, path);
  }
});
