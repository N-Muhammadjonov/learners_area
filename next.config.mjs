/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
};

export default nextConfig;
