import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasDictionaryAdapter,
  listLexicalSources,
  registerLexicalSource,
  resolveFromSources,
  type LexicalSource,
} from "../src/lib/services/lexical/enrichment";

/**
 * The dictionary boundary.
 *
 * No dictionary is installed, and these tests exist to keep that honest: the
 * boundary must be able to say "nobody knows this word" instead of filling the
 * gap with a guess. The catalogue itself is checked separately against the
 * database; here the adapters and their rules are the subject.
 */

const draft = (term: string, definitionEn: string) => ({
  term,
  partOfSpeech: "noun",
  definitionEn,
  translationUz: null,
  exampleSentence: null,
  collocations: null,
  acceptedTranslations: [],
});

test("with no adapter registered there is no dictionary, and no guess", async () => {
  assert.equal(hasDictionaryAdapter(), false);
  assert.deepEqual(listLexicalSources(), []);
  assert.equal(await resolveFromSources("resilient", []), null);
});

test("a disabled adapter is never queried", async () => {
  let asked = 0;
  const dormant: LexicalSource = {
    id: "dormant",
    label: "Dormant dictionary",
    isEnabled: () => false,
    lookup: async () => {
      asked += 1;
      return draft("x", "should never be used");
    },
  };
  assert.equal(await resolveFromSources("resilient", [dormant]), null);
  assert.equal(asked, 0);
});

test("the first enabled adapter that knows the word wins, and is credited", async () => {
  const first: LexicalSource = {
    id: "first",
    label: "First dictionary",
    isEnabled: () => true,
    lookup: async (term) => (term === "congestion" ? draft("congestion", "overcrowding of traffic") : null),
  };
  const second: LexicalSource = {
    id: "second",
    label: "Second dictionary",
    isEnabled: () => true,
    lookup: async () => draft("congestion", "a different, later answer"),
  };

  const entry = await resolveFromSources("congestion", [first, second]);
  assert.equal(entry?.definitionEn, "overcrowding of traffic");
  assert.equal(entry?.source, "first");
  assert.equal(entry?.sourceLabel, "First dictionary");
});

test("an adapter that throws is skipped rather than becoming a definition", async () => {
  const broken: LexicalSource = {
    id: "broken",
    label: "Broken dictionary",
    isEnabled: () => true,
    lookup: async () => {
      throw new Error("network down");
    },
  };
  const healthy: LexicalSource = {
    id: "healthy",
    label: "Healthy dictionary",
    isEnabled: () => true,
    lookup: async () => null,
  };

  assert.equal(await resolveFromSources("palimpsest", [broken, healthy]), null);
});

test("an adapter that answers with an empty definition is not accepted", async () => {
  const empty: LexicalSource = {
    id: "empty",
    label: "Empty dictionary",
    isEnabled: () => true,
    lookup: async (term) => draft(term, "   "),
  };
  assert.equal(await resolveFromSources("palimpsest", [empty]), null);
});

test("registering the same adapter twice does not duplicate it", () => {
  const adapter: LexicalSource = {
    id: "centre-extras",
    label: "Centre extras",
    isEnabled: () => true,
    lookup: async () => null,
  };
  registerLexicalSource(adapter);
  registerLexicalSource(adapter);
  registerLexicalSource({ ...adapter });

  assert.deepEqual(
    listLexicalSources().filter((source) => source.id === "centre-extras"),
    [{ id: "centre-extras", label: "Centre extras", enabled: true }]
  );
  // A registered-but-empty adapter still counts as a dictionary, and still
  // answers "unknown" instead of inventing anything.
  assert.equal(hasDictionaryAdapter(), true);
});
