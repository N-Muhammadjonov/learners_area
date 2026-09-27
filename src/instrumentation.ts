import { causalChain, firstStackFrame } from "@/lib/observability/errors";

/**
 * Server-side error logging, once, for every request that fails.
 *
 * Why this file exists: the reader-visible "Something went wrong while loading
 * this page." is a React error boundary, and the code it shows
 * (`1594744578`) is not an id — it is a hash of the failing error's message and
 * stack, produced by Next.js so that internals are not sent to the browser. Two
 * different failures produce two different numbers and the *same* failure always
 * produces the same number, which is what makes the code useful: it proves that
 * the Reading crash was one repeated failure rather than a random one. But the
 * number alone never says what broke, and Next.js does not print a server error
 * at all unless it is asked to — which is how a production crash can exist with a
 * user-visible code and no server line to match it.
 *
 * This is that line. It records what an operator needs — the digest the reader
 * sees, the class of the error with its cause chain and system codes, one
 * truncated message, and where it happened — and nothing that could leak: no
 * cookie, no authorisation header, no connection string, no query parameters, no
 * row of content. The request headers are never read at all.
 *
 * The digest in the log is the string to search for in the Vercel log view when
 * a reader reports a code.
 */

type ErrorContext = {
  routerKind: string;
  routePath: string;
  routeType: string;
  renderSource?: string;
};

type RequestInfo = Readonly<{
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
}>;

function digestOf(error: unknown): string {
  const digest = (error as { digest?: unknown })?.digest;
  return typeof digest === "string" && digest ? digest : "none";
}

export function register() {
  // A build marker, so the log view says which runtime is serving, in which
  // region, with which pool budget — without anyone having to guess.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.info(
      `[boot] learners-area node runtime · region=${process.env.VERCEL_REGION ?? "local"} · poolMax=${
        process.env.DATABASE_POOL_MAX ?? "5"
      }`
    );
  }
}

export async function onRequestError(error: unknown, request: RequestInfo, context: Readonly<ErrorContext>) {
  const frame = firstStackFrame(error);
  console.error(
    `[request-error] digest=${digestOf(error)} ${context.routeType}${
      context.renderSource ? `/${context.renderSource}` : ""
    } ${request.method} ${request.path} route=${context.routePath || "-"} region=${
      process.env.VERCEL_REGION ?? "local"
    } chain=${causalChain(error)}${frame ? ` at=${frame}` : ""}`
  );
}
