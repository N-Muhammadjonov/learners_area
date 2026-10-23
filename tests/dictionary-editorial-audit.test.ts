import test from "node:test";
import assert from "node:assert/strict";
import { applyDraft, senseMeaningHash } from "../src/lib/dictionary/model";
import { auditDictionaryEditorial,hasMaterialText,materialBodyHash,studyMaterialHash,type EditorialReview,type MaterialText } from "../src/lib/dictionary/editorial-audit";
const entry=applyDraft([],{operation:"add_lexeme",lemma:"bank",partOfSpeech:"n",lexicalType:"word",definitionEn:"A financial institution",definitionUz:"Moliya muassasasi",translationUz:"bank",examples:[{textEn:"The bank lends money.",textUz:"Bank qarz beradi."}]},"rel-v1-111111111111111111111111");
const sense=entry.senses[0]!;
const material:MaterialText={source:"reading",id:"passage",title:"Banking",body:"The bank."};
const presentation=()=>({senses:{[sense.sense_id]:{examples:sense.examples,synonyms:[],collocations:[]}}});
const complete:EditorialReview={senses:[{senseId:sense.sense_id,meaningSha:senseMeaningHash(entry,sense),studySha:studyMaterialHash(presentation().senses[sense.sense_id]!),reviewer:"editor",examples:"reviewed",synonyms:{notApplicable:"No exact synonym is attested for this fixture.",referenceUrl:"https://example.test/source"},collocations:{notApplicable:"No phrase is attested for this fixture.",referenceUrl:"https://example.test/source"}}],texts:[{source:"reading",id:material.id,bodySha:materialBodyHash(material.body),reviewer:"editor",readInFull:true}],contexts:[{source:"reading",sourceId:material.id,bodySha:materialBodyHash(material.body),start:4,end:8,surface:"bank",senseId:sense.sense_id,meaningSha:senseMeaningHash(entry,sense),reviewer:"editor"}]};
const audit=(reviews=complete,materials=[material])=>auditDictionaryEditorial({entries:[entry],presentation,materials,reviews,expectedMaterials:{reading:1,listening:0,retention:0}});
test("a complete inventory cannot masquerade as an editorially complete dictionary",()=>{
 const report=audit({senses:[],contexts:[],texts:[]});assert.equal(report.sensesWithExamples,1);assert.equal(report.readyForManualCheck,false);assert.equal(report.unreviewedSenses,1);assert.equal(report.unreviewedTexts,1);
 assert.equal(audit().readyForManualCheck,true);
});
test("a source edit or a meaning edit invalidates a previous contextual review",()=>{
 assert.equal(audit(complete,[{...material,body:"The bank lends."}]).readyForManualCheck,false);
 const altered=structuredClone(complete);altered.contexts[0]!.meaningSha="stale";assert.equal(audit(altered).materialRows[0]!.reviewedContentWordTokens,0);
 const staleStudy=structuredClone(complete);staleStudy.senses[0]!.studySha="stale";assert.equal(audit(staleStudy).readyForManualCheck,false);
 const fabricatedCoverage=structuredClone(complete);Object.assign(fabricatedCoverage.contexts[0]!,{start:0,end:material.body.length,surface:material.body});
 assert.equal(audit(fabricatedCoverage).materialRows[0]!.reviewedContentWordTokens,0,'one real sense cannot certify an entire unrelated text span');
});
test("a missing transcript notice is not a transcript and cannot satisfy completion",()=>{
 const placeholder:MaterialText={source:"listening",id:"test",title:"Test",body:"Full verbatim transcript is not present in the supplied source HTML."};
 assert.equal(hasMaterialText(placeholder),false);assert.equal(hasMaterialText({...placeholder,body:"Hello. Welcome to the listening test."}),true);
 assert.equal(audit(complete,[placeholder]).readyForManualCheck,false);assert.equal(audit(complete,[placeholder]).missingMaterial.length,1);
});

