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

test("actual owner/admin actions publish one event AFTER committed role or admission change", () => {
  const publisher = read("src/lib/auth/publish-access-change.ts");
  const role = read("src/app/api/admin/users/[id]/role/route.ts");
  const admission = read("src/lib/data/admission.ts");
  const transfer = read("src/lib/auth/owner-transfer.ts");
  assert.match(publisher, /if \(!accessEventsConnectionString\(\)\) return/);
  assert.match(publisher, /pg_notify\('la_access_changed'/);
  assert.match(role, /if \(target\.role !== nextRole\) await publishAccessChange\(id\)/);
  assert.match(admission, /await publishAccessChange\(input\.userId\)/);
  assert.match(admission, /await publishAccessChange\(request\.userId\)/);
  assert.match(transfer, /await publishAccessChanges\(\[result\.fromUserId, result\.toUserId\]\)/);
  assert.doesNotMatch(publisher, /setInterval|setTimeout|listen|subscription/i);
});

test("the client listens for access changes without interval polling or trusting pushed roles", () => {
  const client = read("src/components/interaction/AccessChangeListener.tsx");
  const layout = read("src/app/app/layout.tsx");
  assert.match(layout, /<AccessChangeListener enabled=\{Boolean\(accessEventsConnectionString\(\)\)\} \/>/);
  assert.match(client, /new EventSource\("\/api\/auth\/changes"/);
  assert.match(client, /addEventListener\("access-changed", update\)/);
  assert.match(client, /fetch\("\/api\/auth\/state", \{ cache: "no-store"/);
  assert.match(client, /router\.refresh\(\)/);
  assert.match(client, /let checkedThisDisconnect = false/);
  assert.match(client, /addEventListener\("error", failed\)/);
  assert.match(client, /privateResources\.setScope\(null\)/);
  assert.doesNotMatch(client, /setInterval|setTimeout|localStorage|sessionStorage/);
});

test("SSE and one-shot state endpoint use verified server user identity", () => {
  const stream = read("src/app/api/auth/changes/route.ts");
  const state = read("src/app/api/auth/state/route.ts");
  const bus = read("src/lib/auth/access-change-bus.ts");
  assert.match(stream, /const user = await requireActiveUser\(\)/);
  assert.match(stream, /subscribeAccessChanges\(user\.id/);
  assert.match(stream, /Cache-Control": "private, no-store, no-transform"/);
  assert.match(state, /const user = await getCurrentUser\(\)/);
  assert.match(bus, /LISTEN la_access_changed/);
  assert.match(bus, /readAccessChangeUserId\(message\.payload\)/);
  assert.match(bus, /this\.listeners\.get\(userId\)/);
  assert.doesNotMatch(bus, /new Pool|db\.query\.users/);
  assert.match(stream, /setInterval\(\(\) => send\(": keep-alive/, "SSE heartbeat performs no identity lookup");
});

test("privileged mutations still authorize against current database role", () => {
  const auth = read("src/lib/auth/current-user.ts");
  const role = read("src/app/api/admin/users/[id]/role/route.ts");
  const status = read("src/app/api/admin/users/[id]/status/route.ts");
  assert.match(auth, /db\.query\.users\.findFirst/);
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
