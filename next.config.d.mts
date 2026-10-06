import type { NextConfig } from "next";

/**
 * `next.config.mjs` is plain ESM, so TypeScript sees no types for it. The route
 * namespace test reads the real redirect table from here — that is the point (the
 * test must fail if the table drifts from the route tree), so the declaration
 * exports the framework's own `NextConfig` type rather than a hand-written shape.
 */
declare const nextConfig: NextConfig;
export default nextConfig;
