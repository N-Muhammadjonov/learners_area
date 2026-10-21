import { createHash } from "node:crypto";
import { isFunctionWord } from "../text/lexical-normalize";
import { entryTerms, normalizeSearch, senseMeaningHash, stableJson, type Entry } from "./model";
import { exampleUsesEntry } from "./example-match";
import type { EntryPresentation,SensePresentation } from "./presentation-types";
import { dictionarySpellingVariants } from "./spelling-variants";

export const materialBodyHash=(body:string)=>createHash("sha256").update(body).digest("hex");
export const studyMaterialHash=(study:SensePresentation)=>materialBodyHash(stableJson(study));
export type MaterialText={source:"reading"|"listening"|"retention";id:string;title:string;body:string};
type ReviewStatus="reviewed"|"pending";
type RelationReview=ReviewStatus|{notApplicable:string;referenceUrl:string};
export type SenseReview={senseId:string;meaningSha:string;studySha:string;reviewer:string;examples:ReviewStatus;synonyms:RelationReview;collocations:RelationReview};
export type ContextReview={source:MaterialText["source"];sourceId:string;bodySha:string;start:number;end:number;surface:string;senseId:string;meaningSha:string;reviewer:string};
export type TextReview={source:MaterialText["source"];id:string;bodySha:string;reviewer:string;readInFull:boolean};
export type EditorialReview={senses:SenseReview[];contexts:ContextReview[];texts:TextReview[]};

/** Empty and explicit source placeholders are not transcripts. Word counts alone
 * are insufficient: a repeated "missing transcript" message is still missing. */
export function hasMaterialText(text:MaterialText) {
  if(!text.body.trim())return false;
  return text.source!=="listening" || !text.body.includes("Full verbatim transcript is not present in the supplied source HTML.");
}
const relationReviewed=(value:RelationReview|undefined,present:boolean)=>value==="reviewed"&&present
  || typeof value==="object"&&!present&&value.notApplicable.trim().length>=12&&/^https:\/\//.test(value.referenceUrl);

/** Structural validation and editorial review are different evidence. This gate
 * cannot certify a meaning from a spelling match or manufacture a synonym to
 * turn a coverage counter green. It never writes dictionary or learner data. */
