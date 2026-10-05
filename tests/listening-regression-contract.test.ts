import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Listening storage transport keeps signed R2/S3 requests same-origin with a direct fallback", () => {
  const provider = read("src/lib/services/storage/s3-provider.ts");
  const config = read("next.config.mjs");
  const client = read("src/lib/uploads/client.ts");
  const intent = read("src/app/api/uploads/intent/route.ts");

  assert.match(provider, /endpointProxyUrl\(uploadUrl, "upload"\)/);
  assert.match(provider, /fallbackUploadUrl: uploadUrl/);
  assert.match(provider, /endpointProxyUrl\(signedUrl, "read"\)/);
  assert.match(config, /source: "\/__storage-upload\/:path\*"/);
  assert.match(config, /source: "\/__storage-read\/:path\*"/);
  assert.match(client, /fallbackUploadUrl: string \| null/);
  assert.match(client, /return sendDirect\(intent\.fallbackUploadUrl\)/);
  assert.match(intent, /fallbackUploadUrl: result\.fallbackUploadUrl/);
});

test("package-owned Listening audio remains authorized even for imports without a resource-block mirror", () => {
  const uploads = read("src/lib/data/uploads.ts");
  assert.match(uploads, /db\.query\.listeningPackages\.findFirst/);
  assert.match(uploads, /eq\(listeningPackages\.audioObjectKey, objectKey\)/);
  assert.match(uploads, /eq\(listeningPackages\.imageObjectKey, objectKey\)/);
  assert.match(uploads, /loadResourceOwner\("listening", listeningPackage\.testId\)/);
  assert.match(uploads, /mayReadResources\(caller\.role, owner\)/);
});

test("authored Listening opens before study-progress queries that its runtime does not need", () => {
  const page = read("src/app/(app)/listening/tests/[id]/page.tsx");
  const authored = page.indexOf("if (detail.pkg.payload.authoredRuntime)");
  const progress = page.indexOf("fullListeningProgress(user.id, id)");
  assert.ok(authored >= 0, "authored runtime branch is missing");
  assert.ok(progress > authored, "authored runtime must return before study progress is queried");
});

test("outer Listening library keeps the approved underline tabs and three-column desktop geometry", () => {
  const css = read("src/app/globals.css");
  const activeRules =
    css.match(/\.listening-collection-tabs button\[aria-pressed="true"\]\s*\{[^}]*\}/g) ?? [];
  assert.ok(activeRules.length >= 1, "active collection tab rule is missing");
  for (const rule of activeRules) {
    assert.doesNotMatch(rule, /background\s*:/, "active collection tabs must not become a filled purple block");
  }
  assert.match(
    css,
    /@media\(min-width:640px\)\{\.full-listening-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);\}\}/,
  );
  assert.doesNotMatch(css, /\.full-listening-grid\{grid-template-columns:repeat\(4,/);
});

test("private resource redirects normalize same-origin signed read paths to an absolute deployment URL", () => {
  const route = read("src/app/api/resources/[...key]/route.ts");
  assert.match(route, /signed\.startsWith\("\/"\) \? new URL\(signed, req\.url\) : signed/);
  assert.match(route, /NextResponse\.redirect\(location, \{ status: 302 \}\)/);
});
