#!/usr/bin/env node
/**
 * The visitor's walk through the front door, over real HTTP against a running
 * server — `/` → Sign in → private dashboard — plus every admission state the
 * gate has to answer for.
 *
 * There is no headless browser in this environment, so this script is a browser
 * in the only part that matters for this flow: it keeps a real cookie jar, follows
 * redirects the way a browser does (up to six hops), and navigates by the links
 * the pages themselves render — starting from the link on `/`.
 *
 * What it proves:
 *   1. `/` and `/login` are reachable by a visitor with no session (the regression);
 *   2. the entry page's own "Sign in" link leads to the login form;
 *   3. a protected URL sends an anonymous visitor to /login and remembers where;
 *   4. signing in sets a real session cookie with the right attributes;
 *   5. the ACTIVE account reaches the dashboard and keeps working after a refresh
 *      and across several private pages;
 *   6. a PENDING account is held in the waiting room and cannot call a private API;
 *   7. a REJECTED account is held there too, and can still ask again;
 *   8. the *same* cookie that was refused a moment ago opens the dashboard once an
 *      owner approves — status is read from the database, not from the cookie;
 *   9. SUSPENDED cuts the same cookie off on its next request;
 *  10. logging out clears the cookie and protected pages are blocked again;
 *  11. a session signed with an old secret, or belonging to a user who no longer
 *      exists (regenerated AUTH_SECRET / reset database), lands on /login — never
 *      a 500 and never a private page;
 *  12. no response body contains a secret or the session token itself.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000");
/** The host a browser uses for this app (the Arena preview host, or localhost). */
const HOST_HEADER = process.env.PREVIEW_HOST ?? null;

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

// ---------------------------------------------------------------------------
// A browser-shaped client: cookie jar + redirect following
// ---------------------------------------------------------------------------

class Jar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(res) {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair, ...attrs] = line.split("; ");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const expired = attrs.some((a) => /^max-age=0$/i.test(a)) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  has(name) {
    return this.cookies.has(name);
  }
  drop(name) {
    this.cookies.delete(name);
  }
}

const bodies = [];