test("conflicting meanings at the same occurrence cannot count as one automatic context link",()=>{
 const river={...sense,sense_id:"33333333-3333-4333-8333-333333333333",definition_en:"Land beside a river"};
 const polysemous={...entry,senses:[sense,river]};
 const reviews=structuredClone(complete);
 reviews.contexts.push({...reviews.contexts[0]!,senseId:river.sense_id,meaningSha:senseMeaningHash(polysemous,river)});
 const report=auditDictionaryEditorial({entries:[polysemous],presentation,materials:[material],reviews,expectedMaterials:{reading:1,listening:0,retention:0}});
 assert.equal(report.materialRows[0]!.reviewedContentWordTokens,0);
 assert.equal(report.materialRows[0]!.ambiguousContextWordTokens,1);
 assert.equal(report.readyForManualCheck,false);
});

test("an explicit time-unit binding accepts the noun plural minutes without choosing the meeting-record sense",()=>{
 const minute=applyDraft([],{operation:"add_lexeme",lemma:"minute",partOfSpeech:"n",lexicalType:"word",definitionEn:"A unit of time lasting sixty seconds",definitionUz:"Oltmish soniyalik vaqt birligi",translationUz:"daqiqa",examples:[{textEn:"One minute has sixty seconds.",textUz:"Bir daqiqada oltmish soniya bor."}]},entry.release_id);
 const time=minute.senses[0]!,body="The minutes.";
 const report=auditDictionaryEditorial({entries:[minute],presentation:()=>({senses:{}}),materials:[{...material,body}],reviews:{senses:[],texts:[],contexts:[{...complete.contexts[0]!,bodySha:materialBodyHash(body),surface:"minutes",end:11,senseId:time.sense_id,meaningSha:senseMeaningHash(minute,time)}]},expectedMaterials:{reading:1,listening:0,retention:0}});
 assert.equal(report.materialRows[0]!.reviewedContentWordTokens,1);
 assert.deepEqual(report.materialRows[0]!.missingDictionaryForms,[]);
 assert.equal(report.readyForManualCheck,false,"a valid span does not certify the missing editorial work");
});

test("a container can, a month May, a legal will and the country US cannot be skipped as grammatical words",()=>{
 const body="The can in May was in the will in the US.";
 const row=audit({senses:[],texts:[],contexts:[]},[{...material,body}]).materialRows[0]!;
 assert.equal(row.contentWordTokens,4);assert.equal(row.unreviewedContentWordTokens,4);
 assert.equal(audit({senses:[],texts:[],contexts:[]},[{...material,body:"They cannot."}]).materialRows[0]!.contentWordTokens,0,"the unambiguous negative auxiliary is basic grammar, while can remains subject to its own context review");
 const modalBody="They can read.";
 const review:EditorialReview={senses:[],texts:[],contexts:[],grammar:[{source:"reading",sourceId:material.id,bodySha:materialBodyHash(modalBody),start:5,end:8,surface:"can",reviewer:"editor",reason:"The auxiliary expresses their ability to read.",use:"modal_auxiliary"}]};
 assert.equal(audit(review,[{...material,body:modalBody}]).materialRows[0]!.unreviewedContentWordTokens,1,"read still needs a meaning even when the auxiliary exemption is reviewed");
 review.grammar![0]!.bodySha="stale";
 assert.equal(audit(review,[{...material,body:modalBody}]).materialRows[0]!.unreviewedContentWordTokens,2);
});

test("being requires a source-relative passive auxiliary receipt or its own lexical meaning",()=>{
 const body="The bank is being used.";
 const grammar:NonNullable<EditorialReview["grammar"]>[number]={source:"reading",sourceId:material.id,bodySha:materialBodyHash(body),start:12,end:17,surface:"being",reviewer:"editor",reason:"Being forms the passive auxiliary construction being used.",use:"passive_auxiliary"};
 const review:EditorialReview={senses:[],texts:[],contexts:[],grammar:[grammar]};
 assert.equal(audit(review,[{...material,body}]).materialRows[0]!.unreviewedContentWordTokens,2,"bank and used still require lexical meanings");
 assert.equal(audit({senses:[],texts:[],contexts:[]},[{...material,body:"A living being."}]).materialRows[0]!.unreviewedContentWordTokens,2,"the noun being is not globally excluded");
 grammar.use="modal_auxiliary";assert.equal(audit(review,[{...material,body}]).materialRows[0]!.unreviewedContentWordTokens,3);
 grammar.use="passive_auxiliary";grammar.bodySha="stale";assert.equal(audit(review,[{...material,body}]).materialRows[0]!.unreviewedContentWordTokens,3);
});
