import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpsServer, request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertPublicHost,
  checkProviderBaseUrl,
  createPinnedLookup,
  createPinnedRequestOptions,
  isPrivateAddress,
  resolvePublicHost,
} from "../src/lib/services/coach/providers/shared/ssrf";

function createLocalTestCertificate() {
  const directory = mkdtempSync(join(tmpdir(), "riwi-ssrf-test-"));
  const certificatePath = join(directory, "certificate.pem");
  const keyPath = join(directory, "private-key.pem");
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1",
      "-keyout", keyPath, "-out", certificatePath, "-subj", "/CN=riwi-ssrf.test",
      "-addext", "subjectAltName=DNS:riwi-ssrf.test"], { stdio: "ignore" });
    return { certificate: readFileSync(certificatePath), privateKey: readFileSync(keyPath) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const { certificate: testCertificate, privateKey: testPrivateKey } = createLocalTestCertificate();
const publicV4 = "93.184.216.34";

function listen(server: ReturnType<typeof createHttpsServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("test server did not bind TCP"));
      resolve(address.port);
    });
  });
}

function nativeRequest(url: URL, options: Parameters<typeof httpsRequest>[1], body = "{}") {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = httpsRequest(url, options, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("address policy permits public IPv4/IPv6 and rejects local, special, metadata, and transition ranges", () => {
  for (const address of ["8.8.8.8", publicV4, "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPrivateAddress(address), false, `${address} should be eligible for an outbound provider connection`);
  }
  for (const address of [
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "100.127.255.254", "127.0.0.1", "169.254.1.2",
    "169.254.169.254", "172.16.0.1", "172.31.255.254", "192.0.0.8", "192.0.2.1",
    "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "64:ff9b::a9fe:a9fe",
    "2001::1", "2001:1ff::1", "2001:db8::1", "2002::1", "3fff::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "not-an-ip",
  ]) assert.equal(isPrivateAddress(address), true, `${address} must be denied`);
});

test("shared HTTPS transport permits only generic version headers beyond its fixed allowlist", () => {
  const url = new URL("https://api.example.test/v1");
  const addresses = [{ address: publicV4, family: 4 }] as const;
  const options = createPinnedRequestOptions(url, addresses, { headers: { "x-service-version": "2026-01-01" } });
  assert.equal((options.headers as Record<string, string>)["x-service-version"], "2026-01-01");
  assert.throws(() => createPinnedRequestOptions(url, addresses, { headers: { "x-unregistered-header": "value" } }), /url_refused/);
  assert.throws(() => createPinnedRequestOptions(url, addresses, { headers: { "x-service-version": "bad\r\nheader" } }), /url_refused/);
});

test("static URL policy rejects malformed, HTTP, credentials, internal names, odd ports, query/fragment and non-allowlisted hosts", () => {
  assert.equal(checkProviderBaseUrl("https://api.example.com/v1").ok, true);
  assert.equal(checkProviderBaseUrl("https://api.example.com./v1", ["api.example.com"]).ok, true, "trailing dot canonicalizes before allowlist matching");
  assert.equal(checkProviderBaseUrl("https://api.example.com/v1", ["other.example.com"]).ok, false);
  for (const url of [
    "not a url", "http://api.example.com/v1", "https://user:secret@api.example.com/v1", "https://@api.example.com/v1", "https://:@api.example.com/v1",
    "https://localhost/v1", "https://foo.localhost/v1", "https://metadata.google.internal/",
    "https://127.1/v1", "https://2130706433/v1", "https://10.0.0.1/v1", "https://[::1]/v1",
    "https://api.example.com:8443/v1", "https://api.example.com/v1?key=secret", "https://api.example.com/v1#fragment",
    "file:///etc/passwd", "https://internal/v1", "https://svc.local/v1", "https://api.localdomain/v1",
  ]) assert.equal(checkProviderBaseUrl(url).ok, false, url);
});

test("all DNS answers are checked; DNS failure, empty answers, malformed answers and timeout fail closed", async () => {
  assert.deepEqual(await resolvePublicHost("api.example.com", async () => [{ address: publicV4, family: 4 }]), [{ address: publicV4, family: 4 }]);
  assert.deepEqual(await resolvePublicHost("api.example.com", async () => [{ address: "2606:4700:4700::1111", family: 6 }]), [{ address: "2606:4700:4700::1111", family: 6 }]);
  assert.equal(await resolvePublicHost("api.example.com", async () => [
    { address: publicV4, family: 4 }, { address: "10.0.0.7", family: 4 },
  ]), null, "one private answer poisons the entire DNS result");
  assert.equal(await resolvePublicHost("api.example.com", async () => [{ address: "169.254.169.254", family: 4 }]), null, "metadata answer denied");
  assert.equal(await resolvePublicHost("api.example.com", async () => [{ address: publicV4, family: 6 }]), null, "family mismatch denied");
  assert.equal(await resolvePublicHost("api.example.com", async () => []), null);
  assert.equal(await resolvePublicHost("api.example.com", async () => { throw new Error("ENOTFOUND"); }), null);
  assert.equal(await resolvePublicHost("api.example.com", () => new Promise(() => {}), { timeoutMs: 10 }), null);
  const controller = new AbortController();
  const abortedLookup = resolvePublicHost("api.example.com", () => new Promise(() => {}), { signal: controller.signal, timeoutMs: 1_000 });
  controller.abort();
  assert.equal(await abortedLookup, null, "aborting DNS validation fails closed");
  assert.equal(await assertPublicHost("api.example.com", async () => [{ address: publicV4, family: 4 }, { address: "127.0.0.1", family: 4 }]), false);
});

test("DNS rebinding is closed: the socket-time lookup returns only the validated snapshot and never asks DNS again", async () => {
  let resolverCalls = 0;
  const rebindingResolver = async () => {
    resolverCalls += 1;
    return resolverCalls === 1
      ? [{ address: publicV4, family: 4 }]
      : [{ address: "127.0.0.1", family: 4 }];
  };
  const validated = await resolvePublicHost("provider.rebind.example", rebindingResolver);
  assert.deepEqual(validated, [{ address: publicV4, family: 4 }]);
  const connectionTimeLookup = createPinnedLookup("provider.rebind.example", validated!);
  const socketAnswer = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
    connectionTimeLookup("provider.rebind.example", { all: true, family: 0 }, (error, answer) => {
      if (error) return reject(error);
      if (!Array.isArray(answer)) return reject(new Error("all=true must return an address array"));
      resolve(answer);
    });
  });
  assert.deepEqual(socketAnswer, [{ address: publicV4, family: 4 }]);
  assert.equal(resolverCalls, 1, "the connection-time path must not re-resolve the hostname");
  await assert.rejects(new Promise((resolve, reject) => {
    connectionTimeLookup("attacker.example", { all: true, family: 0 }, (error, answer) => {
      if (error) return reject(error);
      resolve(answer);
    });
  }), { code: "ENOTFOUND" }, "lookup cannot be reused for a different host");
});

test("the pinned callback is used by a real HTTPS socket while TLS verifies the original hostname; redirects are not followed", async () => {
  const requestedSni: string[] = [];
  const requests: string[] = [];
  const server = createHttpsServer({ key: testPrivateKey, cert: testCertificate }, (request, response) => {
    requests.push(request.url ?? "");
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "https://attacker.example/" });
      response.end("redirect");
      return;
    }
    if (request.url === "/hang") return;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ connected: true }));
  });
  server.on("secureConnection", (socket) => requestedSni.push((socket as typeof socket & { servername?: string }).servername ?? ""));
  const port = await listen(server);
  const url = new URL(`https://riwi-ssrf.test:${port}/ok`);
  const localPin = [{ address: "127.0.0.1", family: 4 }] as const;
  const connectionOptions = createPinnedRequestOptions(url, localPin, {
    headers: { "Content-Type": "application/json" }, timeoutMs: 2_000,
  });

  try {
    const response = await nativeRequest(url, { ...connectionOptions, ca: testCertificate });
    assert.deepEqual(response, { status: 200, text: JSON.stringify({ connected: true }) });
    assert.deepEqual(requestedSni, ["riwi-ssrf.test"], "TLS SNI preserves the configured hostname");
    assert.deepEqual(requests, ["/ok"]);
    assert.equal(connectionOptions.rejectUnauthorized, true, "certificate verification stays explicitly enabled");
    assert.equal(connectionOptions.servername, "riwi-ssrf.test");

    const redirectUrl = new URL(url);
    redirectUrl.pathname = "/redirect";
    const redirect = await nativeRequest(redirectUrl, { ...createPinnedRequestOptions(redirectUrl, localPin, { headers: {} }), ca: testCertificate });
    assert.equal(redirect.status, 302);
    assert.deepEqual(requests, ["/ok", "/redirect"], "native HTTPS does not follow the Location target");

    const wrongIdentity = createPinnedRequestOptions(url, localPin, { headers: {} });
    wrongIdentity.servername = "not-riwi-ssrf.test";
    await assert.rejects(nativeRequest(url, { ...wrongIdentity, ca: testCertificate }), /altname|hostname|certificate/i);

    const abortController = new AbortController();
    const hangingUrl = new URL(url);
    hangingUrl.pathname = "/hang";
    const hanging = nativeRequest(hangingUrl, {
      ...createPinnedRequestOptions(hangingUrl, localPin, { headers: {}, signal: abortController.signal, timeoutMs: 5_000 }),
      ca: testCertificate,
    });
    setTimeout(() => abortController.abort(), 20);
    await assert.rejects(hanging, /aborted|abort/i, "an aborted provider request closes its pinned HTTPS request");

    const timed = nativeRequest(hangingUrl, {
      ...createPinnedRequestOptions(hangingUrl, localPin, { headers: {}, signal: AbortSignal.timeout(30), timeoutMs: 5_000 }),
      ca: testCertificate,
    });
    await assert.rejects(timed, /aborted|timeout|timed out/i, "a deadline signal aborts a stalled request");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
