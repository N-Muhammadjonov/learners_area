import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Outbound-URL guard for owner-configured AI endpoints (SSRF defence).
 *
 * Endpoints come ONLY from server-side deployment configuration — never from a
 * learner, a request body or the database. Even so, a mistyped or malicious
 * configuration must not let the server call into its own network:
 *
 *  static  https only · no credentials in the URL · default port only · no IP
 *          literal in a private/loopback/link-local/CGNAT/ULA/metadata range ·
 *          no localhost/.local/.internal/.localhost names · optional host allowlist
 *  runtime every resolved address of the host is public (checked right before
 *          each call) and redirects are refused by the transport (`redirect: "error"`)
 *
 * Residual risk (documented, not hidden): DNS can change between this lookup and
 * the socket connect (rebinding). Redirect refusal, https certificate validation
 * and the owner-only configuration path bound that risk.
 */

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet"];
const BLOCKED_NAMES = new Set(["localhost", "metadata", "metadata.google.internal", "instance-data"]);

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number, number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (family === 6) {
    const v = address.toLowerCase().replace(/^\[|\]$/g, "");
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd)/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff") || v.startsWith("64:ff9b:") || v.startsWith("2001:db8");
  }
  return true; // not an IP at all → never treated as a safe address
}

export function checkProviderBaseUrl(raw: string, allowHosts: readonly string[] = []): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "https is required" };
  if (url.username || url.password) return { ok: false, reason: "credentials in the URL are not allowed" };
  if (url.port && url.port !== "443") return { ok: false, reason: "only the default https port is allowed" };
  if (url.search || url.hash) return { ok: false, reason: "query strings and fragments are not allowed" };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) return { ok: false, reason: "private or reserved address" };
  } else {
    if (BLOCKED_NAMES.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix)) || !host.includes(".")) {
      return { ok: false, reason: "internal host name" };
    }
  }
  if (allowHosts.length && !allowHosts.map((h) => h.toLowerCase()).includes(host)) {
    return { ok: false, reason: "host is not in AI_COMPATIBLE_ALLOWED_HOSTS" };
  }
  return { ok: true, url };
}

type Lookup = (host: string) => Promise<Array<{ address: string }>>;
const defaultLookup: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true });

/** Every address the host resolves to must be public. */
export async function assertPublicHost(hostname: string, lookup: Lookup = defaultLookup): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const addresses = await lookup(host);
    return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}