async function visit(path, jar = new Jar(), { method = "GET", body, headers = {}, follow = true } = {}) {
  let url = new URL(path, BASE);
  let res;
  let hops = 0;

  for (;;) {
    res = await fetch(url, {
      method,
      redirect: "manual",
      headers: {
        ...(jar.header() ? { cookie: jar.header() } : {}),
        ...(HOST_HEADER ? { host: HOST_HEADER } : {}),
        ...headers,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    jar.absorb(res);

    const location = res.headers.get("location");
    const redirecting = res.status >= 300 && res.status < 400 && location;
    if (!follow || !redirecting || hops >= 6) break;
    hops += 1;
    url = new URL(location, url); // relative Location values resolve against the current URL
  }

  const text = await res.text();
  bodies.push({ path, status: res.status, text });
  return { status: res.status, url: res.url, text, jar, headers: res.headers };
}

async function login(email, password, jar = new Jar()) {
  const res = await visit("/api/auth/login", jar, {
    method: "POST",
    body: { email, password },
  });
  return { ...res, jar };
}

// ---------------------------------------------------------------------------
// Secrets: read for comparison, never printed
// ---------------------------------------------------------------------------

const envFile = readFileSync(new URL("../.env", import.meta.url), "utf8");
const env = Object.fromEntries(
  envFile
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    })
);

console.log(`\nLearners Area — visitor walk-through against ${BASE}${HOST_HEADER ? ` (host ${HOST_HEADER})` : ""}\n`);

// ---------------------------------------------------------------------------
// 1. The front door
// ---------------------------------------------------------------------------

const anon = new Jar();
const home = await visit("/", anon);
check("/ answers 200 for a visitor with no session", home.status === 200, `status ${home.status}`);
check("the entry page is the centre's own page", /Learners Area/.test(home.text));

const signInHref = (home.text.match(/href="(\/login[^"]*)"/) ?? [])[1];
check("the entry page links to the sign-in page", Boolean(signInHref), "no /login link found");

const loginPage = await visit(signInHref ?? "/login", anon);
check("the sign-in page answers 200", loginPage.status === 200, `status ${loginPage.status}`);
check("it renders a real email field", /type="email"/.test(loginPage.text));
check("it renders a real password field", /type="password"/.test(loginPage.text));

// The three states a browser must be able to reach without a session.
for (const path of ["/", "/login", "/register"]) {
  const res = await visit(path, new Jar());
  check(`${path} is public (no session needed)`, res.status === 200, `status ${res.status}`);
}

// ---------------------------------------------------------------------------
// 2. A protected URL before signing in
// ---------------------------------------------------------------------------

const blocked = await visit("/app/vocabulary", new Jar());
check("a protected page sends an anonymous visitor to the sign-in page", blocked.status === 200 && new URL(blocked.url).pathname === "/login", `ended at ${blocked.url}`);
const nextParam = new URL(blocked.url).searchParams.get("next");
check("it remembers where the visitor wanted to go, as an in-app path", nextParam === "/app/vocabulary", `next=${nextParam}`);

// ---------------------------------------------------------------------------
// 3. Signing in as an ACTIVE account
// ---------------------------------------------------------------------------

const student = new Jar();
const loginResponse = await visit("/api/auth/login", student, {
  method: "POST",
  body: { email: "demo.student@learnersarea.uz", password: "Student12345!" },
});
check("sign-in succeeds over HTTP", loginResponse.status === 200, `status ${loginResponse.status}`);
check("the JSON says the account is onboarded, so the form knows where to go", /"onboarded":true/.test(loginResponse.text));
check("a session cookie was issued", student.has("la_session"));

const setCookie = loginResponse.headers.getSetCookie?.() ?? [];
const cookieLine = setCookie.find((c) => c.startsWith("la_session=")) ?? "";
check("the session cookie is HttpOnly (scripts cannot read it)", /HttpOnly/i.test(cookieLine));
check("the session cookie is SameSite=Lax", /SameSite=Lax/i.test(cookieLine));
check("the session cookie is valid for the whole site", /Path=\//i.test(cookieLine));
check("the session cookie has a bounded lifetime", /Max-Age=\d+/i.test(cookieLine));
check(
  "the session cookie is not marked Secure in this http development environment",
  !/Secure/i.test(cookieLine) || BASE.startsWith("https")
);

const dashboard = await visit("/app/dashboard", student);
check("the ACTIVE student reaches the dashboard", dashboard.status === 200, `status ${dashboard.status}`);
check("the dashboard is the real one, not a placeholder", dashboard.text.includes("data-continue") && dashboard.text.includes("data-my-tasks"));
check("it carries the student's own navigation", dashboard.text.includes("data-report-toggle"));

// Refresh: a second request with the same jar.
const refreshed = await visit("/app/dashboard", student);
check("refreshing keeps the session", refreshed.status === 200 && refreshed.text.includes("data-my-tasks"));

// Several private pages in a row.
const privatePaths = [
  "/app/reading",
  "/app/listening",
  "/app/writing",
  "/app/speaking",
  "/app/grammar",
  "/app/vocabulary",
  "/app/progress",
  "/app/assignments",
  "/app/courses/ielts",
  "/app/live-classes",
  "/app/mocks",
];
const broken = [];
for (const path of privatePaths) {
  const res = await visit(path, student);
  if (res.status !== 200 || res.text.includes("data-app-error")) broken.push(`${path} (${res.status})`);
}
check(`every private page opens for the signed-in student (${privatePaths.length} pages)`, broken.length === 0, broken.join(", "));

// ---------------------------------------------------------------------------
// 4. Logout, and the door closing again
// ---------------------------------------------------------------------------

const loggedOut = await visit("/api/auth/logout", student, { method: "POST" });
check("signing out succeeds", loggedOut.status === 200, `status ${loggedOut.status}`);
check("signing out clears the session cookie", !student.has("la_session"));

const afterLogout = await visit("/app/dashboard", student);
check("after signing out a protected page is blocked again", afterLogout.status === 200 && new URL(afterLogout.url).pathname === "/login", `ended at ${afterLogout.url}`);

// ---------------------------------------------------------------------------
// 5. Old cookies: rotated secret, and a user who no longer exists
// ---------------------------------------------------------------------------

const sessionSecret = env.AUTH_SECRET;
const claims = { sub: randomUUID(), role: "student", name: "Ghost", locale: "en", onboarded: true };

const staleSecretToken = await new SignJWT(claims)
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode("an-old-secret-that-is-no-longer-configured-000000"));

const staleJar = new Jar();
staleJar.cookies.set("la_session", staleSecretToken);
const staleResult = await visit("/app/dashboard", staleJar);
check(
  "a cookie signed with a rotated AUTH_SECRET lands on the sign-in page (not a 500)",
  staleResult.status === 200 && new URL(staleResult.url).pathname === "/login",
  `ended at ${staleResult.url} (${staleResult.status})`
);

const ghostToken = await new SignJWT(claims)
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(sessionSecret));
const ghostJar = new Jar();
ghostJar.cookies.set("la_session", ghostToken);
const ghostResult = await visit("/app/dashboard", ghostJar);
check(
  "a cookie for a user who no longer exists lands on the sign-in page (database reset survived)",
  ghostResult.status === 200 && new URL(ghostResult.url).pathname === "/login",
  `ended at ${ghostResult.url} (${ghostResult.status})`
);

