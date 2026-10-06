import { canonicalHomeRedirects, legacyModuleRedirects } from "./src/lib/nav/private-modules.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: { "/api/owner/student-export": ["./src/assets/fonts/DejaVuSans.ttf"] },
  // The disposable local development server proxies file bytes to disk. Next
  // 15's 10 MB middleware clone otherwise truncates a valid 16 MB audio file.
  // Hosted Preview/Production retain the framework limit and direct S3/R2 PUTs.
  ...(process.env.APP_ENV === "development" && process.env.STORAGE_PROVIDER === "local"
    ? { experimental: { middlewareClientMaxBodySize: "64mb" } }
    : {}),
  eslint: { ignoreDuringBuilds: false },
  /**
   * Front-end source minimisation, stated rather than assumed.
   *
   * A production build must not ship source maps: they would hand a reader the
   * original components, comments and route structure of every private screen.
   * `poweredByHeader: false` drops the framework banner, so a response does not
   * advertise the exact stack and version to the first scanner that reads it.
   * Both are Next defaults; writing them down keeps them true after a future
   * config edit, and `scripts/verify-a11y.mjs` asserts the built output.
   */
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  /**
   * Dev-server origins.
   *
   * Next 15 warns (and will refuse) when the browser reaches `/_next/*` from an
   * origin the dev server was not started with. The hosted Arena preview is
   * served from `https://<port>-<sandbox>.e2b.app` and proxies to this server, so
   * that host has to be listed or the preview loses every script and stylesheet.
   * This affects `next dev` only — a production build never reads it.
   */
  allowedDevOrigins: ["*.e2b.app", "localhost:3000", "127.0.0.1:3000"],
  /**
   * `/favicon.ico` is answered explicitly.
   *
   * Browsers still request `/favicon.ico` by convention, before they have parsed
   * a single `<link rel="icon">` — and a 404 there shows up as a blank tab icon
   * even when the metadata is correct. The file is a 16/32/48px ICO built from
   * the approved favicon artwork by `scripts/build-brand-derivatives.mjs`, and
   * this rewrite serves it from the same canonical place as the PNGs instead of
   * duplicating bytes into the app directory.
   */
  /**
   * Historical private URLs stay alive.
   *
   * Every module used to live at the root (`/listening`, `/reading/retention`,
   * `/writing/submissions/<id>`, …). The canonical authenticated namespace is now
   * `/app/...`, so those old links — bookmarks, notifications already stored in
   * the database, links teachers pasted into a chat — must not turn into 404s.
   *
   * The table is built from `src/lib/nav/private-modules.mjs`, the same module the
   * middleware reads for its coarse session check, so the redirect set and the
   * protected set cannot drift apart. A wildcard per module covers every depth in
   * one rule, and Next preserves the query string, so
   * `/reading/attempts/<id>?tab=review` becomes
   * `/app/reading/attempts/<id>?tab=review` with its id and parameters intact.
   *
   * These are **temporary (307)** on purpose: the shape of `/app` is still
   * settling, and a 308 would be cached by browsers for good. Nothing here touches
   * `/api/*` — the wildcards name page modules only — and no rule's destination is
   * another rule's source, so there is no redirect loop.
   */
  async redirects() {
    return [
      // `/app/dashboard` is not a second dashboard: the canonical entry is `/app`
      // (see APP_HOME in src/lib/nav/private-modules.mjs). One implementation, no
      // duplicate page — the alias only ever redirects.
      ...canonicalHomeRedirects(),
      ...legacyModuleRedirects(),
    ];
  },
  async rewrites() {
    const rewrites = [{ source: "/favicon.ico", destination: "/brand/derived/favicon.ico" }];
    const storageEndpoint = (process.env.R2_ENDPOINT || process.env.S3_ENDPOINT || "").replace(/\/+$/, "");
    if (storageEndpoint) {
      rewrites.push({
        source: "/__storage-read/:path*",
        destination: `${storageEndpoint}/:path*`,
      });
    }
    return rewrites;
  },
};

export default nextConfig;
