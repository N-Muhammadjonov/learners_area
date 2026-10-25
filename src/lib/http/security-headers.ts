import type { NextResponse } from "next/server";
import { connectSrcOrigins, frameAncestorsFor, mediaSrcOrigins } from "@/lib/config/site";

/**
 * Response security headers, built in one place.
 *
 * Why a nonce: Next.js injects its own inline bootstrap scripts, so a policy
 * without `'unsafe-inline'` needs a per-request nonce. Next reads the
 * `Content-Security-Policy` request header and stamps that nonce onto the
 * scripts it writes, which is why the middleware sets the same policy value on
 * the request and on the response.
 *
 * Everything the app legitimately needs is named explicitly:
 *   - `blob:`/`data:` for recorded audio playback (MediaRecorder) and previews;
 *   - the storage endpoint for direct-to-R2 uploads and private media reads;
 *   - the YouTube embed origins, and only those, for public video lessons.
 *
 * Nothing is opened to `*`.
 */

export type CspOptions = {
  nonce: string;
  /** `true` on an HTTPS request — enables `upgrade-insecure-requests` and HSTS. */
  secure: boolean;
  /** `true` during `next dev`, where HMR needs eval. */
  dev: boolean;
  /**
   * Host the request arrived on. Framing is decided from it: a deployment on its
   * canonical origin is locked to `'self'`, a preview/dev host may be embedded
   * (see `frameAncestorsFor`).
   */
  host?: string | null;
};

export function buildCsp({ nonce, secure, dev, host = null }: CspOptions): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "https://esm.sh"];
  // React Refresh and the webpack dev runtime evaluate code at runtime. This is
  // a development-only allowance; production never gets `'unsafe-eval'`.
  if (dev) scriptSrc.push("'unsafe-eval'");

  const connectSrc = ["'self'", "https://esm.sh", ...connectSrcOrigins];
  if (dev) connectSrc.push("ws:", "wss:");

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors ${frameAncestorsFor(host).join(" ")}`,
    `form-action 'self'`,
    `script-src ${scriptSrc.join(" ")}`,
    // Next.js and Tailwind both emit inline <style>/style attributes; styles
    // cannot exfiltrate data the way scripts can, and a nonce for styles is not
    // plumbed through the framework today. Recorded honestly rather than hidden.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `media-src 'self' blob: data: ${mediaSrcOrigins.join(" ")}`.trim(),
    `font-src 'self' data:`,
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
  ];
  if (secure) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export type SecurityHeaderOptions = CspOptions & {
  /** HSTS is only meaningful (and only safe) over a real HTTPS deployment. */
  hsts: boolean;
};

/** Applies the headers to a response that already exists (including redirects). */
export function applySecurityHeaders(res: NextResponse, options: SecurityHeaderOptions): NextResponse {
  const csp = buildCsp(options);
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    // Microphone stays available: speaking practice records locally and only the
    // transcript is evaluated. Nothing else is granted.
    "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)"
  );
  res.headers.set("X-DNS-Prefetch-Control", "off");
  // NOTE: no `Cross-Origin-Opener-Policy` here on purpose. The app is rendered
  // inside an embedding frame on some deployments (see src/lib/config/site.ts);
  // COOP would sever that relationship and pop the app out of its shell.
  if (options.hsts) {
    res.headers.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  return res;
}
