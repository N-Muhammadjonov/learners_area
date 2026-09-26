/**
 * Deployment identity in one place: origin, trusted origins, framing and the
 * remote origins the browser is allowed to talk to.
 *
 * The centre may move to another domain, and the hosted preview serves the app
 * from a different origin than the production domain. Both facts belong here
 * rather than being spread across middleware, cookie code and CSP strings.
 *
 * Nothing in this module is a secret — it is all origin/host metadata that is
 * visible in the browser anyway.
 */

/** Normalises a configured origin: trims, drops a trailing slash. */
function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  return trimmed;
}

function listFromEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter((entry): entry is string => Boolean(entry));
}

/**
 * The canonical public origin, e.g. `https://learnersarea.uz`.
 *
 * `NEXT_PUBLIC_APP_URL` is the historical name and stays supported; `PUBLIC_BASE_URL`
 * is the name new deployments should set. When neither is configured the app is
 * served from whatever host the request arrives on, which is what development
 * and the hosted preview rely on.
 */
export const publicBaseUrl =
  normalizeOrigin(process.env.PUBLIC_BASE_URL) ?? normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL);

/**
 * Extra origins allowed to send state-changing requests (CSRF origin check) and
 * to frame the app. The hosted preview embeds the app in a frame on another
 * site, so it must be listed explicitly instead of opening framing to `*`.
 */
export const trustedOrigins = [
  ...listFromEnv("TRUSTED_ORIGINS"),
  ...(publicBaseUrl ? [publicBaseUrl] : []),
];

/**
 * Origins allowed to embed the app in an iframe.
 *
 * `'self'` is always allowed. A deployment that is embedded anywhere else (the
 * hosted preview, an LMS shell) adds that origin to `ALLOWED_FRAME_ANCESTORS`.
 * When nothing is configured we keep the historical `https:` fallback so a
 * preview of an unconfigured deployment still renders, and the value is
 * written into the CSP so the choice is visible rather than implicit.
 */
/** Explicitly configured embedders, if the deployment names any. */
const configuredFrameAncestors = (process.env.ALLOWED_FRAME_ANCESTORS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

/**
 * Who may embed the app in a frame — decided per request.
 *
 * Two deployments have to coexist:
 *   - a real deployment on its own domain, where nobody should be able to frame
 *     the centre (clickjacking protection), and
 *   - a development / hosted-preview deployment served on a host that is not the
 *     canonical origin and legitimately rendered inside an embedding shell.
 *
 * So: an explicit configuration wins; otherwise framing is locked to `'self'`
 * when the request arrives on the canonical host, and stays possible for other
 * hosts (which is what makes the preview render). Nothing is ever opened to `*`.
 */
export function frameAncestorsFor(host: string | null): string[] {
  if (configuredFrameAncestors.length > 0) return ["'self'", ...configuredFrameAncestors];
  return isCanonicalHost(host) ? ["'self'"] : ["'self'", "https:"];
}

/**
 * Additional origins the browser may open a connection to (fetch, XHR, media).
 *
 * Direct-to-R2 uploads and private media reads use the storage endpoint, which
 * lives on a different origin than the app, so it has to be allowed here.
 */
export const connectSrcOrigins: string[] = [
  ...listFromEnv("CSP_CONNECT_SRC"),
  ...(process.env.R2_ENDPOINT ? [normalizeOrigin(process.env.R2_ENDPOINT)].filter(Boolean) as string[] : []),
];

/** Public video providers the app is willing to embed. */
export const allowedVideoHosts = ["www.youtube-nocookie.com", "www.youtube.com", "youtube.com", "youtu.be"];

/** True when the request host is the canonical public origin. */
export function isCanonicalHost(host: string | null): boolean {
  if (!host || !publicBaseUrl) return false;
  try {
    return new URL(publicBaseUrl).host === host;
  } catch {
    return false;
  }
}
