import test from "node:test";
import assert from "node:assert/strict";
import {applyDraft} from "../src/lib/dictionary/model";
import {matchesDictionaryContextForm} from "../src/lib/dictionary/context-form";
test("discontinuous phrasal forms need explicit source-relative parts matching a real dictionary form",()=>{
 const phrase=applyDraft([],{operation:"add_lexeme",lemma:"pick up",partOfSpeech:"v",lexicalType:"phrasal_verb",definitionEn:"Take and lift upward",definitionUz:"Ko‘tarib olmoq",translationUz:"ko‘tarib olmoq",examples:[]},"rel-v1-111111111111111111111111");
 assert.equal(matchesDictionaryContextForm(phrase,"picked up"),true);
 assert.equal(matchesDictionaryContextForm(phrase,"picked it up"),false);
 assert.equal(matchesDictionaryContextForm(phrase,"picked it up",[{start:0,end:6},{start:10,end:12}]),true);
 assert.equal(matchesDictionaryContextForm(phrase,"picked. Then up",[{start:0,end:6},{start:13,end:15}]),false);
 assert.equal(matchesDictionaryContextForm(phrase,"picked it up",[{start:0,end:6},{start:9,end:12}]),true,"whitespace is normalized without changing the source");
 assert.equal(matchesDictionaryContextForm(phrase,"picked it out",[{start:0,end:6},{start:10,end:13}]),false);
});

test("an authored adverb degree form admits higher without choosing a meaning or another head",()=>{
 const release="rel-v1-111111111111111111111111";
 const entry=(lemma:string,pos:"r"|"adverb"|"adjective"|"a"|"n")=>applyDraft([],{operation:"add_lexeme",lemma,partOfSpeech:pos,lexicalType:"word",definitionEn:"Fixture meaning",definitionUz:"Ma'no",translationUz:"ma'no",examples:[]},release);
 assert.equal(matchesDictionaryContextForm(entry("high","r"),"higher"),true);
 assert.equal(matchesDictionaryContextForm(entry("high","adverb"),"highest"),true);
 assert.equal(matchesDictionaryContextForm(entry("high","r"),"lighter"),false);
 assert.equal(matchesDictionaryContextForm(entry("high","n"),"higher"),false);
 assert.equal(matchesDictionaryContextForm(entry("high","a"),"higher"),true,"prices look higher uses an adjective, not the adverb in rose higher");
 assert.equal(matchesDictionaryContextForm(entry("high","adjective"),"highest"),true);
 assert.equal(matchesDictionaryContextForm(entry("height","n"),"higher"),false);
 assert.equal(matchesDictionaryContextForm(entry("low","a"),"lower"),true,"lower consumption is an adjective, not the verb lower");
 assert.equal(matchesDictionaryContextForm(entry("low","r"),"lowest"),true);
 assert.equal(matchesDictionaryContextForm(entry("low","n"),"lower"),false);
 assert.equal(matchesDictionaryContextForm(entry("low","a"),"slower"),false);
 assert.equal(matchesDictionaryContextForm(entry("old","a"),"older"),true,"an older report is not restricted to the older entry's personal-age meaning");
 assert.equal(matchesDictionaryContextForm(entry("old","n"),"older"),false);
 assert.equal(matchesDictionaryContextForm(entry("long","r"),"longer"),true,"waited longer takes a duration adverb");
 assert.equal(matchesDictionaryContextForm(entry("long","n"),"longer"),false);
});