// ---------------------------------------------------------------------------
// 6. PENDING → REJECTED → ACTIVE → SUSPENDED, with one real session
// ---------------------------------------------------------------------------

const owner = new Jar();
await visit("/api/auth/login", owner, { method: "POST", body: { email: "owner@learnersarea.uz", password: "Owner12345!" } });
check("the owner can sign in (the flow needs an approver)", owner.has("la_session"));

const applicantEmail = `flow.test.${randomUUID().slice(0, 8)}@learnersarea.uz`;
const applicant = new Jar();
const registered = await visit("/api/auth/register", applicant, {
  method: "POST",
  body: { name: "Flow Test Applicant", email: applicantEmail, password: "FlowTest12345!" },
});
check("a new visitor can register and is signed in", registered.status === 200, `status ${registered.status}`);

const pendingHome = await visit("/app/dashboard", applicant);
check("a PENDING account is held in the waiting room", new URL(pendingHome.url).pathname === "/pending", `ended at ${pendingHome.url}`);
check("the waiting room states the pending status", pendingHome.text.includes('data-account-status="pending"'));
const pendingApi = await visit("/api/assignments", applicant);
check("a PENDING account cannot call a private API", pendingApi.status === 401, `status ${pendingApi.status}`);

const requested = await visit("/api/admission/request", applicant, {
  method: "POST",
  body: { message: "I would like to join the centre." },
});
const requestId = JSON.parse(requested.text || "{}").requestId;
check("the pending account can file an access request", Boolean(requestId));

const selfApprove = await visit(`/api/admin/admission/${requestId}/decide`, applicant, {
  method: "POST",
  body: { decision: "approve" },
});
check("it cannot approve itself", [401, 403].includes(selfApprove.status), `status ${selfApprove.status}`);

const rejected = await visit(`/api/admin/admission/${requestId}/decide`, owner, {
  method: "POST",
  body: { decision: "reject", note: "verification fixture" },
});
check("the owner can reject the request", rejected.status === 200, `status ${rejected.status}`);

const rejectedHome = await visit("/app/dashboard", applicant);
check("a REJECTED account is held in the waiting room", new URL(rejectedHome.url).pathname === "/pending", `ended at ${rejectedHome.url}`);
check("the waiting room states the rejected status", rejectedHome.text.includes('data-account-status="rejected"'));
check("a REJECTED account still cannot call a private API", (await visit("/api/assignments", applicant)).status === 401);

const askedAgain = await visit("/api/admission/request", applicant, { method: "POST", body: {} });
const secondRequestId = JSON.parse(askedAgain.text || "{}").requestId;
check("a rejected applicant can ask again", askedAgain.status === 200 && Boolean(secondRequestId));

const approved = await visit(`/api/admin/admission/${secondRequestId}/decide`, owner, {
  method: "POST",
  body: { decision: "approve" },
});
check("the owner can approve the second request", approved.status === 200, `status ${approved.status}`);