export function auditDictionaryEditorial(input:{entries:Entry[];presentation:(entry:Entry)=>EntryPresentation;materials:MaterialText[];reviews:EditorialReview;expectedMaterials:Record<MaterialText["source"],number>}) {
 if(new Set(input.materials.map(text=>text.source+":"+text.id)).size!==input.materials.length)throw Error("duplicate_material_source");
 const senses=new Map(input.entries.flatMap(entry=>entry.senses.map(sense=>[sense.sense_id,{entry,sense,hash:senseMeaningHash(entry,sense)}] as const)));
 if(senses.size!==input.entries.reduce((n,entry)=>n+entry.senses.length,0))throw Error("duplicate_dictionary_sense");
 const reviews=new Map(input.reviews.senses.map(review=>[review.senseId,review]));
 const missingExamples:string[]=[],unreviewedSenses:string[]=[],invalidRelationTargets:string[]=[];
 let sensesWithExamples=0,sensesWithSynonyms=0,sensesWithCollocations=0,examplesReviewed=0,synonymsReviewed=0,collocationsReviewed=0;
 for(const entry of input.entries)for(const sense of entry.senses){
  const view=input.presentation(entry).senses[sense.sense_id];
  const examples=view?.examples??[],synonyms=view?.synonyms??[],collocations=view?.collocations??[];
  const validExamples=examples.length>0&&examples.every(example=>example.text_uz.trim()&&exampleUsesEntry(entry,example.text_en));
  if(validExamples)sensesWithExamples++;else missingExamples.push(sense.sense_id);
  if(synonyms.length)sensesWithSynonyms++;if(collocations.length)sensesWithCollocations++;
  for(const related of [...synonyms,...collocations])if(related.senseId&&(!related.lexemeId||senses.get(related.senseId)?.entry.lexeme_id!==related.lexemeId))invalidRelationTargets.push(sense.sense_id);
  const review=reviews.get(sense.sense_id);
  const current=!!view&&!!review?.reviewer.trim()&&review.meaningSha===senseMeaningHash(entry,sense)&&review.studySha===studyMaterialHash(view);
  if(current&&review?.examples==="reviewed"&&validExamples)examplesReviewed++;
  if(current&&relationReviewed(review?.synonyms,!!synonyms.length))synonymsReviewed++;
  if(current&&relationReviewed(review?.collocations,!!collocations.length))collocationsReviewed++;
  if(!current||review?.examples!=="reviewed"||!validExamples
    ||!relationReviewed(review?.synonyms,!!synonyms.length)||!relationReviewed(review?.collocations,!!collocations.length))unreviewedSenses.push(sense.sense_id);
 }
 const words=new Map<string,Set<string>>();
 for(const entry of input.entries)for(const term of entryTerms(entry).filter(term=>term.direction==="EN")){
  const group=words.get(term.term)??new Set<string>();entry.senses.forEach(sense=>group.add(sense.sense_id));words.set(term.term,group);
 }
 const materialRows=input.materials.map(text=>{
  const bodySha=materialBodyHash(text.body),present=hasMaterialText(text);
  const textReviews=input.reviews.texts.filter(review=>review.source===text.source&&review.id===text.id);
  const readInFull=textReviews.some(review=>review.readInFull&&review.reviewer.trim()&&review.bodySha===bodySha);
  const contexts=input.reviews.contexts.filter(review=>review.source===text.source&&review.sourceId===text.id&&review.bodySha===bodySha
    &&Number.isInteger(review.start)&&Number.isInteger(review.end)&&review.start>=0&&review.end>review.start&&review.end<=text.body.length
    &&text.body.slice(review.start,review.end)===review.surface&&review.reviewer.trim()&&senses.get(review.senseId)?.hash===review.meaningSha
    &&dictionarySpellingVariants(review.surface).some(form=>words.get(normalizeSearch(form))?.has(review.senseId)));
  const tokens=present?[...text.body.matchAll(/[\p{L}][\p{L}\p{M}]*(?:['\u2018\u2019\u02bc\u02bb-][\p{L}\p{M}]+)*/gu)].filter(token=>token[0].length>1&&!isFunctionWord(token[0])):[];
  const unreviewed=tokens.filter(token=>!contexts.some(span=>span.start<=token.index&&span.end>=token.index+token[0].length));
  const missingForms=[...new Set(unreviewed.filter(token=>!words.has(normalizeSearch(token[0]))).map(token=>normalizeSearch(token[0])))];
  return {source:text.source,id:text.id,title:text.title,bodySha,present,readInFull,contentWordTokens:tokens.length,reviewedContentWordTokens:tokens.length-unreviewed.length,unreviewedContentWordTokens:unreviewed.length,missingDictionaryForms:missingForms};
 });
 const counts=Object.fromEntries((["reading","listening","retention"] as const).map(source=>[source,materialRows.filter(row=>row.source===source).length]));
 const missingMaterial=materialRows.filter(row=>!row.present).map(row=>({source:row.source,id:row.id,title:row.title}));
 const expectedCountsMatch=Object.entries(input.expectedMaterials).every(([source,count])=>counts[source]===count);
 const unreviewedTexts=materialRows.filter(row=>!row.readInFull||row.unreviewedContentWordTokens>0).length;
 return {version:1,entries:input.entries.length,senses:senses.size,sensesWithExamples,sensesWithSynonyms,sensesWithCollocations,examplesReviewed,synonymsReviewed,collocationsReviewed,
  missingExampleSenses:missingExamples.length,unreviewedSenses:unreviewedSenses.length,invalidRelationTargets:invalidRelationTargets.length,
  expectedMaterials:input.expectedMaterials,actualMaterials:counts,expectedCountsMatch,missingMaterial,unreviewedTexts,
  textsReadInFull:materialRows.filter(row=>row.readInFull).length,
  reviewedContentWordTokens:materialRows.reduce((n,row)=>n+row.reviewedContentWordTokens,0),
  missingDictionaryForms:[...new Set(materialRows.flatMap(row=>row.missingDictionaryForms))].sort(),
  materialRows,queues:{missingExamples,unreviewedSenses,invalidRelationTargets},
  readyForManualCheck:expectedCountsMatch&&!missingMaterial.length&&!unreviewedTexts&&!unreviewedSenses.length&&!invalidRelationTargets.length,
  productionDataChanged:false,automatedChecksEstablishSemanticCorrectness:false};
}
