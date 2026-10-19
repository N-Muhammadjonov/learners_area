import test from "node:test";
import assert from "node:assert/strict";
import { phraseTarget } from "../src/lib/services/lexical/phrase-target";

test("General lookup selects the same authored collocation from either word, ahead of nested single-word senses", () => {
  const text="The food poisoning caused alarm.";
  const rows=[{id:"food",startChar:4,endChar:8,surfaceForm:"food"},{id:"poisoning",startChar:9,endChar:18,surfaceForm:"poisoning"},{id:"phrase",startChar:4,endChar:18,surfaceForm:"food poisoning"}];
  for(const selected of [{start:4,end:8,clean:"food"},{start:9,end:18,clean:"poisoning"}]) {
    const target=phraseTarget(text,selected,rows);assert.equal(target.word,"food poisoning");assert.equal(target.occurrence?.id,"phrase");
  }
});
test("find out and separable/inflected forms cannot inherit an individual word's meaning", () => {
  for(const phrase of ["find out","find you out","found them out","finding it out","finds out"]) {
    const text=`They ${phrase} today.`;const start=text.indexOf(phrase),end=start+phrase.length;
    for(const selected of [{start,end:start+phrase.split(' ')[0]!.length,clean:phrase.split(' ')[0]!},{start:end-3,end,clean:"out"}]) {
      const target=phraseTarget(text,selected,[{id:"single",startChar:selected.start,endChar:selected.end,surfaceForm:text.slice(selected.start,selected.end)}]);
      assert.equal(target.word,phrase);assert.equal(target.occurrence,undefined,"unverified phrase has no fabricated sense");
    }
  }
});
test("an authored separable phrase retains its exact contextual identity", () => {
  const text="They found him out yesterday.";const row={id:"checked",startChar:5,endChar:18,surfaceForm:"found him out"};
  assert.equal(phraseTarget(text,{start:15,end:18,clean:"out"},[row]).occurrence?.id,"checked");
});
test("equal competing senses and stale offsets remain unresolved", () => {
  const text="food poisoning";const a={id:"a",startChar:0,endChar:14,surfaceForm:text};
  assert.equal(phraseTarget(text,{start:0,end:4,clean:"food"},[a,{...a,id:"b"}]).occurrence,undefined);
  assert.equal(phraseTarget(text,{start:0,end:4,clean:"food"},[{...a,surfaceForm:"wrong phrase"}]).occurrence,undefined);
});
