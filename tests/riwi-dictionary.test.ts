import assert from "node:assert/strict";
import test from "node:test";
import { extractDictionaryTerm, formatDictionaryAnswer, type DictionaryLookup } from "../src/lib/services/riwi/dictionary";

test("finite dictionary intent extraction isolates English, Uzbek, and Russian terms without inventing one", () => {
  assert.equal(extractDictionaryTerm("What does resilient mean?"), "resilient");
  assert.equal(extractDictionaryTerm("meaning of 'resilient'"), "resilient");
  assert.equal(extractDictionaryTerm("resilient so'zining ma'nosi nima?"), "resilient");
  assert.equal(extractDictionaryTerm("resilient tarjimasi?"), "resilient");
  assert.equal(extractDictionaryTerm("Что значит resilient?"), "resilient");
  assert.equal(extractDictionaryTerm("значение слова resilient"), "resilient");
  assert.equal(extractDictionaryTerm("Bu so'zning ma'nosi nima?"), null, "a generic placeholder is not mistaken for the requested term");
  assert.equal(extractDictionaryTerm("Please help me learn"), null);
});

test("dictionary answers use only supplied canonical facts and label unverified catalogue entries", () => {
  const entry: Extract<DictionaryLookup, { status: "resolved" }> = {
    status: "resolved", canonicalLexemeId: "aaaaaaaa-0000-4000-8000-000000000021", senseId: "aaaaaaaa-0000-4000-8000-000000000022",
    term: "resilient", definitionEn: "able to recover quickly", translationUz: "bardoshli",
    partOfSpeech: "adjective", lexicalType: null, example: "The team remained resilient.", collocations: "resilient community",
    source: "Learners Area catalogue", verified: false, pronunciation: "/rɪˈzɪliənt/", occurrence: null,
  };
  const result = formatDictionaryAnswer(entry, "en");
  assert.match(result.answer, /^resilient \(adjective\): able to recover quickly/);
  assert.match(result.answer, /Uzbek: bardoshli/);
  assert.match(result.answer, /Collocations: resilient community/);
  assert.match(result.answer, /Example: The team remained resilient\./);
  assert.match(result.uncertainty ?? "", /not been verified/i);
  assert.equal(formatDictionaryAnswer({ ...entry, verified: true }, "uz").uncertainty, null);
});
