import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  canInitiateWebsiteTransfer,
  canStartBotHandover,
  decideHandover,
  decideWebsiteChallenge,
  liveOwnerCommitAllowed,
  opaqueCallback,
  websiteTransferNotice,
} from "../src/lib/auth/owner-challenge";
import { readStoredOwnerId, resolveEffectivePrimaryOwner, sameTelegramOwner } from "../src/lib/telegram/owner-authority";

const NOW = 1_700_000_000_000;
const LATER = NOW + 60_000;
const UUID = "11111111-1111-4111-8111-111111111111";

function errorOf(result: object): string | undefined {
  if (!("error" in result)) return undefined;
  const error = (result as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

const baseInitiate = {
  actorRole: "owner",
  actorActive: true,
  hasPassword: true,
  passwordOk: true,
  actorTelegramId: "100",
  actorReachable: true,
  actorId: "actor",
  targetFound: true,
  targetId: "target",
  targetStatus: "active",
  includeBotHandover: false,
  actorIsBotOwner: false,
  targetTelegramId: "200",
  targetKnown: true,
};

test("an admin cannot start a website ownership transfer", () => {
  assert.equal(canInitiateWebsiteTransfer({ ...baseInitiate, actorRole: "admin" }).ok, false);
  assert.equal(canInitiateWebsiteTransfer({ ...baseInitiate, actorActive: false }).ok, false);
});

test("a wrong password does not start a transfer", () => {
  const result = canInitiateWebsiteTransfer({ ...baseInitiate, passwordOk: false });
  assert.deepEqual(result, { ok: false, error: "invalid_credentials" });
});

test("password alone is blocked when Telegram is not linked or the bot cannot reach the owner", () => {
  const missing = canInitiateWebsiteTransfer({ ...baseInitiate, actorTelegramId: null });
  assert.equal(missing.ok, false);
  assert.equal(errorOf(missing), "telegram_not_linked");
  assert.equal(errorOf(canInitiateWebsiteTransfer({ ...baseInitiate, actorReachable: false })), "telegram_bot_not_started");
});

test("a suspended target cannot receive ownership", () => {
  assert.equal(errorOf(canInitiateWebsiteTransfer({ ...baseInitiate, targetStatus: "suspended" })), "target_not_active");
  assert.equal(
    errorOf(canInitiateWebsiteTransfer({ ...baseInitiate, targetFound: false, targetId: null })),
    "target_not_found"
  );
});

test("optional bot handover is refused unless the actor is the bot owner and the target is known", () => {
  const opted = { ...baseInitiate, includeBotHandover: true, actorIsBotOwner: false };
  assert.equal(errorOf(canInitiateWebsiteTransfer(opted)), "bot_owner_mismatch");
  assert.equal(
    errorOf(canInitiateWebsiteTransfer({ ...opted, actorIsBotOwner: true, targetTelegramId: null })),
    "target_telegram_missing"
  );
  assert.equal(
    errorOf(canInitiateWebsiteTransfer({ ...opted, actorIsBotOwner: true, targetKnown: false })),
    "target_telegram_missing"
  );
});

test("the wrong Telegram user cannot approve, reject, or replay a website challenge", () => {
  const pending = {
    status: "pending" as const,
    purpose: "website_owner_transfer",
    expiresAtMs: LATER,
    boundTelegramId: "100",
    actorTelegramId: "999",
    decision: "approve" as const,
    nowMs: NOW,
  };
  assert.equal(errorOf(decideWebsiteChallenge(pending)), "wrong_actor");
  assert.equal(decideWebsiteChallenge({ ...pending, actorTelegramId: "100", decision: "reject" }).action, "reject");
  assert.equal(decideWebsiteChallenge({ ...pending, actorTelegramId: "100" }).action, "commit");
  assert.equal(errorOf(decideWebsiteChallenge({ ...pending, actorTelegramId: "100", nowMs: LATER })), "expired");
  assert.equal(errorOf(decideWebsiteChallenge({ ...pending, actorTelegramId: "100", status: "rejected" })), "rejected");
  assert.equal(errorOf(decideWebsiteChallenge({ ...pending, actorTelegramId: "100", status: "cancelled" })), "cancelled");
  assert.equal(decideWebsiteChallenge({ ...pending, actorTelegramId: "100", status: "consumed" }).action, "already");
  assert.equal(
    errorOf(decideWebsiteChallenge({ ...pending, actorTelegramId: "100", status: "consumed", decision: "reject" })),
    "replay"
  );
});

test("bot handover needs both parties, in order, and a username is not an id", () => {
  assert.equal(
    errorOf(canStartBotHandover({
      actorIsPrimaryOwner: false,
      actorTelegramId: "100",
      targetTelegramId: "200",
      targetKnown: true,
    })),
    "forbidden"
  );
  assert.equal(
    errorOf(canStartBotHandover({
      actorIsPrimaryOwner: true,
      actorTelegramId: "100",
      targetTelegramId: "@owner",
      targetKnown: true,
    })),
    "invalid_actor"
  );
  assert.equal(
    errorOf(canStartBotHandover({
      actorIsPrimaryOwner: true,
      actorTelegramId: "100",
      targetTelegramId: "200",
      targetKnown: false,
    })),
    "target_unknown"
  );

  const pending = {
    status: "pending" as const,
    expiresAtMs: LATER,
    fromTelegramId: "100",
    toTelegramId: "200",
    actorTelegramId: "100",
    step: "target_accept" as const,
    nowMs: NOW,
  };
  assert.equal(errorOf(decideHandover(pending)), "wrong_actor");
  assert.equal(decideHandover({ ...pending, step: "current_confirm" }).action, "confirm_current");
  assert.equal(errorOf(decideHandover({ ...pending, actorTelegramId: "200", step: "current_confirm" })), "wrong_actor");
  assert.equal(decideHandover({ ...pending, status: "current_confirmed", actorTelegramId: "200" }).action, "commit");
  assert.equal(errorOf(decideHandover({ ...pending, actorTelegramId: "200", step: "target_accept" })), "not_ready");
  assert.equal(
    errorOf(decideHandover({ ...pending, status: "current_confirmed", actorTelegramId: "200", nowMs: LATER })),
    "expired"
  );
  assert.equal(decideHandover({ ...pending, status: "current_confirmed", actorTelegramId: "200", step: "reject" }).action, "reject");
  assert.equal(errorOf(decideHandover({ ...pending, status: "cancelled", actorTelegramId: "100", step: "reject" })), "cancelled");
  assert.equal(decideHandover({ ...pending, status: "consumed", actorTelegramId: "200" }).action, "already");
  assert.equal(
    errorOf(decideHandover({ ...pending, status: "consumed", actorTelegramId: "100", step: "current_confirm" })),
    "replay"
  );
  assert.equal(errorOf(decideHandover({ ...pending, actorTelegramId: "300", step: "reject" })), "wrong_actor");
});

test("the website still has exactly one live owner, or the commit is refused", () => {
  assert.equal(liveOwnerCommitAllowed(1), true);
  assert.equal(liveOwnerCommitAllowed(0), false);
  assert.equal(liveOwnerCommitAllowed(2), false);
});

test("a stored handover wins over a later env change, and a username is never an owner", () => {
  assert.deepEqual(
    resolveEffectivePrimaryOwner({ storedValue: { telegramUserId: "200" }, envTelegramId: "100" }),
    { id: "200", source: "database" }
  );
  assert.deepEqual(
    resolveEffectivePrimaryOwner({ storedValue: null, envTelegramId: "100" }),
    { id: "100", source: "bootstrap" }
  );
  assert.deepEqual(
    resolveEffectivePrimaryOwner({ storedValue: { username: "owner" }, envTelegramId: "@owner" }),
    { id: null, source: "none" }
  );
  assert.equal(readStoredOwnerId("@owner"), null);
  assert.equal(sameTelegramOwner("100", "100"), true);
  assert.equal(sameTelegramOwner("@owner", "100"), false);
});

test("callbacks carry only an opaque id and notices do not contain a password", () => {
  assert.equal(opaqueCallback("wta", UUID), `wta:${UUID}`);
  assert.equal(opaqueCallback("password", UUID), null);
  assert.equal(opaqueCallback("wta", "not-a-uuid"), null);
  assert.equal(opaqueCallback("wta", `${UUID}:secret`), null);
  const notice = websiteTransferNotice({
    targetName: "Ada",
    targetEmail: "ada@example.com",
    keepRole: "admin",
    includeBotHandover: true,
  });
  assert.equal(JSON.stringify(notice).toLowerCase().includes("password"), false);
  assert.match(notice.body, /BotFather ownership is not changed/);
});

test("owner authority is database-first and the password route does not commit", () => {
  const route = readFileSync("src/app/api/owner/transfer/route.ts", "utf8");
  const commit = readFileSync("src/lib/auth/owner-transfer.ts", "utf8");
  const handover = readFileSync("src/lib/telegram/owner-handover.ts", "utf8");
  const store = readFileSync("src/lib/telegram/owner-store.ts", "utf8");
  const actor = readFileSync("src/lib/telegram/actor.ts", "utf8");
  const admins = readFileSync("src/lib/telegram/admins.ts", "utf8");
  const directory = readFileSync("src/lib/telegram/directory.ts", "utf8");
  const support = readFileSync("src/lib/telegram/support.ts", "utf8");
  const ops = readFileSync("src/lib/telegram/ops.ts", "utf8");
  const schema = readFileSync("drizzle/0022_telegram_owner_authority.sql", "utf8");

  assert.match(route, /verifyPassword/);
  assert.doesNotMatch(route, /initiateWebsiteTransfer\([\s\S]*password:/);
  assert.match(commit, /ownership\.transferred/);
  assert.match(commit, /ownership\.transfer_rejected/);
  assert.match(commit, /for\("update"\)/);
  assert.match(commit, /eq\(ownershipTransferChallenges\.status, "pending"\)/);
  assert.match(commit, /liveOwnerCommitAllowed/);
  assert.match(handover, /lockOwnerAuthority/);
  assert.match(handover, /telegram\.owner_transferred/);
  assert.match(handover, /writePrimaryOwner/);
  assert.match(store, /pg_advisory_xact_lock/);
  assert.doesNotMatch(store, /function writePrimaryOwner[\s\S]*TELEGRAM_OWNER_ID/);
  assert.doesNotMatch(actor, /isPrimaryOwnerTelegramId\(/);
  assert.doesNotMatch(admins, /isPrimaryOwnerTelegramId\(/);
  assert.doesNotMatch(directory, /isPrimaryOwnerTelegramId\(/);
  assert.doesNotMatch(support, /primaryOwnerTelegramId\(/);
  assert.match(directory, /role === "owner"/);
  assert.match(ops, /SETTING_KEYS = \["default_locale", "support_enabled", "broadcasts_enabled"\]/);
  assert.match(schema, /browser_nonce_hash/);
  assert.doesNotMatch(schema, /browser_nonce[^_]/);
  assert.doesNotMatch(commit, /callback_data/);
});
