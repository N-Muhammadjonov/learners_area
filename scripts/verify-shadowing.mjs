#!/usr/bin/env node
/**
 * Shadowing — record, replay, compare. No score, and no invented one.
 *
 * The checks below are as much about what the feature does *not* claim: no band,
 * no percentage, no pronunciation verdict, and nothing recorded is uploaded.
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000");

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

const anon = await page("/app/speaking/shadowing");
check(
  "an anonymous visitor is sent to the login page",
  anon.status === 307 || anon.status === 302,
  `status ${anon.status}`
);

// CONTRACT NOTE. Shadowing is deliberately NOT a fifth Speaking hub card: the hub has
// exactly four entries by owner spec §26-29, and `shadowing` is a CATEGORY of speaking
// material rather than a separate store. /app/speaking/shadowing is a thin redirect to
// the Speaking lessons page, which is where the drill lives. This probe previously
// asserted a `data-shadowing-link` card on the hub and a 200 at the shadowing URL; both
// described a surface the product no longer has. It now asserts the real contract —
// including that the redirect lands somewhere the studio is actually mounted, which is
// the part that was broken.
const speaking = await page("/app/speaking", cookie);
const hubCards = [...speaking.text.matchAll(/data-speaking-card="([a-z-]+)"/g)].map((m) => m[1]);
check(
  "the speaking hub offers exactly the four approved entries",
  hubCards.length === 4 && ["partner", "practice", "ai", "lessons"].every((k) => hubCards.includes(k)),
  `cards=${JSON.stringify(hubCards)}`
);
check(
  "shadowing is not a fifth top-level hub card",
  !hubCards.includes("shadowing"),
  `cards=${JSON.stringify(hubCards)}`
);

const legacy = await page("/app/speaking/shadowing", cookie);
// redirect() inside a Server Component is answered as 200 with the destination encoded
// in the streamed payload, not as a 3xx with a Location header. Accept either shape,
// but insist the destination is named — "it resolved" alone would pass on an error page.
const legacyRedirects =
  legacy.status === 307 || legacy.status === 302 || legacy.status === 308 ||
  (legacy.status === 200 && legacy.text.includes("/app/speaking/lessons"));
check(
  "the legacy shadowing URL still resolves rather than 404ing",
  legacy.status < 400,
  `status ${legacy.status}`
);
check(
  "the legacy shadowing URL sends the learner to the speaking lessons page",
  legacyRedirects,
  `status ${legacy.status} location ${legacy.location}`
);

// The drill must actually be present where the redirect sends the learner. This is the
// assertion that fails if the studio is orphaned again.
const shadowing = await page("/app/speaking/lessons", cookie);
check("the page the redirect lands on renders for a student", shadowing.status === 200, `status ${shadowing.status}`);
check(
  "a shadowing section exists on the page the redirect lands on",
  shadowing.text.includes("data-shadowing-section"),
  "the studio is mounted nowhere, so the drill is unreachable"
);
check("the studio or its honest empty state is shown", shadowing.text.includes("data-shadowing-studio") || shadowing.text.includes("data-shadowing-empty"));
check("the page states that no pronunciation score is produced", shadowing.text.includes("data-shadowing-note"));
// Two honest states, and the checks follow the one the page is in. The seed ships
// no audio material (a demo file nobody recorded would be fake content), so the
// empty state is the expected state here — and it must say what is missing.
if (shadowing.text.includes("data-shadowing-studio")) {
  check("the picker is present when recordings exist", shadowing.text.includes("data-shadowing-picker"));
  check("the original is playable", shadowing.text.includes("data-shadowing-original"));
  check("the record control is offered", shadowing.text.includes("data-shadowing-start") || shadowing.text.includes("data-shadowing-unsupported"));
  check("the privacy of a take is stated", shadowing.text.includes("data-shadowing-privacy"));
} else {
  check("with no audio material the page says so instead of offering a dead recorder", shadowing.text.includes("data-shadowing-empty"));
  check("the empty state explains where a recording comes from", /Speaking material/i.test(shadowing.text));
  check("no recorder is offered without something to shadow", !shadowing.text.includes("data-shadowing-start"));
  check("no pronunciation score is offered in the empty state", !shadowing.text.includes("data-shadowing-score"));
}

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

// A fully-implemented component that nothing imports is not a feature. This is exactly
// how shadowing became unreachable: the route redirected, the lessons page filtered the
// category out, and ShadowingStudio was left orphaned.
const { execSync } = await import("node:child_process");
// Look for actual JSX USAGE, not merely an import: an unused import still matches a
// bare name grep, so the weaker check passed even after the element was removed.
const importers = execSync(
  "grep -rl '<ShadowingStudio' src --include=*.tsx || true",
  { encoding: "utf8" }
).trim();
check(
  "the shadowing studio is mounted by a real page, not orphaned",
  importers.length > 0,
  "no page imports ShadowingStudio"
);

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
