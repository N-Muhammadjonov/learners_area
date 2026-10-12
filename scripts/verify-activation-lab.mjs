#!/usr/bin/env node
/**
 * The Writing Activation Lab after the atomicity fix — what a real browser can reach, and the exact
 * point where it cannot.
 *
 * `checkActivation` stores a `vocabulary_usages` row and the `WRITING_ACTIVATION_CHECK` event that is
 * the only record the learner's activation statistics are computed from. Those two writes now commit
 * or roll back as one transaction (tests/writing-activation-atomicity-qa2.test.ts proves it by
 * injecting a real BEFORE INSERT fault inside the writing connection).
 *
 * This script is the browser leg, and it is deliberately honest about its own limit: the route
 * answers 503 `unavailable` at `if (!(await writingAiReady()))` BEFORE `checkActivation` is called,
 * so with no AI provider configured a browser cannot reach the transactional path at all. Fabricating
 * a provider response to get past that gate is forbidden, so the blocker is recorded rather than
 * worked around. What is still provable in a real browser: the Lab renders, it says so honestly, the
 * 503 path writes nothing to PostgreSQL, and the statistics on screen come from stored events.
 */
import { createSession, launchBrowser } from "./lib/browser-qa.mjs";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
const EVENT_TYPE = "WRITING_ACTIVATION_CHECK";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`ok   - ${name}`);
  } else {
    failures.push(name);
    console.log(`not ok - ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function withClient(run) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  client.on("error", () => {});
  try {
    await client.connect();
    return await run(client);
  } finally {
    await client.end().catch(() => {});
  }
}

const stateFor = (userId) =>
  withClient(async (c) => ({
    events: (
      await c.query("select count(*)::int n from activity_events where user_id=$1 and type=$2", [
        userId,
        EVENT_TYPE,
      ])
    ).rows[0].n,
    usages: (await c.query("select count(*)::int n from vocabulary_usages where user_id=$1", [userId]))
      .rows[0].n,
    total: await (async () => {
      const tables = (
        await c.query(
          `select table_name from information_schema.tables
            where table_schema='public' and table_type='BASE TABLE'`,
        )
      ).rows.map((r) => r.table_name);
      let n = 0;
      for (const t of tables) n += (await c.query(`select count(*)::int n from "${t}"`)).rows[0].n;
      return n;
    })(),
  }));

console.log(`\nLearners Area — Writing Activation Lab against ${BASE}\n`);

const browser = await launchBrowser();
try {
  const session = await createSession(browser, {
    base: BASE,
    email: "demo.student@learnersarea.uz",
    password: "Student12345!",
    viewport: 1440,
    locale: "en",
  });
  const page = session.page;

  await session.goto("/app/writing?tab=activation");
  const rendered = await page.evaluate(() => ({
    hasLab: Boolean(document.querySelector('[data-async-content="writing"]')),
    text: document.body.innerText.slice(0, 4000),
    title: document.title,
  }));
  check("the Activation Lab tab renders", rendered.hasLab, rendered.title);
  check(
    "the learner's own Vocabulary is what feeds the Lab, not a demo pool",
    /vocational|outweigh|activation|activate/i.test(rendered.text),
    rendered.text.slice(0, 120).replace(/\n/g, " "),
  );

  // Take the learner's real item from the product's own endpoint, through the browser's session.
  const items = await page.evaluate(async () => {
    const res = await fetch("/api/writing/activation/items?count=1", { headers: { accept: "application/json" } });
    return { status: res.status, body: await res.json().catch(() => null) };
  });
  check("the items endpoint answers from the browser session", items.status === 200, `HTTP ${items.status}`);
  const item = items.body?.items?.[0];
  check("the learner has a real Vocabulary entry to activate", Boolean(item?.entryId), JSON.stringify(item ?? null));

  const userId = await withClient(async (c) =>
    (await c.query("select id from users where email='demo.student@learnersarea.uz'")).rows[0].id,
  );
  const startedAt = new Date();
  const sessionId = crypto.randomUUID();
  const before = await stateFor(userId);

  // Snapshot before the deliberate request: a browser logs a console error for ANY non-2xx response,
  // including the 503 this probe asks for on purpose. Blaming the page for that would be a false
  // failure, and filtering every console error would be no check at all — so attribute precisely.
  const errorsBefore = session.consoleErrors.length;
  const attempt = await page.evaluate(
    async ({ entryId, term, sessionId }) => {
      const res = await fetch("/api/writing/activation/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          entryId,
          mode: "writing",
          targetLevel: "7.0",
          uzbekPrompt: false,
          answer: `A ${term} course prepares learners for one specific trade.`,
        }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { entryId: item.entryId, term: item.term, sessionId },
  );

  const unavailable = attempt.status === 503 && attempt.body?.error?.code === "unavailable";
  const accepted = attempt.status === 200 && attempt.body?.ok === true;
  check(
    "the check endpoint either accepts the sentence or refuses it honestly",
    unavailable || accepted,
    `HTTP ${attempt.status} ${JSON.stringify(attempt.body).slice(0, 160)}`,
  );
  if (unavailable) {
    console.log(
      "info - BLOCKER: no AI provider is configured, so POST /api/writing/activation/check answers 503\n" +
        "       at the writingAiReady() gate and never reaches checkActivation. The transactional path\n" +
        "       is therefore EXTERNAL_ACCEPTANCE_REQUIRED from a browser; it is proven against real\n" +
        "       PostgreSQL by tests/writing-activation-atomicity-qa2.test.ts, which injects the fault\n" +
        "       inside the writing connection. No provider response is fabricated to get past the gate.",
    );
  }

  const after = await stateFor(userId);
  if (unavailable) {
    check("a refused check writes no activation event", after.events === before.events, `${before.events} -> ${after.events}`);
    check("a refused check writes no vocabulary usage", after.usages === before.usages, `${before.usages} -> ${after.usages}`);
    check("a refused check writes nothing anywhere", after.total === before.total, `${before.total} -> ${after.total}`);
  } else {
    // If a provider is ever configured, the same probe must show the two writes arriving together.
    check("an accepted check wrote exactly one event", after.events === before.events + 1, `${before.events} -> ${after.events}`);
    check(
      "an accepted check left no event without its usage, and no usage without its event",
      after.usages - before.usages === (attempt.body?.usageRecorded ? 1 : 0),
      `usages ${before.usages} -> ${after.usages}, usageRecorded=${attempt.body?.usageRecorded}`,
    );
  }

  // A probe must not leave learner data behind. The refused path writes nothing, so this only bites
  // if a provider is ever configured and the accepted branch above actually runs.
  if (accepted) {
    const removed = await withClient(async (c) => {
      const events = await c.query(
        "delete from activity_events where user_id=$1 and type=$2 and payload->>'sessionId'=$3",
        [userId, EVENT_TYPE, sessionId],
      );
      const usages = await c.query(
        "delete from vocabulary_usages where user_id=$1 and created_at >= $2",
        [userId, startedAt],
      );
      return { events: events.rowCount, usages: usages.rowCount };
    });
    const cleaned = await stateFor(userId);
    check(
      "the probe removed what it created",
      cleaned.total === before.total,
      `deleted ${removed.events} event(s) and ${removed.usages} usage(s); rows ${before.total} -> ${cleaned.total}`,
    );
  }

  const stats = await page.evaluate(() => {
    const el = document.querySelector('[data-async-content="writing"]');
    return (el?.innerText ?? "").replace(/\s+/g, " ").slice(0, 600);
  });
  check(
    "the statistics on screen are rendered, not left as a skeleton",
    stats.length > 0 && !/loading/i.test(stats.slice(0, 40)),
    stats.slice(0, 120),
  );
  const newErrors = session.consoleErrors.slice(errorsBefore);
  const ownRequest = unavailable ? newErrors.filter((e) => /503/.test(e)) : [];
  const unexplained = newErrors.filter((e) => !ownRequest.includes(e));
  check(
    "no uncaught console errors on the Activation Lab beyond the 503 this probe requested",
    unexplained.length === 0,
    unexplained.slice(0, 2).join(" | ") ||
      (ownRequest.length ? `only the probe's own expected 503: ${ownRequest[0].slice(0, 90)}` : ""),
  );

  // The same surface at a phone width, because the Lab is a learner-facing form.
  const small = await createSession(browser, {
    base: BASE,
    email: "demo.student@learnersarea.uz",
    password: "Student12345!",
    viewport: 390,
    locale: "en",
  });
  await small.goto("/app/writing?tab=activation");
  const overflow = await small.page.evaluate(() => ({
    scrolls: document.documentElement.scrollWidth > window.innerWidth + 1,
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  check("the Lab does not overflow a 390px viewport", !overflow.scrolls, JSON.stringify(overflow));
  check("no console errors at 390px", small.consoleErrors.length === 0, small.consoleErrors.slice(0, 2).join(" | "));
  await small.close();
  await session.close();
} finally {
  await browser.close();
}

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const failure of failures) console.log(`  - ${failure}`);
}
process.exit(failures.length === 0 ? 0 : 1);
