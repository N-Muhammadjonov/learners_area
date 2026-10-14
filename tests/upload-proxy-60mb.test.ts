import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PROXY_UPLOAD_MAX_BYTES,
  UPLOAD_RULES,
  validateUploadFile,
} from "../src/lib/validation/uploads";

const MIB = 1024 * 1024;
const CONFIG = new URL("../next.config.mjs", import.meta.url).href;
const root = fileURLToPath(new URL("../", import.meta.url));

function nextBodyLimit(provider: string, appEnv: string): unknown {
  // Evaluate the actual Next.js config in an isolated process; Next reads its
  // env at module import, so tests must not mutate other tests' global process.env.
  const program = `import config from ${JSON.stringify(CONFIG)}; console.log(JSON.stringify(config.experimental?.middlewareClientMaxBodySize ?? null));`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", program], {
    cwd: root,
    env: { ...process.env, STORAGE_PROVIDER: provider, APP_ENV: appEnv },
    encoding: "utf8",
  }).trim());
}

test("proxy-60: local-storage production and development permit 60 MiB files plus multipart overhead", () => {
  assert.equal(PROXY_UPLOAD_MAX_BYTES, 60 * MIB);
  for (const appEnv of ["production", "development"]) {
    assert.equal(nextBodyLimit("local", appEnv), "61mb", `${appEnv} must not fall back to the 10 MB Next clone`);
  }
});

test("proxy-60: R2/S3 stay direct and do not expand global request buffering", () => {
  for (const provider of ["r2", "s3"]) {
    assert.equal(nextBodyLimit(provider, "production"), null);
  }
});

test("proxy-60: audio/file default policy permits 60 MiB but refuses 60 MiB + 1 byte", () => {
  for (const [category, filename, contentType] of [
    ["audio", "listening.mp3", "audio/mpeg"],
    ["file", "Listening Test 1.zip", "application/zip"],
  ] as const) {
    if (process.env[category === "audio" ? "MAX_AUDIO_UPLOAD_MB" : "MAX_FILE_UPLOAD_MB"]) continue;
    assert.equal(UPLOAD_RULES[category].maxBytes, 60 * MIB);
    assert.equal(validateUploadFile({ category, filename, contentType, size: 60 * MIB }).ok, true);
    assert.deepEqual(validateUploadFile({ category, filename, contentType, size: 60 * MIB + 1 }),
      { ok: false, error: "file_too_large" });
  }
  // Existing image guard does not change when the transport limit increases.
  if (!process.env.MAX_IMAGE_UPLOAD_MB) assert.equal(UPLOAD_RULES.image.maxBytes, 10 * MIB);
});

test("proxy-60: upload intent and proxy route both reject beyond 60 MiB", () => {
  const intent = readFileSync(new URL("../src/lib/data/uploads.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/uploads/route.ts", import.meta.url), "utf8");
  assert.match(intent, /!direct && input\.size > PROXY_UPLOAD_MAX_BYTES/);
  assert.match(intent, /status: 413, error: "file_too_large"/);
  assert.match(route, /file\.size > PROXY_UPLOAD_MAX_BYTES/);
  assert.match(route, /error: "file_too_large".*status: 413/);
  assert.match(route, /requireActiveUser\(\)/);
  assert.match(route, /intent\.userId !== user\.id/);
  assert.match(route, /validateUploadFile\(/);
});
