/**
 * Writing workspace tables arrive with migration 0031. Until it has run on a
 * database, their queries fail with undefined_table (42P01); the tool then
 * shows an honest "not available yet" state instead of crashing Writing.
 */
export type Safe<T> = { ok: true; value: T } | { ok: false; reason: "not_migrated" };
export async function safeWritingQuery<T>(run: () => Promise<T>): Promise<Safe<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "42P01") return { ok: false, reason: "not_migrated" };
    throw error;
  }
}
