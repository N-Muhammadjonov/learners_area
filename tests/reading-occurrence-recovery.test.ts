import test from "node:test";
import assert from "node:assert/strict";
import {recoverReadingOffset} from "../src/lib/services/lexical/recover-reading-offset";

test("legacy paragraph offsets recover only the original authored sentence, retaining multiword surfaces",()=>{
  const paragraph="They find out the answer.",body="An earlier paragraph.\n\n"+paragraph;
  const found=recoverReadingOffset(body,{startChar:5,endChar:13,surfaceForm:"find out",sentenceText:paragraph});
  assert.deepEqual(found,{startChar:body.indexOf("find out"),endChar:body.indexOf("find out")+8,proof:"unique_authored_sentence"});
  assert.equal(body.slice(found!.startChar,found!.endChar),"find out");
  assert.equal(recoverReadingOffset(body,{startChar:found!.startChar,endChar:found!.endChar,surfaceForm:"find out",sentenceText:paragraph})?.proof,"already_absolute");
});
test("repeated words need the original paragraph-relative position; repeated contexts and partial-word matches stay unresolved",()=>{
  const sentence="Food remains food.",body="A long preceding paragraph with no target.\n\n"+sentence;
  const occurrence={startChar:13,endChar:17,surfaceForm:"food",sentenceText:sentence};
  assert.equal(recoverReadingOffset(body,occurrence)?.startChar,body.lastIndexOf("food"));
  assert.equal(recoverReadingOffset(body+"\n\n"+sentence,occurrence),null);
  assert.equal(recoverReadingOffset("Header.\n\nThe party began.",{startChar:0,endChar:3,surfaceForm:"art",sentenceText:"The party began."}),null);
  assert.equal(recoverReadingOffset(body,{...occurrence,sentenceText:"An absent source sentence."}),null);
});
