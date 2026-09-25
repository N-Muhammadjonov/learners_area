#!/usr/bin/env node
/**
 * Shadowing — record, replay, compare. No score, and no invented one.
 *
 * The checks below are as much about what the feature does *not* claim: no band,
 * no percentage, no pronunciation verdict, and nothing recorded is uploaded.
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";

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

async function page(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return { status: res.status, text: await res.text(), location: res.headers.get("location") };
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

console.log(`\nLearners Area — Shadowing against ${BASE}\n`);

const cookie = await login("demo.student@learnersarea.uz", "Student12345!");
check("the student can sign in", Boolean(cookie));

const anon = await page("/speaking/shadowing");
check(
  "an anonymous visitor is sent to the login page",
  anon.status === 307 || anon.status === 302,
  `status ${anon.status}`
);

const speaking = await page("/speaking", cookie);
check("the speaking page links to shadowing", speaking.text.includes("data-shadowing-link"));

const shadowing = await page("/speaking/shadowing", cookie);
check("the shadowing page renders for a student", shadowing.status === 200, `status ${shadowing.status}`);
check("the studio or its honest empty state is shown", shadowing.text.includes("data-shadowing-studio") || shadowing.text.includes("data-shadowing-empty"));
check("the page states that no pronunciation score is produced", shadowing.text.includes("data-shadowing-note"));
check("the picker is present when recordings exist", shadowing.text.includes("data-shadowing-picker") || shadowing.text.includes("data-shadowing-empty"));
check("the original is playable", shadowing.text.includes("data-shadowing-original") || shadowing.text.includes("data-shadowing-empty"));
check("the record control is offered", shadowing.text.includes("data-shadowing-start") || shadowing.text.includes("data-shadowing-unsupported"));
check("the privacy of a take is stated", shadowing.text.includes("data-shadowing-privacy"));

// Honesty: no fabricated judgement anywhere on the surface.
const body = shadowing.text;
const forbidden = [
  /band score/i,
  /pronunciation score of/i,
  /accuracy: \d+%/i,
  /fluency score/i,
];
const claims = forbidden.filter((pattern) => pattern.test(body));
check("the page makes no invented pronunciation claim", claims.length === 0, claims.join(", "));
check(
  "no score is rendered as a number out of nine",
  !/[\s>]\d(\.\d)?[\s<]*\/[\s<]*9\b/.test(body),
  "a band-like figure is on the page"
);

// The take never leaves the browser: no upload endpoint is called from the page.
const clientChunk = (await import("node:fs")).readFileSync(
  "src/components/speaking/ShadowingStudio.tsx",
  "utf8"
);
check("the take is not uploaded anywhere", !clientChunk.includes("/api/uploads") && !clientChunk.includes("preflight("));
check("the take is an object URL in this tab", clientChunk.includes("createObjectURL"));
check("the studio releases the microphone on unmount", clientChunk.includes("cancel()"));

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
