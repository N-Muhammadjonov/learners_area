import { NextResponse } from "next/server";

/**
 * Build identity of the running deployment.
 *
 * Deployments are immutable, so this is safe to cache. It answers exactly one
 * question - "which commit is production actually serving, and in which
 * region?" - and exposes nothing else: no environment values, no connection
 * strings, no feature data. Vercel provides the values; when they are absent
 * (local `next start`) the fields stay null.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.VERCEL_GIT_COMMIT_REF?.trim() ||
    null;

  return NextResponse.json(
    {
      commit,
      shortCommit: commit ? commit.slice(0, 7) : null,
      region: process.env.VERCEL_REGION?.trim() || null,
      environment: process.env.VERCEL_ENV?.trim() || null,
    },
    { headers: { "cache-control": "public, max-age=0, s-maxage=300" } },
  );
}
