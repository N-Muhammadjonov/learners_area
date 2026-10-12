import assert from "node:assert/strict";
import test from "node:test";
import { probeAudio } from "../../src/components/listening/ListeningImport";

test("leaving an import during metadata probing releases the audio and object URL immediately", async () => {
  const priorAudio = globalThis.Audio;
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  let released = 0;
  let unloaded = 0;
  class Probe {
    preload = "";
    src = "";
    onloadedmetadata: (() => void) | null = null;
    onerror: (() => void) | null = null;
    removeAttribute(name: string) {assert.equal(name, "src"); this.src = "";}
    load() {unloaded++;}
  }
  globalThis.Audio = Probe as unknown as typeof Audio;
  URL.createObjectURL = () => "blob:local-qa-probe";
  URL.revokeObjectURL = url => {assert.equal(url, "blob:local-qa-probe"); released++;};
  try {
    const controller = new AbortController();
    const result = probeAudio(new File(["audio"], "source.mp3"), controller.signal);
    controller.abort();
    await assert.rejects(result, {name: "AbortError"});
    assert.equal(released, 1);
    assert.equal(unloaded, 1);
  } finally {
    globalThis.Audio = priorAudio;
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
  }
});
