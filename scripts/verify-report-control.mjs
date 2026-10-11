#!/usr/bin/env node
/**
 * The shell's report control, proven reachable and functional — not merely present in source.
 *
 * `verify-theme.mjs` asserts that the initial server HTML of /app contains `data-report-toggle`.
 * The product deliberately keeps that control inside the shell's collapsible utilities panel
 * (one launcher opening Focus mode, the Coach link and Report a problem), so it is not in first
 * paint. Whether it should be is a visual-design decision for the owner; what is *not* a matter of
 * opinion is whether a learner on a small screen can actually reach the control and file a report.
 *
 * This script answers that in a real browser at 320px, all the way to PostgreSQL, and it replaces
 * an inference with a measurement: `verify-theme.mjs` passes on a source-text scan
 * (`/ReportProblem/.test(shellUtilities)`), which cannot see render conditions at all — it would
 * still pass if the control were never mounted.
 *
 * Leaves the database exactly as it found it: the one row it files is deleted by marker.
 */
import { createSession, launchBrowser } from "./lib/browser-qa.mjs";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
const MARKER = `QAPROBE-REPORT-REACHABILITY-${Date.now()}`;

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

const countReports = () =>
  withClient((c) => c.query("select count(*)::int as n from problem_reports")).then((r) => r.rows[0].n);

/**
 * Every row in every base table, so "cleaned up" can mean the database is unchanged rather than
 * "the one row I remembered to delete is gone".
 *
 * This probe originally deleted its problem_reports row and asserted the delete count matched. That
 * check passed while the run still left a row behind: filing a report also writes an audit_log entry
 * (`action = support.reported`), which nothing removed. A cleanup assertion scoped to the table the
 * probe happens to know about cannot see that, so the scope has to be the whole database.
 */
const totalRows = () =>
  withClient(async (c) => {
    const tables = (
      await c.query(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
      )
    ).rows.map((r) => r.table_name);
    let total = 0;
    for (const table of tables) {
      total += (await c.query(`select count(*)::int as n from "${table}"`)).rows[0].n;
    }
    return { total, tables: tables.length };
  });

console.log(`\nLearners Area — report control reachability against ${BASE} at 320px\n`);

