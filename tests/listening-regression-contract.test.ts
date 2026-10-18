import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Listening direct upload preserves the provider-signed URL and signed Content-Type", () => {
  const provider = read("src/lib/services/storage/s3-provider.ts");
  const config = read("next.config.mjs");
  const client = read("src/lib/uploads/client.ts");
  const intent = read("src/app/api/uploads/intent/route.ts");

  assert.match(provider, /return \{ uploadUrl, key, contentType, expiresInSeconds \}/);
  assert.doesNotMatch(provider, /endpointProxyUrl\(uploadUrl|fallbackUploadUrl/);
  assert.doesNotMatch(config, /__storage-upload/);
  assert.match(config, /source: "\/__storage-read\/:path\*"/);
  assert.match(client, /return sendDirect\(intent\.uploadUrl\)/);
  assert.match(client, /request\.setRequestHeader\("Content-Type", intent\.contentType\)/);
  assert.doesNotMatch(client, /fallbackUploadUrl/);
  assert.doesNotMatch(intent, /fallbackUploadUrl/);
});

test("package-owned Listening audio remains authorized even for imports without a resource-block mirror", () => {
  const uploads = read("src/lib/data/uploads.ts");
  assert.match(uploads, /db\.query\.listeningPackages\.findFirst/);
  assert.match(uploads, /eq\(listeningPackages\.audioObjectKey, objectKey\)/);
  assert.match(uploads, /eq\(listeningPackages\.imageObjectKey, objectKey\)/);
  assert.match(uploads, /loadResourceOwner\("listening", listeningPackage\.testId\)/);
  assert.match(uploads, /mayReadResources\(caller\.role, owner\)/);
  assert.match(uploads, /catch \(err\) \{[\s\S]*listening package ownership lookup unavailable/);
});

test("authored Listening opens before study-progress queries that its runtime does not need", () => {
  const page = read("src/app/app/(focus)/listening/tests/[id]/page.tsx");
  const authored = page.indexOf("if (detail.pkg.payload.authoredRuntime");
  // The hub reads study progress through the ONE learner-facts helper (`listeningLearnerFacts`,
  // which wraps `fullListeningProgress`): whichever name is in use, the read must come after
  // the authored-runtime branch, because that branch returns before any of it is needed.
  const progress = Math.max(
    page.indexOf("listeningLearnerFacts(user.id, id)"),
    page.indexOf("fullListeningProgress(user.id, id)"),
  );
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

test("private resource transport capabilities remain session bound and HEAD never reads a body", () => {
  const route = read("src/app/api/resources/[...key]/route.ts");
  assert.match(route, /getCurrentSessionAuthority\(\)/);
  assert.match(route, /authorizeResourceRead\(actorOf\(authority.user\),objectKey\)/);
  assert.match(route, /createMediaCapability/);
  assert.match(route, /NextResponse.redirect\(url,\{status:302,headers:privateHeaders\}\)/);
  assert.match(route, /if\(head\)return new NextResponse\(null,\{headers\}\)/);
  assert.doesNotMatch(route, /storage.read\(/);
});


test("authored Listening defers optional vocabulary metadata to a separately authorized read", () => {
  const route = read("src/app/api/listening/full/[id]/authored/route.ts");
  assert.match(route, /searchParams.get\('vocabulary'\)==='1'/);
  assert.match(route, /vocabulary:await listeningVocabularySession/);
  const main=route.slice(route.indexOf('const definition='));
  assert.doesNotMatch(main, /await listeningVocabularySession|await originalCourseStatus/);
  assert.match(main, /vocabulary:\[\]/);
  const client=read("src/components/listening/AuthoredListeningFrame.tsx");
  assert.match(client, /if\(!vocabularyRead.current\)vocabularyRead.current=fetch\(`/);
  assert.doesNotMatch(client.slice(client.indexOf('background.current=()=>'),client.indexOf('setAssets(media);setContent(data)')),/vocabulary=1/);
});
