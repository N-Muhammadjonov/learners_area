import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { safeErrorLabel } from "./errors";

export { safeErrorLabel };

/**
 * Timing for the operations that decide whether a page feels alive.
 *
 * This is deliberately quiet: a normal request logs nothing at all. Only an
 * operation that crossed a threshold, or one that failed, writes a line — and
 * that line carries an operation name, a duration, a correlation id and an error
 * *class*, never a connection string, a cookie, a token or a row of content.
 *
 * The correlation id is the platform's own request id when there is one (Vercel
 * puts `x-vercel-id` on every invocation), so a slow line here can be lined up
 * with the same request in the platform's logs. Outside a request scope — a
 * script, a unit test — it falls back to a random id.
 */

function slowThreshold(): number {
  const deployment = process.env.APP_ENV || process.env.VERCEL_ENV;
  const defaultThreshold = deployment === "preview" ? 120 : 400;
  const raw = process.env.SLOW_OPERATION_LOG_MS?.trim();
  // `Number("")` is 0, and a threshold of 0 would log every single operation —
  // an unset or empty variable has to mean "use the default".
  if (!raw) return defaultThreshold;
  const configured = Number(raw);
  return Number.isFinite(configured) && configured >= 0 ? configured : defaultThreshold;
}

let fallbackId: string | null = null;

async function correlationId(): Promise<string> {
  try {
    const requestHeaders = await headers();
    const id = requestHeaders.get("x-vercel-id") ?? requestHeaders.get("x-request-id");
    if (id) return id.slice(0, 64);
  } catch {
    // Not inside a request (CLI, unit test) — fall through to a random id.
  }
  fallbackId ??= randomUUID().slice(0, 8);
  return fallbackId;
}

export async function timed<T>(operation: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await run();
    const ms = Math.round(performance.now() - started);
    if (ms >= slowThreshold()) {
      console.warn(`[perf] ${operation} ${ms}ms id=${await correlationId()}`);
    }
    return result;
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    console.error(`[perf] ${operation} FAILED ${ms}ms id=${await correlationId()} ${safeErrorLabel(error)}`);
    throw error;
  }
}
