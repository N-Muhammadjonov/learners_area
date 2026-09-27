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

/** Accept only HTTP(S) origins, never credentials, paths or CSP directives. */
export function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
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
export function configuredPublicOrigin(env: Record<string, string | undefined>): string | null {
  const value = env.PUBLIC_BASE_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim();
  const origin = normalizeOrigin(value);
  if (value && !origin) throw new Error("PUBLIC_BASE_URL must be an HTTP(S) origin without a path or credentials");
  return origin;
}

export const publicBaseUrl = configuredPublicOrigin(process.env);

/** APP_ENV is portable; VERCEL_ENV is only a deployment-adapter fallback. */
export function deploymentEnvironment(env: Record<string, string | undefined> = process.env) {
  const value = env.APP_ENV || env.VERCEL_ENV;
  if (value === "production" || value === "preview" || value === "development") return value;
  return env.NODE_ENV === "production" ? "production" : "development";
}

export const isPreviewDeployment = deploymentEnvironment() === "preview";

/**
 * Extra origins allowed to send state-changing requests (CSRF origin check) and
 * to frame the app. The hosted preview embeds the app in a frame on another
 * site, so it must be listed explicitly instead of opening framing to `*`.
 */
export const trustedOrigins = [
  ...listFromEnv("TRUSTED_ORIGINS"),
  ...(publicBaseUrl ? [publicBaseUrl] : []),
];

/** Embedding permission is explicit; an alternate domain grants no privilege. */
export function frameAncestorsFor(_host: string | null): string[] {
  return ["'self'", ...listFromEnv("ALLOWED_FRAME_ANCESTORS")];
}

/**
 * Additional origins the browser may open a connection to (fetch, XHR, media).
 *
 * Direct-to-R2 uploads and private media reads use the storage endpoint, which
 * lives on a different origin than the app, so it has to be allowed here.
 */
export const storageOrigins = [process.env.R2_ENDPOINT, process.env.S3_ENDPOINT]
  .map(normalizeOrigin).filter((origin): origin is string => Boolean(origin));
export const connectSrcOrigins = [...new Set([...listFromEnv("CSP_CONNECT_SRC"), ...storageOrigins])];

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
