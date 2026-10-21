import type {Entry} from './model';
import {formsOf} from '@/lib/services/lexical/forms';
export const usageNorm=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[\u2019\u2018\u02bc\u02bb`]/g,"'").replace(/[^\p{L}\p{N}']+/gu,' ').replace(/\s+/g,' ').trim();
/** Morphology only. This never chooses a meaning from a sentence. */
export function exampleUsesEntry(entry:Pick<Entry,'display_lemma'|'part_of_speech'|'lexical_type'|'forms'>,text:string){
 const body=' '+usageNorm(text)+' ';
 const forms=new Set([entry.display_lemma,...entry.forms.map(f=>f.surface_form),...formsOf(entry.display_lemma,entry.part_of_speech).map(f=>f.form)]);
 for(const form of forms){const norm=usageNorm(form);if(!norm)continue;if(body.includes(' '+norm+' '))return true;
  if(entry.lexical_type==='phrasal_verb'){const terms=norm.split(' ');if(terms.length>1){const escaped=terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));if(new RegExp(' '+escaped.join(" (?:[\\p{L}\\p{N}']+ ){0,3}")+' ','u').test(body))return true;}}
 }
 return false;
}
