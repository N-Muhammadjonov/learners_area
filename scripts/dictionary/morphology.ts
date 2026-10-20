import {normalizeSearch,type Entry} from '../../src/lib/dictionary/model';
import {dictionaryPos} from '../../src/lib/dictionary/labels';
/** Offline corpus attestation + POS-specific regular inflection. This expands
 * search forms only: it never creates a sense or binds a text to its first hit.
 * Rule reference: https://wordnet.princeton.edu/documentation/morphy7wn */
export function addCorpusInflections(entries:Entry[],texts:{body:string}[]){
 const heads=new Map<string,Entry[]>();for(const e of entries){const key=normalizeSearch(e.display_lemma),list=heads.get(key)??[];list.push(e);heads.set(key,list);}
 const tokens=new Set(texts.flatMap(t=>[...t.body.matchAll(/[A-Za-z]+(?:['’\u02bc\u02bb-][A-Za-z]+)*/g)].map(m=>normalizeSearch(m[0]))));let forms=0,covered=0;
 const detachment={noun:[['s',''],['ses','s'],['xes','x'],['zes','z'],['ches','ch'],['shes','sh'],['men','man'],['ies','y']],verb:[['s',''],['ies','y'],['es','e'],['es',''],['ed','e'],['ed',''],['ing','e'],['ing',''],['ied','y']],adjective:[['er',''],['est',''],['er','e'],['est','e'],['ier','y'],['iest','y']]} as const;
 for(const word of [...tokens].sort()){if(word.length<3||!/^[a-z]+(?:'s)?$/.test(word))continue;const exact=heads.get(word)??[];
  if(exact.some(e=>['pronoun','determiner','conjunction','preposition','interjection'].includes(dictionaryPos(e.part_of_speech))))continue;
  const candidates=new Map<string,Entry>();
  for(const pos of ['noun','verb','adjective'] as const){if(exact.some(e=>dictionaryPos(e.part_of_speech)===pos))continue;
   const roots=new Set<string>();for(const [suffix,ending] of detachment[pos])if(word.endsWith(suffix)&&word.length>suffix.length+1)roots.add(word.slice(0,-suffix.length)+ending);
   if(pos==='noun'&&word.endsWith("'s"))roots.add(word.slice(0,-2));
   // Regular consonant doubling is undone only when the resulting base exists
   // in the matching POS. Do not use these as context/sense disambiguation.
   for(const suffix of pos==='verb'?['ed','ing']:pos==='adjective'?['er','est']:[]){if(word.endsWith(suffix)){const stem=word.slice(0,-suffix.length);if(/([b-df-hj-np-tv-z])\1$/.test(stem))roots.add(stem.slice(0,-1));}}
   for(const root of roots)for(const e of heads.get(root)??[])if(dictionaryPos(e.part_of_speech)===pos)candidates.set(e.lexeme_id,e);
  }
  let found=false;for(const e of candidates.values()){if(!e.forms.some(f=>normalizeSearch(f.surface_form)===word)){e.forms.push({surface_form:word,form_type:'corpus_regular_'+dictionaryPos(e.part_of_speech)});forms++;}found=true;}if(found)covered++;
 }
 return {addedForms:forms,corpusFormsResolved:covered,ruleReference:'https://wordnet.princeton.edu/documentation/morphy7wn',contextSensesAssigned:0};
}