const browser = await launchBrowser();
let filed = 0;
const rowsBefore = await totalRows();
console.log(
  `info - database before the probe: ${rowsBefore.total} rows across ${rowsBefore.tables} base tables`,
);
try {
  const session = await createSession(browser, {
    base: BASE,
    email: "demo.student@learnersarea.uz",
    password: "Student12345!",
    viewport: 320,
    locale: "en",
  });
  const page = session.page;

  await session.goto("/app");
  await page.waitForSelector("[data-utilities-launcher]", { timeout: 20000 }).catch(() => {});

  check(
    "the utilities launcher is present in the shell at 320px",
    (await page.$("[data-utilities-launcher]")) !== null,
  );
  // Recorded, not asserted as a defect: the control is behind the launcher by design, which is why
  // verify-theme's first-paint assertion fails. The capability is what this script proves.
  const inFirstPaint = (await page.$("[data-report-toggle]")) !== null;
  console.log(
    `info - report control in first paint: ${inFirstPaint} (verify-theme.mjs requires true)`,
  );

  await page.click("[data-utilities-launcher]");
  await page.waitForSelector("[data-report-toggle]", { timeout: 8000 }).catch(() => {});
  check(
    "opening the utilities panel reveals the report control",
    (await page.$("[data-report-toggle]")) !== null,
  );

  const geometry = await page.evaluate(() => {
    const button = document.querySelector("[data-report-toggle]");
    if (!button) return null;
    const box = button.getBoundingClientRect();
    return {
      visible: box.width > 0 && box.height > 0,
      width: Math.round(box.width),
      height: Math.round(box.height),
      withinViewport: box.right <= window.innerWidth + 1 && box.left >= -1,
      expanded: button.getAttribute("aria-expanded"),
      name: (button.getAttribute("aria-label") || button.textContent || "").trim().slice(0, 60),
    };
  });
  check(
    "the report control is visible and fits inside the 320px viewport",
    Boolean(geometry?.visible && geometry.withinViewport && geometry.width > 0),
    JSON.stringify(geometry),
  );
  // WCAG 2.5.8 target size floor.
  check(
    "the report control meets the 44px touch-target floor",
    Boolean(geometry && geometry.height >= 44 && geometry.width >= 24),
    `${geometry?.width}x${geometry?.height}`,
  );
  check(
    "the report control exposes its expanded state and an accessible name",
    geometry?.expanded === "false" && Boolean(geometry?.name),
    `aria-expanded=${geometry?.expanded} name="${geometry?.name}"`,
  );

  await page.click("[data-report-toggle]");
  await page.waitForSelector("[data-report-form]", { timeout: 8000 }).catch(() => {});
  check("the report form opens", (await page.$("[data-report-form]")) !== null);

  const form = await page.evaluate(() => {
    const panel = document.querySelector("[data-report-form]");
    if (!panel) return null;
    const textarea = panel.querySelector("textarea");
    const label = textarea
      ? (document.querySelector(`label[for="${textarea.id}"]`)?.textContent || "").trim()
      : "";
    return {
      textareas: panel.querySelectorAll("textarea").length,
      buttons: panel.querySelectorAll("button").length,
      labelled: Boolean(textarea && (textarea.getAttribute("aria-label") || label)),
    };
  });
  check(
    "the report form offers a message field and a submit control",
    Boolean(form && form.textareas >= 1 && form.buttons >= 1),
    JSON.stringify(form),
  );
  check("the message field has an accessible name", Boolean(form?.labelled), JSON.stringify(form));

  const before = await countReports();
  await page.type(
    "[data-report-form] textarea",
    `${MARKER} — verifying the report control is reachable and functional at 320px.`,
  );
  const [response] = await Promise.all([
    page
      .waitForResponse((res) => res.url().includes("/api/support/reports"), { timeout: 20000 })
      .catch(() => null),
    page.evaluate(() => {
      const panel = document.querySelector("[data-report-form]");
      const buttons = [...panel.querySelectorAll("button")];
      const submit =
        buttons.find((b) => b.type === "submit") ||
        buttons.find((b) => /send|submit|report/i.test(b.textContent || ""));
      submit?.click();
    }),
  ]);
  check("submitting the report calls the reports API", response !== null);
  check(
    "the reports API accepts the submission",
    Boolean(response && response.status() >= 200 && response.status() < 300),
    `status=${response?.status()}`,
  );

  const after = await countReports();
  filed = after - before;
  check("the report reached PostgreSQL", filed === 1, `${before} -> ${after}`);

  const stored = await (async () => {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    client.on("error", () => {});
    try {
      await client.connect();
      const rows = (
        await client.query(
          "select route, module, viewport from problem_reports where message like $1",
          [`${MARKER}%`],
        )
      ).rows;
      return rows[0] ?? null;
    } finally {
      await client.end().catch(() => {});
    }
  })();
  check(
    "the stored report records the route and the viewport it was filed from",
    Boolean(stored?.route === "/app") &&
      // The product formats this as "320×720" (U+00D7). Assert the dimensions, not the glyph.
      /^(\d+)\s*[×x]\s*(\d+)$/.test(stored?.viewport ?? "") &&
      Number(/^(\d+)/.exec(stored?.viewport ?? "")?.[1]) === 320,
    JSON.stringify(stored),
  );

  check("no uncaught console errors while using the control", session.consoleErrors.length === 0,
    session.consoleErrors.slice(0, 2).join(" | "));

  const englishName = geometry?.name ?? "";
  const englishField = await page.evaluate(
    () => document.querySelector("[data-report-message]")?.getAttribute("aria-label") ?? "",
  );
  await session.close();

  // §9 requires the *rendered* translation, not the presence of a dictionary key. A lookup that
  // silently failed would render an empty name, so compare the two locales against each other.
  const uz = await createSession(browser, {
    base: BASE,
    email: "demo.student@learnersarea.uz",
    password: "Student12345!",
    viewport: 320,
    locale: "uz",
  });
  await uz.goto("/app");
  await uz.page.waitForSelector("[data-utilities-launcher]", { timeout: 20000 }).catch(() => {});
  await uz.page.click("[data-utilities-launcher]");
  await uz.page.waitForSelector("[data-report-toggle]", { timeout: 8000 }).catch(() => {});
  await uz.page.click("[data-report-toggle]");
  await uz.page.waitForSelector("[data-report-message]", { timeout: 8000 }).catch(() => {});
  const uzNames = await uz.page.evaluate(() => {
    const toggle = document.querySelector("[data-report-toggle]");
    const field = document.querySelector("[data-report-message]");
    return {
      toggle: (toggle?.getAttribute("aria-label") || toggle?.textContent || "").trim(),
      field: field?.getAttribute("aria-label") ?? "",
      placeholder: field?.getAttribute("placeholder") ?? "",
    };
  });
  check(
    "the report control renders its Uzbek accessible name",
    Boolean(uzNames.toggle) && uzNames.toggle !== englishName && !/report a problem/i.test(uzNames.toggle),
    `uz="${uzNames.toggle}" en="${englishName}"`,
  );
  check(
    "the message field renders its Uzbek accessible name",
    Boolean(uzNames.field) && uzNames.field !== englishField && !/what happened/i.test(uzNames.field),
    `uz="${uzNames.field}" en="${englishField}"`,
  );
  check(
    "the Uzbek field name is a real sentence, not a dictionary key",
    !/^[a-z][a-z0-9_.]*$/i.test(uzNames.field.replace(/\s+/g, " ")) &&
      !/support\.|dict\./.test(uzNames.field),
    uzNames.field,
  );
  await uz.close();
} finally {
  // Leave the database as it was. Filing a report writes more than the report: it also writes an
  // audit_log entry, so the audit rows are removed first (children before parents) and the proof
  // that the probe is clean is the whole-database row total, not a delete count from one table.
  try {
    const removed = await withClient(async (c) => {
      const reports = (
        await c.query("select id from problem_reports where message like $1", [`${MARKER}%`])
      ).rows.map((r) => r.id);
      const audit = reports.length
        ? await c.query(
            // Cast the column, not the parameter: target_id is a uuid and `uuid = text` has no operator.
            `delete from audit_log
              where target_type = 'problem_report' and target_id::text = any($1::text[])`,
            [reports],
          )
        : { rowCount: 0 };
      const reports_deleted = await c.query("delete from problem_reports where message like $1", [
        `${MARKER}%`,
      ]);
      return { ids: reports.length, audit: audit.rowCount, reports: reports_deleted.rowCount };
    });
    check(
      "the probe removed the report it filed",
      removed.reports === Math.max(filed, 0),
      `filed ${filed}, deleted ${removed.reports}`,
    );
    check(
      "the probe removed the audit trail that filing the report wrote",
      removed.audit === removed.ids,
      `${removed.ids} report(s), ${removed.audit} audit_log row(s)`,
    );
    const rowsAfter = await totalRows();
    check(
      "the database is back to the row count the probe started from",
      rowsAfter.total === rowsBefore.total,
      `${rowsBefore.total} -> ${rowsAfter.total} rows across ${rowsAfter.tables} base tables`,
    );
  } catch (error) {
    check("the probe left the database unchanged", false, String(error?.message ?? error));
  }
  await browser.close();
}

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const failure of failures) console.log(`  - ${failure}`);
}
process.exit(failures.length === 0 ? 0 : 1);
