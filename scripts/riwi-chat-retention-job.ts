/** One-shot scheduled cleanup for Railway or another identified deployment.
 * Uses the canonical D-01 service; never deletes Speaking/academic records.
 * Defaults to read-only preview. Applying requires a separate deployment opt-in.
 */
async function main() {
  const args = process.argv.slice(2);
  const apply = args.length === 1 && args[0] === "--apply";
  const target = process.env.RIWI_CHAT_RETENTION_DATABASE;
  if (!(args.length === 0 || (args.length === 1 && ["--apply", "--dry-run"].includes(args[0]!))) ||
      !process.env.DATABASE_URL || !target || !/^[a-zA-Z0-9_]{1,63}$/.test(target) ||
      (apply && process.env.RIWI_CHAT_RETENTION_JOB_ENABLED !== "true")) {
    console.log(JSON.stringify({ status: "REFUSED", reason: "explicit_database_and_apply_opt_in_required" }));
    process.exitCode = 64;
    return;
  }
  let close: (() => Promise<void>) | undefined;
  try {
    // Do not import the DB module until argument/opt-in validation has passed.
    const { db } = await import("../src/db/client");
    close = () => db.$client.end();
    const { sql } = await import("drizzle-orm");
    const identity = await db.execute<{ name: string }>(sql`select current_database() as name`);
    if (identity.rows[0]?.name !== target) {
      console.log(JSON.stringify({ status: "REFUSED", reason: "database_identity_mismatch" }));
      process.exitCode = 64;
      return;
    }
    const { runRiwiConversationRetention } = await import("../src/lib/services/riwi/conversation-retention");
    const result = await runRiwiConversationRetention({ dryRun: !apply });
    if (!result.locked) {
      console.log(JSON.stringify({ status: "DEFERRED", locked: false }));
      process.exitCode = 75;
      return;
    }
    console.log(JSON.stringify({ status: !result.complete ? "INCOMPLETE" : apply ? "APPLIED" : "DRY_RUN", ...result }));
    if (!result.complete) process.exitCode = 75;
  } catch {
    // SQL, DSNs, secrets and exception bodies never enter the scheduler receipt.
    console.log(JSON.stringify({ status: "FAILED", reason: "retention_job_failed" }));
    process.exitCode = 1;
  } finally {
    try { await close?.(); } catch { process.exitCode = 1; }
  }
}

void main();
export {};
