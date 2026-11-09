import {normalizeGameAnswer,acceptsAnswer} from './game-common.js';

export const sentenceFor=word=>String(word.exampleSentence??'').trim()||String(word.definitionEn??'').trim();
export function gapPrompt(word){
 const term=String(word.term??'').trim(),sentence=sentenceFor(word);
 if(!term||!sentence)return null;
 const escaped=term.split(/\s+/).map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+');
 const pattern=new RegExp('(^|[^\\p{L}\\p{N}_])'+escaped+'(?=$|[^\\p{L}\\p{N}_])','giu');
 const replaced=sentence.replace(pattern,(_,prefix)=>prefix+'______');
 return replaced===sentence?null:replaced;
}
export function eligibleWords(words,game){
 const ids=new Set(),terms=new Set(),meanings=new Set();
 return words.filter(word=>{
  const term=normalizeGameAnswer(word.term),meaning=normalizeGameAnswer(word.definitionEn);
  if(!term||!meaning||ids.has(word.id))return false;
  if(game==='translation'&&!String(word.translationUz??'').trim())return false;
  if(game==='gap'&&!gapPrompt(word))return false;
  if(game==='builder'&&sentenceFor(word).split(/\s+/).filter(Boolean).length<2)return false;
  if(['choice','match'].includes(game)&&(terms.has(term)||meanings.has(meaning)))return false;
  ids.add(word.id);terms.add(term);meanings.add(meaning);return true;
 });
}
export function choiceOptions(word,words){
 const values=[word.term],seen=new Set([normalizeGameAnswer(word.term)]);
 for(const candidate of words){
  const term=normalizeGameAnswer(candidate.term);
  if(!term||seen.has(term)||acceptsAnswer(word,candidate.term)||normalizeGameAnswer(candidate.definitionEn)===normalizeGameAnswer(word.definitionEn))continue;
  seen.add(term);values.push(candidate.term);if(values.length===4)break;
 }
 return values;
}
