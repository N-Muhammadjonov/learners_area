import test from "node:test";
import assert from "node:assert/strict";
import {matchingContextMeaning,type TextDictionaryMeaning} from "../src/lib/dictionary/text-meanings";
const meaning=(senseId:string,definitionEn:string,partOfSpeech="noun"):TextDictionaryMeaning=>({lexemeId:"bank-entry",senseId,term:"bank",definitionEn,partOfSpeech,translationUz:"sinov",ipa:null});
const authored={id:"finance",term:"bank",definitionEn:"A financial institution",partOfSpeech:"n"};
test("study metadata follows the exact authored meaning rather than the first spelling hit",()=>{
 const river=meaning("river","Land beside a river"),finance=meaning("finance","A financial institution");
 assert.equal(matchingContextMeaning([river,finance],authored),finance);
 assert.equal(matchingContextMeaning([river],authored),undefined);
 assert.equal(matchingContextMeaning([finance],{...authored,definitionEn:"An edited definition"}),undefined);
});
test("unbound duplicate meanings and part-of-speech mismatches cannot attach study material",()=>{
 assert.equal(matchingContextMeaning([meaning("other","A financial institution","verb")],authored),undefined);
 assert.equal(matchingContextMeaning([meaning("one","A financial institution"),meaning("two","A financial institution")],authored),undefined);
});
