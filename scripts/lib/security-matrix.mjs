/**
 * Six-actor security matrix harness (Package D).
 *
 * The point of this module is to make a security assertion expensive to fake. Three rules drive
 * the design, each one answering a way a matrix like this normally lies:
 *
 *  1. NO VACUOUS DENIALS. Every negative control names the positive fixture it depends on, and
 *     the caller must have proved that fixture exists. "Student B cannot read student A's
 *     submission" is worth nothing if student A has no submission — the assertion then passes
 *     because the row is missing, not because the boundary held. `assertFixtureExists()` and the
 *     `positiveControl` field exist to make that impossible to skip.
 *
 *  2. A STATUS CODE IS NOT A PRIVACY PROOF. The owner's instruction is explicit: a streamed shell
 *     that returns 200 with a 404 body must NOT be classified automatically as an IDOR. So a
 *     denial is judged on TWO independent axes and they are recorded separately:
 *       • `leaked`      — did the response BODY contain the owner's secret marker? This is the
 *                         privacy boundary and it is the one that matters.
 *       • `statusCorrect` — did the HTTP status say "denied"? This is routing/status correctness.
 *     A row can be PRIVACY_OK / STATUS_WRONG, which is a real and different finding from a leak.
 *
 *  3. EVERY MARKER HAS A POSITIVE TWIN. Before asserting that actor X cannot see marker M, the
 *     matrix asserts that M's owner CAN see it. Otherwise "marker absent" passes when the route
 *     is simply broken for everybody.
 */

/** One authenticated (or anonymous) actor. */
export function createActor(name, cookie, base, { ip, sink } = {}) {
  return {
    name,
    cookie: cookie ?? "",
    /** @returns {{status:number, body:string, json:any, headers:Headers, redirected:boolean, location:string|null}} */
    async request(method, pathname, { body, form, headers = {}, redirect = "manual" } = {}) {
      const init = {
        method,
        redirect,
        headers: {
          ...(ip ? { "x-forwarded-for": ip } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(form ? {} : body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
      };
      if (form) init.body = form;
      else if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
      const res = await fetch(`${base}${pathname}`, init);
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* an HTML shell is a legitimate answer */ }
      const record = {
        actor: name,
        route: `${method} ${pathname}`,
        status: res.status,
        body: text,
        json,
        headers: res.headers,
        redirected: res.redirected,
        location: res.headers.get("location"),
      };
      // Every response the matrix ever saw, so a secret-leakage sweep can be run over the
      // real traffic instead of over a hand-picked sample of it.
      if (sink) sink.push(record);
      return record;
    },
    get(pathname, opts) { return this.request("GET", pathname, opts); },
    post(pathname, body, opts) { return this.request("POST", pathname, { ...opts, body }); },
  };
}

/**
 * Sign in over real HTTP and PROVE which account the cookie belongs to.
 *
 * No endpoint in this product echoes the caller's own email back, so identity is verified by
 * decoding the signed session cookie (`la_session`, HS256 over AUTH_SECRET) and comparing its
 * `sub` claim against the user id the database holds for that email. That is strictly stronger
 * than an echo: an echo can be rendered from a wrong session, a verified `sub` cannot.
 *
 * This matters because a matrix whose STUDENT_B is silently holding STUDENT_A's cookie reports
 * every cross-user denial as PASS while proving nothing at all.
 */
export async function loginActor(name, base, email, password, { ip = "203.0.113.77", client, sink } = {}) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
    throw new Error(`login failed for ${name} (${email}): HTTP ${res.status} ${await res.text().catch(() => "")}`);
  }
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!cookie.includes("la_session")) throw new Error(`login for ${name} set no session cookie`);

  let identity = { sub: null, role: null, email };
  const secret = process.env.AUTH_SECRET;
  if (secret) {
    const { jwtVerify } = await import("jose");
    const token = cookie.split("; ").find((part) => part.startsWith("la_session="))?.slice("la_session=".length);
    if (!token) throw new Error(`actor ${name}: session cookie has no token`);
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    identity = { sub: payload.sub ?? null, role: payload.role ?? null, email: payload.name ? email : email };
  }

  if (client) {
    const { rows } = await client.query("select id, role, account_status from users where lower(email) = lower($1)", [email]);
    if (!rows.length) throw new Error(`actor ${name}: no database user for ${email}`);
    const expected = rows[0];
    if (identity.sub !== expected.id) {
      throw new Error(`actor ${name} authenticated as sub=${identity.sub} but ${email} is ${expected.id}`);
    }
    if (identity.role && identity.role !== expected.role) {
      throw new Error(`actor ${name} cookie role ${identity.role} != database role ${expected.role}`);
    }
    identity.userId = expected.id;
    identity.accountStatus = expected.account_status;
  }

  return { actor: createActor(name, cookie, base, { ip, sink }), identity, email };
}

const DENIAL_STATUSES = new Set([401, 403, 404, 410, 422, 429]);

/**
 * Statuses and bodies that mean THE PROBE IS WRONG, not that the product denied anything.
 *
 * These are separated out because both are trivially mistaken for a pass:
 *
 *  • **405 Method Not Allowed** — the probe called a verb the route does not implement. The
 *    authorisation code never ran. Counting it as a denial turns "I asked the wrong question"
 *    into "the boundary held", and it does so for every single row that has the typo.
 *
 *  • **400 invalid_input** — the request failed schema validation, which in this codebase runs
 *    BEFORE the ownership check. The payload never reached the boundary being tested.
 *
 * A matrix that cannot tell these apart is worse than no matrix, because it reports green.
 */
