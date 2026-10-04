import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import { isIP } from "node:net";
import * as https from "node:https";
import type { ClientRequest, OutgoingHttpHeaders } from "node:http";

/**
 * Outbound URL and connection guard for the registered provider transports.
 *
 * Provider URLs originate only in fixed adapter code or server deployment
 * configuration. This module still rejects unsafe configuration at startup and
 * resolves every hostname immediately before each call. Crucially, the checked
 * DNS answer is then passed to Node's *connection-time* `lookup` callback for
 * `https.request`; the socket cannot perform a second independent DNS lookup.
 *
 * TLS still uses the original URL hostname for SNI and certificate identity
 * checks. Certificate verification is explicitly enabled, redirects are not
 * followed, and each request uses a fresh one-shot agent so a prior socket can
 * never be reused for a later endpoint decision.
 */

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };
export type ResolvedPublicAddress = { address: string; family: 4 | 6 };
export type HostLookup = (host: string) => Promise<Array<{ address: string; family?: number }>>;
export type PinnedLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;
export type PinnedLookup = (hostname: string, options: LookupOptions, callback: PinnedLookupCallback) => void;

const BLOCKED_SUFFIXES = [
  ".localhost", ".local", ".localdomain", ".internal", ".lan", ".home", ".corp", ".intranet",
];
const BLOCKED_NAMES = new Set([
  "localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback", "metadata", "metadata.google.internal", "instance-data",
]);

function stripBrackets(value: string): string {
  return value.replace(/^\[|\]$/g, "");
}

function normalizeHostname(value: string): string {
  return stripBrackets(value.trim()).toLowerCase().replace(/\.$/, "");
}

function ipv4Octets(value: string): number[] | null {
  if (isIP(value) !== 4) return null;
  const octets = value.split(".").map(Number);
  return octets.length === 4 && octets.every((item) => Number.isInteger(item) && item >= 0 && item <= 255) ? octets : null;
}

function inV4Range(value: number[], network: number[], prefix: number): boolean {
  let address = 0;
  let base = 0;
  for (let i = 0; i < 4; i += 1) {
    address = address * 256 + value[i]!;
    base = base * 256 + network[i]!;
  }
  const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
  return ((address >>> 0) & mask) === ((base >>> 0) & mask);
}

const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [number[], number]> = [
  [[0, 0, 0, 0], 8],          // this network / current network
  [[10, 0, 0, 0], 8],         // RFC1918
  [[100, 64, 0, 0], 10],      // carrier-grade NAT
  [[127, 0, 0, 0], 8],        // loopback
  [[169, 254, 0, 0], 16],     // link-local and cloud metadata services
  [[172, 16, 0, 0], 12],      // RFC1918
  [[192, 0, 0, 0], 24],       // IETF protocol assignments
  [[192, 0, 2, 0], 24],       // documentation
  [[192, 88, 99, 0], 24],     // deprecated 6to4 relay anycast
  [[192, 168, 0, 0], 16],     // RFC1918
  [[198, 18, 0, 0], 15],      // benchmarking
  [[198, 51, 100, 0], 24],    // documentation
  [[203, 0, 113, 0], 24],     // documentation
  [[224, 0, 0, 0], 4],        // multicast
  [[240, 0, 0, 0], 4],        // reserved / limited broadcast
];

function ipv6Bytes(value: string): number[] | null {
  const address = stripBrackets(value).toLowerCase();
  if (address.includes("%")) return null; // scoped/interface-local literals are never outbound targets
  if (isIP(address) !== 6) return null;
  const doubleColon = address.indexOf("::");
  if (doubleColon !== -1 && address.indexOf("::", doubleColon + 2) !== -1) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const tokens = side.split(":");
    const words: number[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (token.includes(".")) {
        if (index !== tokens.length - 1) return null;
        const octets = ipv4Octets(token);
        if (!octets) return null;
        words.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
        words.push(Number.parseInt(token, 16));
      }
    }
    return words;
  };

  let words: number[];
  if (doubleColon < 0) {
    const parsed = parseSide(address);
    if (!parsed || parsed.length !== 8) return null;
    words = parsed;
  } else {
    const left = parseSide(address.slice(0, doubleColon));
    const right = parseSide(address.slice(doubleColon + 2));
    if (!left || !right) return null;
    const zeros = 8 - left.length - right.length;
    if (zeros < 1) return null;
    words = [...left, ...Array.from({ length: zeros }, () => 0), ...right];
  }
  if (words.length !== 8) return null;
  return words.flatMap((word) => [(word >>> 8) & 0xff, word & 0xff]);
}

