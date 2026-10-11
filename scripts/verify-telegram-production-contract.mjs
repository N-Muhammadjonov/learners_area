/**
 * Read-only remote deployment check. No service keys, bot tokens, writes, or DB probes.
 * HTTP 401 proves an internal route exists and refuses an unauthenticated caller.
 * An absent route generally answers 404, but a proxy/error may require manual triage.
 * Run from CI to verify the actual Vercel hostname, not a stale Git branch mapping.
 */
const base = (process.env.TELEGRAM_PRODUCTION_API_ORIGIN || "https://learners-area.vercel.app").replace(/\/$/, "");
const probes = [
  { path: "/api/internal/telegram/ready", statuses: [401] },
  { path: "/api/internal/telegram/required-channels", statuses: [401] },
  { path: "/api/internal/telegram/contacts/1", statuses: [401] },
  { path: "/api/internal/telegram/contacts/phone", statuses: [405] },
];
let failed = false;
for (const probe of probes) {
  try {
    const response = await fetch(base + probe.path, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
      headers: { Accept: "application/json" },
    });
    const passed = probe.statuses.includes(response.status);
    console.log(`${passed ? "READY" : "NOT_READY"} | GET ${probe.path} | status=${response.status} | expected=${probe.statuses.join("/")}`);
    if (!passed) failed = true;
  } catch (error) {
    failed = true;
    console.log(`ENV_BLOCKED | GET ${probe.path} | ${String(error?.cause?.code || error?.name || "network_error")}`);
  }
}
if (failed) {
  console.error("Production backend does not yet have verified Telegram onboarding API compatibility. Do NOT update Railway bot.");
  process.exitCode = 1;
} else {
  console.log("Anonymous route-presence probes pass. This is NOT proof that credentials, DB migration, or end-to-end flows are ready.");
}
