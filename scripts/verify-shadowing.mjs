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

console.log(`Learners Area retired activity checks against ${BASE}`);
const cookie = await login("demo.student@learnersarea.uz", "Student12345!");
check("student signs in", Boolean(cookie));
const anon = await page("/speaking/shadowing");
check("anonymous bookmark requires login", [302, 307].includes(anon.status) && Boolean(anon.location?.includes("/login")));
const retired = await page("/speaking/shadowing", cookie);
check("authenticated bookmark redirects to lessons", [302, 307].includes(retired.status) && retired.location === "/speaking/lessons");
for (const path of ["/speaking", "/speaking/lessons"]) {
  const result = await page(path, cookie);
  check(`${path} renders`, result.status === 200);
  check(`${path} has no retired entry or recorder`, !/data-shadowing-(link|studio|start)|href="\/speaking\/shadowing"/.test(result.text));
}
console.log(`# pass ${pass} / fail ${failures.length}`);
process.exit(failures.length ? 1 : 0);
