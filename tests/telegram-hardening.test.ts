import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveIntentPurpose, shouldConsume } from "../src/lib/telegram/intent-purpose";

const root = new URL("..", import.meta.url).pathname;

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("login, register and link are different server decisions", () => {
  assert.deepEqual(resolveIntentPurpose(undefined, false), { ok: true, purpose: "login", bindUser: false });
  assert.deepEqual(resolveIntentPurpose("login", true), { ok: true, purpose: "login", bindUser: false });
  assert.deepEqual(resolveIntentPurpose("register", false), { ok: true, purpose: "register", bindUser: false });
  assert.deepEqual(resolveIntentPurpose("register", true), { ok: false, error: "already_signed_in" });
  assert.deepEqual(resolveIntentPurpose("link", false), { ok: false, error: "sign_in_required" });
  assert.deepEqual(resolveIntentPurpose("link", true), { ok: true, purpose: "link", bindUser: true });
  assert.equal(resolveIntentPurpose("create-admin", false).ok, false);
});

test("an intent is consumed only after a terminal success", () => {
  assert.equal(shouldConsume("session"), true);
  assert.equal(shouldConsume("pending"), true);
  assert.equal(shouldConsume("no_linked_account"), false);
  assert.equal(shouldConsume("conflict"), false);
  assert.equal(shouldConsume("not_confirmed"), false);
});

test("exchange consumes only after the purpose succeeds", () => {
  const route = source("../src/app/api/auth/telegram/intent/exchange/route.ts");
  const prepareAt = route.indexOf("prepareIntentExchange");
  const consumeAt = route.indexOf("consumeConfirmedIntent");
  assert.ok(prepareAt >= 0 && consumeAt > prepareAt);
  assert.equal(route.includes("consumeIntent("), false);
  assert.equal(route.includes("insert(users)"), false);
});

test("login intent creation does not bind a signed-in user", () => {
  const intent = source("../src/lib/auth/telegram-intent.ts");
  assert.match(intent, /purpose === "link"/);
  assert.match(intent, /inArray\(telegramLoginIntents\.status, \["pending", "confirmed"\]\)/);
});

test("register and login pages ask for different purposes", () => {
  assert.match(source("../src/components/auth/LoginForm.tsx"), /purpose="login"/);
  assert.match(source("../src/components/auth/RegisterForm.tsx"), /purpose="register"/);
  const widget = source("../src/components/auth/TelegramIntentLogin.tsx");
  assert.match(widget, /\/api\/auth\/telegram\/intent\/cancel/);
  assert.match(widget, /body: \{ purpose \}/);
});

test("approved legacy widget retains signed payload verification", () => {
  const route = source("../src/app/api/auth/telegram/callback/route.ts");
  assert.match(route, /verifyTelegramPayload/);
  assert.match(route, /error=telegram/);
});

test("bot starts delivery only after webhook installation", () => {
  const bot = source("../services/telegram-bot/bot.py");
  const webhookAt = bot.indexOf("await _install_webhook");
  const workerAt = bot.indexOf("asyncio.create_task(_delivery_loop");
  assert.ok(webhookAt >= 0 && workerAt > webhookAt);
  assert.match(bot, /worker\.cancel\(\)/);
  assert.match(bot, /add_get\("\/health"/);
  assert.match(bot, /add_get\("\/ready"/);
});

test("sensitive dedup fails closed", () => {
  const middleware = source("../services/telegram-bot/middlewares/auth.py");
  assert.match(middleware, /fresh is None and sensitive/);
  assert.match(middleware, /backend_error = True/);
});

void root;


test("directory search includes Telegram-only contacts and normalizes @usernames", () => {
  const directory = source("../src/lib/telegram/directory.ts");
  assert.match(directory, /replace\(\/\^@\+\/, ""\)/);
  assert.match(directory, /isNull\(telegramContacts\.linkedUserId\)/);
  assert.match(directory, /entryType: "telegram_contact"/);
  assert.match(directory, /telegramContacts\.username/);
});