export function probeDefect(res) {
  if (res.status === 405) return "405 Method Not Allowed — the probe used a verb this route does not implement; authorisation never ran";
  if (res.status === 400 && /"error"\s*:\s*"invalid_input"/.test(res.body)) {
    return "400 invalid_input — schema validation refused the body before any ownership check ran";
  }
  if (res.status === 415) return "415 Unsupported Media Type — the probe sent the wrong content type";
  return null;
}

/**
 * Judge one response as a denial.
 *
 * @param res        the response
 * @param markers    strings that must NOT appear in the body (other actors' secrets)
 * @returns {{leaked:boolean, statusCorrect:boolean, leakedMarkers:string[], status:number,
 *            redirectedToLogin:boolean, verdict:"PRIVACY_OK"|"LEAK"}}
 */
export function judgeDenial(res, markers = []) {
  const leakedMarkers = markers.filter((marker) => marker && res.body.includes(marker));
  const redirectedToLogin =
    [302, 303, 307, 308].includes(res.status) && /\/login/.test(res.location ?? "");
  // A redirect to /login is a legitimate denial for a page route: the shell never renders.
  const statusCorrect = DENIAL_STATUSES.has(res.status) || redirectedToLogin;
  const defect = probeDefect(res);
  return {
    leaked: leakedMarkers.length > 0,
    leakedMarkers,
    statusCorrect,
    status: res.status,
    redirectedToLogin,
    probeDefect: defect,
    verdict: leakedMarkers.length > 0 ? "LEAK" : defect ? "PROBE_DEFECT" : "PRIVACY_OK",
  };
}

/**
 * The matrix itself: rows in, a report out, and a nonzero exit code if any row failed.
 */
export function createMatrix(title) {
  const rows = [];
  return {
    title,
    rows,
    /**
     * @param row {section, id, route, action, authorized, unauthorized, positiveControl,
     *             negativeControl, actual, dbEffect, verdict}
     */
    row(row) {
      const filled = {
        section: row.section ?? "?",
        id: row.id ?? `R${rows.length + 1}`,
        route: row.route ?? "?",
        action: row.action ?? "?",
        authorized: row.authorized ?? "?",
        unauthorized: row.unauthorized ?? "?",
        positiveControl: row.positiveControl ?? "?",
        negativeControl: row.negativeControl ?? "?",
        actual: row.actual ?? "?",
        dbEffect: row.dbEffect ?? "none",
        verdict: row.verdict ?? "FAIL",
      };
      rows.push(filled);
      const mark = filled.verdict === "PASS" ? "  ok" : "FAIL";
      console.log(`${mark} [${filled.section}/${filled.id}] ${filled.route} — ${filled.action} (${filled.verdict})`);
      return filled;
    },
    get failures() { return rows.filter((row) => row.verdict !== "PASS"); },
    get pass() { return rows.filter((row) => row.verdict === "PASS").length; },
    get fail() { return this.failures.length; },
    tally(verdict) { return rows.filter((row) => row.verdict === verdict).length; },
    /**
     * Markdown table, one row per assertion. Deliberately includes the negative control and the
     * positive control as their own columns: a matrix that hides them cannot be audited.
     */
    report() {
      const header = "| § | id | route / action | authorized | unauthorized | positive control | negative control | actual | DB effect | verdict |";
      const rule = "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
      const body = rows.map((row) =>
        `| ${row.section} | ${row.id} | \`${row.route}\` — ${row.action} | ${row.authorized} | ${row.unauthorized} | ${row.positiveControl} | ${row.negativeControl} | ${row.actual} | ${row.dbEffect} | **${row.verdict}** |`,
      );
      const sections = [...new Set(rows.map((row) => row.section))];
      const bySection = sections.map((section) => {
        const inSection = rows.filter((row) => row.section === section);
        return `  ${section}: ${inSection.filter((r) => r.verdict === "PASS").length}/${inSection.length}`;
      });
      return [
        `## ${title}`,
        "",
        // "Not PASS" is not one thing. FAIL is a product breach; STATUS_DEFECT is a wrong status
        // with privacy intact; PROBE_DEFECT is a row that tested nothing; OWNER_ASSET_REQUIRED and
        // ENVIRONMENT_BLOCKED could not be tested for a reason outside the product. Collapsing all
        // five into a single number either over-claims or hides a breach among the blockers.
        `**${this.pass} PASS / ${this.fail} NOT-PASS** across ${rows.length} rows — ` +
          `FAIL ${this.tally("FAIL")}, status defects ${this.tally("STATUS_DEFECT")}, ` +
          `probe defects ${this.tally("PROBE_DEFECT")}, ` +
          `blocked ${this.tally("OWNER_ASSET_REQUIRED") + this.tally("ENVIRONMENT_BLOCKED")}, ` +
          `no-surface ${this.tally("PASS_NO_SURFACE")}.`,
        "",
        ...bySection,
        "",
        header,
        rule,
        ...body,
        "",
      ].join("\n");
    },
  };
}
