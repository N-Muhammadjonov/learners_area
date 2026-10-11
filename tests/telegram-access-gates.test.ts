import { test } from "node:test";
import { strict as assert } from "node:assert";
import { telegramApplicationGatesEnabled } from "../src/lib/telegram/access-gates";
import { actorCan } from "../src/lib/telegram/permissions";

test("Telegram application gates are OFF by default for old-bot compatibility", () => {
  const before = process.env.TELEGRAM_ACCESS_GATES_ENABLED;
  try {
    delete process.env.TELEGRAM_ACCESS_GATES_ENABLED;
    assert.equal(telegramApplicationGatesEnabled(), false);
    for (const input of ["", "0", "false", "yes", "enabled", " TRUEISH "]) {
      process.env.TELEGRAM_ACCESS_GATES_ENABLED = input;
      assert.equal(telegramApplicationGatesEnabled(), false, input);
    }
  } finally {
    if (before === undefined) delete process.env.TELEGRAM_ACCESS_GATES_ENABLED;
    else process.env.TELEGRAM_ACCESS_GATES_ENABLED = before;
  }
});

test("Telegram application gates enable only with an explicit 1 or true", () => {
  const before = process.env.TELEGRAM_ACCESS_GATES_ENABLED;
  try {
    for (const input of ["1", "true", "TRUE", " true ", " TrUe "]) {
      process.env.TELEGRAM_ACCESS_GATES_ENABLED = input;
      assert.equal(telegramApplicationGatesEnabled(), true, input);
    }
  } finally {
    if (before === undefined) delete process.env.TELEGRAM_ACCESS_GATES_ENABLED;
    else process.env.TELEGRAM_ACCESS_GATES_ENABLED = before;
  }
});

test("Primary owner is required for phone-number and bot-setting access", () => {
  const delegatedAdmin = {
    isPrimaryOwner: false,
    permissions: ["VIEW_USERS" as const, "MANAGE_USERS" as const],
  };
  const primaryOwner = {
    isPrimaryOwner: true,
    permissions: [] as const,
  };
  assert.equal(actorCan(delegatedAdmin, "BOT_SETTINGS"), false);
  assert.equal(actorCan(delegatedAdmin, "VIEW_USERS"), true);
  assert.equal(actorCan(primaryOwner, "BOT_SETTINGS"), true);
});