function startsWithBytes(bytes: number[], prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function isPrivateIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address);
  if (!bytes) return true;
  if (bytes.every((byte) => byte === 0)) return true; // unspecified
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true; // loopback

  // IPv4-mapped IPv6: apply the same full IPv4 deny list to either textual form,
  // including the hexadecimal form such as ::ffff:7f00:1.
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    const v4 = bytes.slice(12).join(".");
    return isPrivateAddress(v4);
  }

  // Only global-unicast space is eligible. This excludes ULA, link-local,
  // multicast, IPv4-compatible, NAT64 local-use and other special ranges.
  if ((bytes[0]! & 0xe0) !== 0x20) return true; // not within 2000::/3
  if (startsWithBytes(bytes, [0x20, 0x02])) return true; // 6to4 can tunnel to embedded IPv4 networks
  if (startsWithBytes(bytes, [0x20, 0x01]) && ((bytes[2]! << 8) | bytes[3]!) <= 0x01ff) return true; // IETF protocol assignments (2001::/23)
  if (startsWithBytes(bytes, [0x20, 0x01, 0x0d, 0xb8])) return true; // documentation (2001:db8::/32)
  if (startsWithBytes(bytes, [0x3f, 0xff]) && (bytes[2]! & 0xf0) === 0) return true; // documentation (3fff::/20)
  return false;
}

/** True for private, reserved, or non-IP targets; malformed input fails closed. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(stripBrackets(address));
  if (family === 4) {
    const octets = ipv4Octets(stripBrackets(address));
    return !octets || BLOCKED_IPV4_RANGES.some(([network, prefix]) => inV4Range(octets, network, prefix));
  }
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return !host || BLOCKED_NAMES.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix)) || !host.includes(".");
}

function normalizedAllowHosts(allowHosts: readonly string[]): string[] {
  return allowHosts.map(normalizeHostname).filter(Boolean);
}

export function checkProviderBaseUrl(raw: string, allowHosts: readonly string[] = []): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "https is required" };
  const rawAuthority = /^https:\/\/([^/?#]*)/i.exec(raw)?.[1] ?? "";
  if (url.username || url.password || rawAuthority.includes("@")) return { ok: false, reason: "credentials in the URL are not allowed" };
  if (url.port && url.port !== "443") return { ok: false, reason: "only the default https port is allowed" };
  if (url.search || url.hash) return { ok: false, reason: "query strings and fragments are not allowed" };

  const host = normalizeHostname(url.hostname);
  if (isIP(host)) {
    if (isPrivateAddress(host)) return { ok: false, reason: "private or reserved address" };
  } else if (isBlockedHostname(host)) {
    return { ok: false, reason: "internal host name" };
  }
  const permittedHosts = normalizedAllowHosts(allowHosts);
  if (allowHosts.length > 0 && (!permittedHosts.length || !permittedHosts.includes(host))) {
    return { ok: false, reason: "host is not in AI_COMPATIBLE_ALLOWED_HOSTS" };
  }
  // Canonicalize a DNS trailing dot once so DNS, HTTP Host and TLS identity all
  // refer to the same hostname; the address binding never changes TLS identity.
  if (!isIP(host) && url.hostname.toLowerCase() !== host) url.hostname = host;
  return { ok: true, url };
}

const defaultLookup: HostLookup = async (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * Resolve all A/AAAA records and reject the hostname unless every answer is a
 * public address. The returned immutable snapshot is what the socket connector
 * will use; it is not merely a preflight check.
 */
