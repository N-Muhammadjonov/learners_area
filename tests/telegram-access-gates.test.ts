import { test } from "node:test";
import { strict as assert } from "node:assert";
import { telegramApplicationGatesEnabled } from "../src/lib/telegram/access-gates";

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
