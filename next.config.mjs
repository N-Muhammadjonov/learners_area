import { appLegacyAliasRedirects, canonicalHomeRedirects, legacyModuleRedirects } from "./src/lib/nav/private-modules.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/owner/dictionary/[...action]": ["./build/dictionary-index-worker.cjs","./content/dictionary/presentation/*.json.gz"],
    "/api/dictionary/entries/[lexemeId]": ["./content/dictionary/presentation/*.json.gz"],
    "/api/dictionary/save": ["./content/dictionary/presentation/*.json.gz"],
    "/api/listening/full/[id]/authored": ["./content/listening/academic/test-*/source.html"],
    "/api/owner/student-export": ["./src/assets/fonts/DejaVuSans.ttf"],
    // The guarded Owner QA page reads staged JSONL from disk at runtime.
    // The learner bundle and public routes never receive these rubric files.
    "/app/admin/reading/retention/staged": ["./content/retention-v2/*.jsonl", "./content/retention-v2/calibration-gaps.json"],
  },
  // Next 15 normally buffers only 10 MB of an incoming request. When local
  // storage is selected, /api/uploads must proxy files of up to 60 MiB on both
  // production and development. Reserve 1 MiB for multipart form boundaries and
  // headers; the authoritative 60 MiB file limit is checked in upload intents
  // and again in /api/uploads. R2/S3 continue to use direct browser PUTs.
  ...(process.env.STORAGE_PROVIDER === "local"
    ? { experimental: { middlewareClientMaxBodySize: "61mb" } }
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
  async headers() {
    // Only content-addressed wallpaper derivatives are immutable. Stable source
    // filenames and every private/API response keep their existing policies.
    return [{
      source: "/images/:theme(day|night)/:asset([A-Z_]+[.][a-f0-9]{12}[.]webp)",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }];
  },
  async redirects() {
    return [...canonicalHomeRedirects(), ...appLegacyAliasRedirects(), ...legacyModuleRedirects()];
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