const approvedHome = await visit("/app/dashboard", applicant);
check(
  "the SAME cookie that was refused a moment ago now opens the dashboard",
  approvedHome.status === 200 && new URL(approvedHome.url).pathname === "/app/dashboard",
  `ended at ${approvedHome.url}`
);
const pendingNow = await visit("/pending", applicant);
check("an ACTIVE account is sent from the waiting room into the centre", new URL(pendingNow.url).pathname === "/app/dashboard", `ended at ${pendingNow.url}`);

const applicantId = JSON.parse(rejected.text || "{}").userId;
const suspended = await visit(`/api/admin/users/${applicantId}/status`, owner, {
  method: "POST",
  body: { status: "suspended", reason: "automated verification fixture" },
});
check("the owner can suspend the account", suspended.status === 200, `status ${suspended.status}`);

const suspendedHome = await visit("/app/dashboard", applicant);
check(
  "SUSPENDED cuts the same session off on its very next request",
  new URL(suspendedHome.url).pathname === "/pending",
  `ended at ${suspendedHome.url}`
);
check("the waiting room states the suspended status", suspendedHome.text.includes('data-account-status="suspended"'));
check("a SUSPENDED account cannot call a private API", (await visit("/api/assignments", applicant)).status === 401);

// ---------------------------------------------------------------------------
// 7. Nothing secret ever came back in a body
// ---------------------------------------------------------------------------

const leaked = [];
for (const body of bodies) {
  if (body.text.includes(sessionSecret)) leaked.push(`${body.path}: AUTH_SECRET`);
  if (body.text.includes("postgres://")) leaked.push(`${body.path}: database URL`);
  if (/la_session=[A-Za-z0-9._-]{20,}/.test(body.text)) leaked.push(`${body.path}: session token`);
  if (body.text.includes("OTP_SECRET") || body.text.includes("TELEGRAM_BOT_TOKEN")) leaked.push(`${body.path}: another secret`);
}
check(`no response body contains a secret or the session token (${bodies.length} responses checked)`, leaked.length === 0, leaked.join(", "));

// ---------------------------------------------------------------------------
// 8. The page a browser actually boots: every script it asks for is served
// ---------------------------------------------------------------------------
// A page that renders but whose client bundle 404s looks fine over HTML and then
// does nothing when you press the button, so the bundles are fetched for real.
{
  const served = await fetch(new URL("/login", BASE), { headers: HOST_HEADER ? { host: HOST_HEADER } : {} });
  const html = await served.text();
  const scripts = [...new Set([...html.matchAll(/src="(\/_next\/[^"]+)"/g)].map((m) => m[1]))];
  check(`the sign-in page asks the browser for its scripts (${scripts.length} bundles)`, scripts.length > 0);

  const missing = [];
  let formBundle = "";
  for (const src of scripts) {
    const res = await fetch(new URL(src, BASE), { headers: HOST_HEADER ? { host: HOST_HEADER } : {} });
    if (res.status !== 200) missing.push(`${src} (${res.status})`);
    else if (src.includes("/login/")) formBundle = await res.text();
  }
  check("every script the sign-in page needs is served", missing.length === 0, missing.join(", "));
  check(
    "the served login bundle contains the sign-in request (so the button is wired)",
    formBundle.includes("/api/auth/login"),
    "the login chunk did not mention the endpoint"
  );
}

// ---------------------------------------------------------------------------
// 9. The sign-in form cannot be turned into an open redirect
// ---------------------------------------------------------------------------
// `?next=` comes from the address bar. The form must send the visitor to a path
// inside this app (safeNextPath) rather than to whatever the link said, so a
// crafted `?next=https://…` cannot bounce a freshly signed-in student off-site.
{
  const form = readFileSync(new URL("../src/components/auth/LoginForm.tsx", import.meta.url), "utf8");
  const raw = form.match(/searchParams\.get\("next"\)/)?.[0] ?? "";
  const guarded = /safeNextPath\(\s*searchParams\.get\("next"\)\s*\)/.test(form);
  check("the sign-in form validates the post-login destination", Boolean(raw) && guarded);
  check(
    "the raw query value is never used as a destination",
    !/router\.push\(\s*next\b(?!\s*\?\?)/.test(form)
  );
}

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
