import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { CurrentUser } from "../src/lib/auth/current-user";
import { handleRiwiTargetsGet } from "../src/lib/services/riwi/targets-http";

function user(role: CurrentUser["role"], id = "aaaaaaaa-0000-4000-8000-000000000001"): CurrentUser {
  return {
    id, name: `${role} target-page test`, email: null, role, accountStatus: "active", locale: "en",
    onboarded: true, statusReason: null,
  };
}

const allowed = { ok: true, remaining: 10, retryAfterSeconds: 0 } as const;
const limited = { ok: false, remaining: 0, retryAfterSeconds: 30 } as const;
const request = (query = "") => new NextRequest(`http://localhost/api/riwi/targets${query ? `?${query}` : ""}`);

test("target endpoint derives a fresh active actor for each bounded cursor page", async () => {
  const identities = [user("teacher"), user("admin")];
  const authenticatedRoles: string[] = [];
  const pageOptions: Array<{ role: string; cursor?: string | null; limit?: number }> = [];
  let authIndex = 0;
  const routeDependencies = {
    authenticate: async () => {
      const current = identities[authIndex++];
      assert.ok(current);
      authenticatedRoles.push(current.role);
      return current;
    },
    consumeIpLimit: () => allowed,
    consumeAccountLimit: () => allowed,
    getTargetPage: async (actor: { id: string; role: string; accountStatus: string }, options: { cursor?: string | null; limit?: number }) => {
      pageOptions.push({ role: actor.role, ...options });
      return { targetOptions: [{ id: "aaaaaaaa-0000-4000-8000-000000000010", name: actor.role }], nextCursor: actor.role === "teacher" ? "next-page" : null };
    },
  };

  const first = await handleRiwiTargetsGet(request("limit=25"), routeDependencies);
  const second = await handleRiwiTargetsGet(request("cursor=next-page&limit=25"), routeDependencies);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(authenticatedRoles, ["teacher", "admin"]);
  assert.deepEqual(pageOptions, [
    { role: "teacher", cursor: null, limit: 25 },
    { role: "admin", cursor: "next-page", limit: 25 },
  ], "a cursor does not freeze or supply the authorized role");
  assert.deepEqual(await first.json(), { ok: true, items: [{ id: "aaaaaaaa-0000-4000-8000-000000000010", name: "teacher" }], nextCursor: "next-page" });
  assert.equal(first.headers.get("cache-control"), "private, no-store");
  assert.equal(first.headers.get("vary"), "Cookie");
});

test("target endpoint rejects malformed and unbounded page parameters before querying", async () => {
  let pageCalls = 0;
  const dependencies = {
    authenticate: async () => user("admin"),
    consumeIpLimit: () => allowed,
    consumeAccountLimit: () => allowed,
    getTargetPage: async () => { pageCalls += 1; return { targetOptions: [], nextCursor: null }; },
  };
  for (const url of ["limit=0", "limit=101", "limit=1.5", "limit=1&limit=2", "cursor=x&cursor=y"]) {
    const response = await handleRiwiTargetsGet(request(url), dependencies);
    assert.equal(response.status, 400, url);
    assert.equal((await response.json() as { error: string }).error, "riwi_target_request_invalid");
  }
  assert.equal(pageCalls, 0);
});

test("target endpoint rate limits before data access and returns no-store retry metadata", async () => {
  let authCalls = 0;
  const response = await handleRiwiTargetsGet(request(), {
    authenticate: async () => { authCalls += 1; return user("admin"); },
    consumeIpLimit: () => limited,
    consumeAccountLimit: () => allowed,
    getTargetPage: async () => { throw new Error("must not query when IP limited"); },
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(authCalls, 0);
});

test("target endpoint blocks cross-origin reads before authentication or target queries", async () => {
  let authCalls = 0;
  const response = await handleRiwiTargetsGet(new NextRequest("http://localhost/api/riwi/targets", {
    headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  }), {
    authenticate: async () => { authCalls += 1; return user("admin"); },
    consumeIpLimit: () => allowed,
    consumeAccountLimit: () => allowed,
    getTargetPage: async () => { throw new Error("must not query for a cross-origin read"); },
  });
  assert.equal(response.status, 403);
  assert.equal(authCalls, 0);
});

test("target endpoint rejects unauthenticated users before querying a scope", async () => {
  let pageCalls = 0;
  const response = await handleRiwiTargetsGet(request(), {
    authenticate: async () => null,
    consumeIpLimit: () => allowed,
    consumeAccountLimit: () => allowed,
    getTargetPage: async () => { pageCalls += 1; return { targetOptions: [], nextCursor: null }; },
  });
  assert.equal(response.status, 401);
  assert.equal(pageCalls, 0);
});
