import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { archiveFile, findManifestPath, readTransportArchive } from "../src/lib/import/zip-transport";
import { registerImportDescriptors } from "../src/lib/import/capabilities";
import { parseContentPackage } from "../src/lib/import/core/parse";
import { listeningExample } from "../src/lib/import/listening/canonical";

/**
 * ZIP is a TRANSPORT CONTAINER (spec §17): the canonical JSON may arrive inside an
 * archive together with the binaries it declares, and selecting that archive must
 * behave exactly like selecting the JSON and the media separately. An archive
 * without a canonical manifest belongs to the legacy HTML pipeline and is refused
 * here — a ZIP never becomes an application.
 */

// The core parser is module-agnostic: descriptors must be registered first, which
// is exactly what every server entry point does before parsing.
registerImportDescriptors();

test("TR1 manifest discovery accepts the canonical names, a single package folder, and nothing else", () => {
  assert.equal(findManifestPath(["manifest.json"]), "manifest.json");
  assert.equal(findManifestPath(["./package.json"]), "package.json", "a leading ./ is not a different file");
  assert.equal(findManifestPath(["audit/notes.txt", "data/package.json"]), "data/package.json");
  assert.equal(findManifestPath(["listening-test-11/manifest.json", "listening-test-11/audio/full.mp3"]), "listening-test-11/manifest.json");
  assert.equal(findManifestPath(["LISTENING-TEST-11/Manifest.JSON"]), "LISTENING-TEST-11/Manifest.JSON", "case-insensitive");
  assert.equal(findManifestPath(["index.html", "audio.mp3", "data/metadata.json"]), null, "a legacy HTML ZIP is not a canonical transport");
  assert.equal(findManifestPath([]), null);
});

test("TR2 a canonical ZIP yields its manifest, its files, and case-insensitive asset lookup", async () => {
  const manifest = { ...listeningExample(), sourceRef: "listening-transport-qa" };
  const archive = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "audio/full.mp3": new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]),
    "images/map.webp": new Uint8Array([0x52, 0x49, 0x46, 0x46]),
  });
  const read = await readTransportArchive(archive);
  assert.equal(read.manifestPath, "manifest.json");
  assert.deepEqual(Object.keys(read.files).sort(), ["audio/full.mp3", "images/map.webp", "manifest.json"]);

  const parsed = parseContentPackage(read.manifest);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.ok ? [] : parsed.report.issues));
  if (!parsed.ok) return;
  assert.equal(parsed.pkg.sourceRef, "listening-transport-qa");

  // The declared paths are hints INSIDE the container: lookup is case-insensitive
  // and tolerates the single wrapper folder an exported package usually has.
  assert.equal(archiveFile(read.files, "AUDIO/Full.MP3")?.byteLength, 6);
  assert.equal(archiveFile(read.files, "images/map.webp")?.byteLength, 4);
  assert.equal(archiveFile(read.files, "audio/other.mp3"), null);
  const wrapped = await readTransportArchive(
    zipSync({ "exported/manifest.json": strToU8(JSON.stringify(manifest)), "exported/audio/full.mp3": new Uint8Array([1, 2, 3]) }),
  );
  assert.equal(wrapped.manifestPath, "exported/manifest.json");
  assert.equal(archiveFile(wrapped.files, "audio/full.mp3")?.byteLength, 3);
});

test("TR3 an archive without a canonical manifest, or with an unreadable one, is refused", async () => {
  const legacy = zipSync({ "index.html": strToU8("<h1>Authored</h1><input id='l1'>"), "audio.mp3": new Uint8Array([1]) });
  await assert.rejects(readTransportArchive(legacy), /no canonical manifest\.json/);

  const broken = zipSync({ "manifest.json": strToU8("{ not json") });
  await assert.rejects(readTransportArchive(broken), /manifest is not valid JSON/);

  const binaryManifest = zipSync({ "manifest.json": new Uint8Array([0xff, 0xfe, 0x00]) });
  await assert.rejects(readTransportArchive(binaryManifest), /manifest is not valid JSON/);
});

test("TR4 an aborted read stops before inflating anything, and never leaves a worker behind", async () => {
  const manifest = { ...listeningExample(), sourceRef: "listening-abort-qa" };
  const archive = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), "audio/full.mp3": new Uint8Array(1024) });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readTransportArchive(archive, controller.signal), (error: unknown) => {
    assert.equal((error as { name?: string }).name, "AbortError");
    return true;
  });
});

test("TR5 hostile archive contents are refused before any of it is read", async () => {
  const manifest = JSON.stringify({ ...listeningExample(), sourceRef: "listening-hostile-qa" });
  const traversal = zipSync({ "../manifest.json": strToU8(manifest), "manifest.json": strToU8(manifest) });
  await assert.rejects(readTransportArchive(traversal), /Unsafe ZIP path/);

  const duplicate = zipSync({ "manifest.json": strToU8(manifest), "MANIFEST.JSON": strToU8("{}") });
  await assert.rejects(readTransportArchive(duplicate), /Duplicate ZIP filename/);
});

test("TR6 the transport reader and the canonical parser agree on what a package is", async () => {
  const manifest = { ...listeningExample(), sourceRef: "listening-transport-identity" };
  const archive = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)) });
  const viaZip = await readTransportArchive(archive);
  const fromZip = parseContentPackage(viaZip.manifest);
  const fromJson = parseContentPackage(manifest);
  assert.equal(fromZip.ok, true);
  assert.equal(fromJson.ok, true);
  if (!fromZip.ok || !fromJson.ok) return;
  assert.equal(
    JSON.stringify(fromZip.pkg.content) === JSON.stringify(fromJson.pkg.content),
    true,
    "the container changes nothing about the payload",
  );
  assert.equal(fromZip.pkg.sourceRef, fromJson.pkg.sourceRef);
});
