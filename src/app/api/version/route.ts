import { NextResponse } from "next/server";
import { deploymentEnvironment } from "@/lib/config/site";

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
    process.env.APP_COMMIT_SHA?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
    null;

  return NextResponse.json(
    {
      commit,
      shortCommit: commit ? commit.slice(0, 7) : null,
      region: process.env.APP_REGION?.trim() || process.env.VERCEL_REGION?.trim() || null,
      environment: deploymentEnvironment(),
    },
    // Never cached: a cached answer would keep reporting the deployment that
    // was live a few minutes ago, which is exactly the confusion this endpoint
    // exists to remove.
    { headers: { "cache-control": "no-store" } },
  );
}
