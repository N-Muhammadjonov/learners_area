import { NextResponse } from "next/server";
import { isRetentionError } from "@/lib/retention/errors";
import { safeErrorLabel } from "@/lib/observability/errors";

/**
 * The stable error contract for every Retention route (§104, §165).
 *
 * A refusal answers `{ error: "<stable_code>" }` with the status that code
 * carries. Never a SQL string, never a stack, never a connection string: an
 * unexpected failure is logged by class only and answered as a generic code the
 * UI has a localized sentence for.
 */

export type RetentionErrorBody = {
  error: string;
  details?: unknown;
};

/** Wraps a route body so no implementation detail can escape as JSON. */
export async function retentionJson<T>(run: () => Promise<T>): Promise<NextResponse> {
  try {
    const result = await run();
    return NextResponse.json(result as Record<string, unknown>);
  } catch (error) {
    if (isRetentionError(error)) {
      return NextResponse.json({ error: error.code, details: error.details } satisfies RetentionErrorBody, {
        status: error.status,
      });
    }
    // Anything else is a real fault: the log gets a class, the client gets a code.
    console.error(`[retention] route failed: ${safeErrorLabel(error)}`);
    return NextResponse.json({ error: "retention_unavailable" } satisfies RetentionErrorBody, { status: 500 });
  }
}

export function invalidJson(): NextResponse {
  return NextResponse.json({ error: "retention_invalid_input" } satisfies RetentionErrorBody, { status: 400 });
}

export function forbidden(): NextResponse {
  return NextResponse.json({ error: "retention_forbidden" } satisfies RetentionErrorBody, { status: 403 });
}

export function unauthenticated(): NextResponse {
  return NextResponse.json({ error: "unauthenticated" } satisfies RetentionErrorBody, { status: 401 });
}