export async function resolvePublicHost(
  hostname: string,
  lookup: HostLookup = defaultLookup,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ResolvedPublicAddress[] | null> {
  const host = normalizeHostname(hostname);
  if (!host) return null;
  const literalFamily = isIP(host);
  if (literalFamily === 4 || literalFamily === 6) {
    return isPrivateAddress(host) ? null : [{ address: host, family: literalFamily }];
  }
  if (isBlockedHostname(host)) return null;
  if (options.signal?.aborted) return null;

  const timeoutMs = Math.max(1, Math.min(10_000, Math.floor(options.timeoutMs ?? 4_000)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("dns_timeout")), timeoutMs);
    });
    const aborted = options.signal
      ? new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("dns_aborted"));
        options.signal!.addEventListener("abort", onAbort, { once: true });
      })
      : new Promise<never>(() => {});
    const answers = await Promise.race([lookup(host), timeout, aborted]);
    if (!answers.length || answers.length > 32) return null;
    const normalized: ResolvedPublicAddress[] = [];
    const seen = new Set<string>();
    for (const answer of answers) {
      const address = stripBrackets(answer.address);
      const family = isIP(address);
      if ((family !== 4 && family !== 6) || (answer.family !== undefined && answer.family !== family) || isPrivateAddress(address)) return null;
      const key = `${family}:${address.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({ address, family });
    }
    return normalized.length ? normalized : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener("abort", onAbort);
  }
}

/** Every answer must be public; retained for configuration and focused tests. */
export async function assertPublicHost(hostname: string, lookup: HostLookup = defaultLookup): Promise<boolean> {
  return (await resolvePublicHost(hostname, lookup)) !== null;
}

function lookupError(code: string): NodeJS.ErrnoException {
  const error = new Error("Pinned provider hostname did not match the validated connection target") as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

/**
 * A Node `lookup` implementation backed only by an already-validated snapshot.
 * Node's HTTPS socket calls this when creating the TCP connection. It never
 * delegates to DNS and refuses a different hostname or family.
 */
export function createPinnedLookup(hostname: string, addresses: readonly ResolvedPublicAddress[]): PinnedLookup {
  const expectedHost = normalizeHostname(hostname);
  const snapshot = addresses.map((entry) => ({ ...entry }));
  return (requestedHostname, options, callback) => {
    if (normalizeHostname(requestedHostname) !== expectedHost || snapshot.length === 0) {
      callback(lookupError("ENOTFOUND"), options.all ? [] : "", 0);
      return;
    }
    const requestedFamily = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family ?? 0;
    const eligible = snapshot.filter((entry) => requestedFamily === 0 || entry.family === requestedFamily);
    if (!eligible.length) {
      callback(lookupError("ENOTFOUND"), options.all ? [] : "", 0);
      return;
    }
    if (options.all) callback(null, eligible.map((entry) => ({ address: entry.address, family: entry.family })));
    else callback(null, eligible[0]!.address, eligible[0]!.family);
  };
}

export type PinnedHttpsFailure = "url_refused" | "host_unavailable" | "aborted" | "timeout" | "redirect_refused" | "response_too_large" | "invalid_content_type";

export class PinnedHttpsError extends Error {
  constructor(public readonly code: PinnedHttpsFailure) {
    super(code);
    this.name = "PinnedHttpsError";
  }
}

export type PinnedHttpsResponse = { status: number; contentType: string; text: string };
export type PinnedHttpsHeaders = Record<string, string>;
export type PinnedHttpsOptions = {
  allowHosts?: readonly string[];
  lookup?: HostLookup;
  signal?: AbortSignal;
  timeoutMs?: number;
  dnsTimeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
};

const HEADER_ALLOWLIST = new Set(["authorization", "content-type", "anthropic-version", "accept"]);
const JSON_CONTENT_TYPE = /^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i;

function safeHeaders(input: PinnedHttpsHeaders): OutgoingHttpHeaders {
  const result: OutgoingHttpHeaders = { "accept-encoding": "identity" };
  for (const [rawName, value] of Object.entries(input)) {
    const name = rawName.toLowerCase();
    if (!HEADER_ALLOWLIST.has(name) || typeof value !== "string" || value.length > 2048 || /[\r\n\u0000]/.test(value)) {
      throw new PinnedHttpsError("url_refused");
    }
    result[name] = value;
  }
  return result;
}

/**
 * Build native HTTPS options for a previously validated address snapshot. The
 * only production caller is requestPinnedHttps, which resolves and validates
 * every address immediately before calling this low-level connection builder.
 */
export function createPinnedRequestOptions(
  url: URL,
  addresses: readonly ResolvedPublicAddress[],
  input: { headers: PinnedHttpsHeaders; signal?: AbortSignal; timeoutMs?: number },
): https.RequestOptions {
  if (url.protocol !== "https:" || !addresses.length || addresses.length > 32 || addresses.some((entry) =>
    (entry.family !== 4 && entry.family !== 6) || isIP(entry.address) !== entry.family)) {
    throw new PinnedHttpsError("url_refused");
  }
  const hostname = normalizeHostname(url.hostname);
  return {
    method: "POST",
    headers: safeHeaders(input.headers),
    // A fresh socket for this validated DNS snapshot; no stale pooled connection.
    agent: false,
    lookup: createPinnedLookup(hostname, addresses) as https.RequestOptions["lookup"],
    // Preserve the configured hostname for SNI and certificate identity checks.
    ...(isIP(hostname) ? {} : { servername: hostname }),
    rejectUnauthorized: true,
    signal: input.signal,
    timeout: Math.max(1, Math.min(30_000, Math.floor(input.timeoutMs ?? 20_000))),
    maxHeaderSize: 16 * 1024,
  };
}

/**
 * Send one bounded HTTPS POST. Redirects are rejected, TLS verification stays
 * on, response bytes are capped before decoding, and lookup at socket connect
 * is bound to the complete address set that passed the policy above.
 */
export async function requestPinnedHttps(
  rawUrl: string | URL,
  headers: PinnedHttpsHeaders,
  body: string,
  options: PinnedHttpsOptions = {},
): Promise<PinnedHttpsResponse> {
  const checked = checkProviderBaseUrl(String(rawUrl), options.allowHosts ?? []);
  if (!checked.ok) throw new PinnedHttpsError("url_refused");
  if (options.signal?.aborted) throw new PinnedHttpsError("aborted");
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new PinnedHttpsError("url_refused");
  const maxRequestBytes = Math.max(1, Math.min(512 * 1024, Math.floor(options.maxRequestBytes ?? 256 * 1024)));
  const requestBytes = Buffer.byteLength(body, "utf8");
  if (requestBytes > maxRequestBytes) throw new PinnedHttpsError("url_refused");

  const addresses = await resolvePublicHost(checked.url.hostname, options.lookup ?? defaultLookup, {
    signal: options.signal,
    timeoutMs: options.dnsTimeoutMs,
  });
  if (!addresses) throw new PinnedHttpsError(options.signal?.aborted ? "aborted" : "host_unavailable");

  const requestOptions = createPinnedRequestOptions(checked.url, addresses, {
    headers,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  const maxResponseBytes = Math.max(1, Math.min(512 * 1024, Math.floor(options.maxResponseBytes ?? 200 * 1024)));
  const timeoutMs = requestOptions.timeout ?? 20_000;

  return new Promise<PinnedHttpsResponse>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown, result?: PinnedHttpsResponse) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };

    let request: ClientRequest;
    try {
      request = https.request(checked.url, requestOptions, (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          finish(new PinnedHttpsError("redirect_refused"));
          return;
        }
        const rawContentType = response.headers["content-type"];
        const contentType = Array.isArray(rawContentType) ? rawContentType[0] ?? "" : rawContentType ?? "";
        if (status >= 200 && status < 300 && !JSON_CONTENT_TYPE.test(contentType)) {
          response.resume();
          finish(new PinnedHttpsError("invalid_content_type"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.byteLength;
          if (size > maxResponseBytes) {
            response.destroy();
            request.destroy(new PinnedHttpsError("response_too_large"));
            finish(new PinnedHttpsError("response_too_large"));
            return;
          }
          chunks.push(bytes);
        });
        response.on("error", (error) => finish(error));
        response.on("aborted", () => finish(new PinnedHttpsError("aborted")));
        response.on("end", () => finish(undefined, { status, contentType, text: Buffer.concat(chunks).toString("utf8") }));
      });
    } catch {
      finish(new PinnedHttpsError("host_unavailable"));
      return;
    }
    request.on("error", (error) => {
      if (options.signal?.aborted) finish(new PinnedHttpsError("aborted"));
      else if (error instanceof PinnedHttpsError) finish(error);
      else finish(new PinnedHttpsError("host_unavailable"));
    });
    timer = setTimeout(() => {
      const timeout = new PinnedHttpsError("timeout");
      request.destroy(timeout);
      finish(timeout);
    }, timeoutMs);
    request.end(body);
  });
}
