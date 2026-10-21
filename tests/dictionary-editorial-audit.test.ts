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
