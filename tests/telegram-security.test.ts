import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import {
  actorCan,
  canEditBotAdmin,
  sanitizeGrantablePermissions,
} from "../src/lib/telegram/permissions";
import { isPrimaryOwnerTelegramId, isTelegramUserId, normalizeTelegramUserId } from "../src/lib/telegram/ids";
import { serviceSecretsMatch } from "../src/lib/auth/internal-service";
import { isBroadcastAudience } from "../src/lib/telegram/audiences";

const ROOT = new URL("..", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

test("telegram ids are numeric strings, never usernames", () => {
  assert.equal(isTelegramUserId("123456789"), true);
  assert.equal(isTelegramUserId("@owner"), false);
  assert.equal(isTelegramUserId("12 34"), false);
  assert.equal(isTelegramUserId(""), false);
  assert.equal(normalizeTelegramUserId(42), "42");
  assert.equal(normalizeTelegramUserId("007"), "007");
});

test("primary owner is the configured numeric id only", () => {
  const env = { TELEGRAM_OWNER_ID: "9001" } as unknown as NodeJS.ProcessEnv;
  assert.equal(isPrimaryOwnerTelegramId("9001", env), true);
  assert.equal(isPrimaryOwnerTelegramId("9002", env), false);
  assert.equal(isPrimaryOwnerTelegramId("@owner", env), false);
  assert.equal(isPrimaryOwnerTelegramId("9001", { TELEGRAM_OWNER_ID: "not-a-number" } as unknown as NodeJS.ProcessEnv), false);
});

test("website role is not a bot permission, and owner-only powers cannot be granted", () => {
  const studentAdmin = { isPrimaryOwner: false, permissions: ["ADMISSIONS"] as const };
  assert.equal(actorCan(studentAdmin, "ADMISSIONS"), true);
  assert.equal(actorCan(studentAdmin, "BROADCAST"), false);
  assert.equal(actorCan(studentAdmin, "MANAGE_BOT_ADMINS"), false);
  assert.equal(actorCan(studentAdmin, "DANGEROUS_USER_DELETE"), false);
  assert.equal(actorCan({ isPrimaryOwner: true, permissions: [] }, "BOT_SETTINGS"), true);
  assert.equal(canEditBotAdmin(studentAdmin), false);
  assert.deepEqual(sanitizeGrantablePermissions(["SUPPORT", "MANAGE_BOT_ADMINS", "nope", "SUPPORT"]), ["SUPPORT"]);
});

test("service secret comparison does not use raw equality and rejects a mismatch", () => {
  assert.equal(serviceSecretsMatch("correct-horse", "correct-horse"), true);
  assert.equal(serviceSecretsMatch("correct-horse", "correct-horses"), false);
  assert.equal(serviceSecretsMatch("", "correct-horse"), false);
});

test("login intent tokens have at least 128 bits and are not the stored hash", () => {
  const token = randomBytes(32).toString("hex");
  assert.ok(token.length >= 32);
  assert.equal(createHash("sha256").update(token).digest("hex").length, 64);
  assert.notEqual(token, createHash("sha256").update(token).digest("hex"));
});

test("broadcast audiences are the real centre segments only", () => {
  assert.equal(isBroadcastAudience("all_bot_users"), true);
  assert.equal(isBroadcastAudience("active_students"), true);
  assert.equal(isBroadcastAudience("everyone_on_earth"), false);
});

test("every internal telegram route authenticates the service before acting", () => {
  const routes = walk(join(ROOT, "src/app/api/internal/telegram")).map((file) => relative(ROOT, file));
  assert.ok(routes.length > 5);
  for (const route of routes) {
    const source = readFileSync(join(ROOT, route), "utf8");
    assert.match(source, /verifyInternalBotRequest/, `${route} must check the service secret`);
    assert.doesNotMatch(source, /\bgetSession\s*\(/, `${route} must not authorize from the session cookie`);
  }
});

test("the website login no longer mounts the legacy Telegram widget", () => {
  for (const file of ["src/components/auth/LoginForm.tsx", "src/components/auth/RegisterForm.tsx"]) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /telegram-widget\.js/);
    assert.doesNotMatch(source, /TelegramButton/);
    assert.match(source, /TelegramIntentLogin/);
  }
  const callback = readFileSync(join(ROOT, "src/app/api/auth/telegram/callback/route.ts"), "utf8");
  assert.doesNotMatch(callback, /\.insert\(users\)/);
});

test("sensitive internal routes name an actor permission, not a website role check", () => {
  const sensitive = [
    "src/app/api/internal/telegram/admission/decide/route.ts",
    "src/app/api/internal/telegram/admission/pending/route.ts",
    "src/app/api/internal/telegram/admins/route.ts",
    "src/app/api/internal/telegram/broadcasts/route.ts",
    "src/app/api/internal/telegram/directory/route.ts",
    "src/app/api/internal/telegram/directory/[userId]/delete/route.ts",
  ];
  for (const route of sensitive) {
    const source = readFileSync(join(ROOT, route), "utf8");
    assert.match(source, /requireBotPermission/, `${route} must resolve the bot actor`);
    assert.doesNotMatch(source, /role !== "admin"/, `${route} must not treat website admin as bot admin`);
  }
});
