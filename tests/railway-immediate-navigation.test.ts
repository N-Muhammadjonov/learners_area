import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("all authenticated shell routes show a private, localized destination frame immediately", () => {
  const layout = read("src/app/app/(shell)/layout.tsx");
  const outlet = read("src/components/interaction/InstantWorkspaceOutlet.tsx");
  assert.match(layout, /<InstantWorkspaceOutlet>\{children\}<\/InstantWorkspaceOutlet>/);
  assert.match(outlet, /hidden=\{pending \|\| undefined\} data-outgoing-workspace/,
    "the old page becomes hidden on the first navigation render, not after a timeout");
  assert.match(outlet, /data-workspace-content inert=\{pending \|\| undefined\}>\{children\}/,
    "the outgoing workspace remains mounted but is not interactive");
  assert.match(outlet, /<SectionEntryFrame routeKey=\{navigation\.routeKey\} frame=\{frame\} privateBoundary \/>/,
    "a data-free route skeleton renders without awaiting any DB result");
  assert.doesNotMatch(outlet, /setTimeout|setVisibleId|localStorage|sessionStorage/,
    "navigation acknowledgement must not wait 120 ms or cache private page data");
  assert.match(outlet, /stalled && \(/,
    "a genuinely stalled destination still offers a retry");
});

test("the production session and privileged access gates are not relaxed for speed", () => {
  const auth = read("src/lib/auth/current-user.ts");
  const app = read("src/app/app/layout.tsx");
  const middleware = read("src/middleware.ts");
  assert.match(app, /hasPrivateAccess\(user\.accountStatus\)/);
  assert.match(auth, /db\.query\.users\.findFirst/);
  assert.match(auth, /requireAdministrator/);
  assert.match(auth, /requireOwner/);
  assert.match(middleware, /jwtVerify\(/);
});
